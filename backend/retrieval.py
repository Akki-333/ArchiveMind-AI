"""Hybrid retrieval pipeline.

The embedding model is deliberately small and free: `all-MiniLM-L6-v2`, 384
dimensions, running in-process with no quota and no vendor. A small embedder
has weaker recall than a large one, so instead of paying for a bigger model we
buy the quality back with five stages that cost nothing but a little compute
and one cheap LLM call:

    1. Condense  - rewrite a conversational follow-up into a standalone query,
                   so "what about the second one?" retrieves something sensible.
    2. Expand    - generate a few paraphrases. A weak embedder misses on
                   vocabulary mismatch; asking the same thing three ways fixes
                   most of those misses.
    3. Dense     - vector search in Pinecone, once per query variant.
    4. Lexical   - Neo4j full-text search over the stored chunks. Catches exact
                   terms - scheme names, section numbers, acronyms - that a
                   384-dimensional embedding smooths away.
    5. Fuse      - reciprocal rank fusion across every result list, then MMR to
                   drop near-duplicate passages, then a floor on the score.

The result is a short, diverse, high-precision context with the provenance
still attached, which is what makes citations possible downstream.
"""
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

import numpy as np
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_pinecone import PineconeVectorStore

import config
from database import get_embeddings, index_name, neo4j_driver
from llm import fast_llm

logger = logging.getLogger("archivemind.retrieval")

RRF_K = 60  # standard reciprocal-rank-fusion damping constant

# --- Broad requests ----------------------------------------------------------
# "Explain everything this document contains" is a perfectly reasonable request
# that scores terribly against any single chunk: it shares almost no vocabulary
# with the policy text, so cosine similarity lands near 0.15 and the old
# absolute floor discarded every passage and reported that nothing was found.
#
# The question was never weak - the *metric* was wrong for it. A request about
# the document as a whole is answered by a wide, evenly spread slice of the
# document, not by the single most similar paragraph. These are detected and
# routed down that path instead.
_BROAD_PATTERNS = re.compile(
    r"\b("
    r"summar(?:y|ise|ize|ising|izing)|overview|synopsis|abstract|gist|"
    r"explain (?:everything|it|this|the (?:whole|entire|full))|"
    r"tell me (?:about|everything)|walk me through|brief me|"
    r"key (?:points|takeaways|highlights|findings)|main (?:points|ideas|topics)|"
    r"whole document|entire document|full document|all the (?:details|contents)|"
    r"table of contents|what is (?:in|inside) (?:this|the)|"
    r"what (?:does|do) (?:this|the|it|these) [\w\s]{0,20}?(?:contain|cover|say|include|do)"
    r")\b",
    re.IGNORECASE,
)


# A question that names something specific is not a request about the document
# as a whole, even when it is phrased like one. "What do these documents say
# about Article 330?" reads as broad and is not: it has a subject, and the
# overview path would answer it with an even sample of the document while
# ignoring the one clause the user actually asked for.
_SPECIFIC_MARKER = re.compile(
    r"\d"                                          # any section, year or amount
    r"|\b(?:about|regarding|under|concerning|on|for)\s+(?:the\s+)?[A-Z]",  # "about Article"
    re.UNICODE,
)


def is_broad_query(question: str) -> bool:
    """True when the user is asking about the document rather than a fact in it."""
    text = question.strip()
    if not text:
        return False
    if _SPECIFIC_MARKER.search(text):
        return False
    if _BROAD_PATTERNS.search(text):
        return True
    # A very short question with no distinguishing detail is broad by default:
    # "this document?", "contents". Anything longer states a subject.
    return len(text.split()) <= 3


@dataclass
class Passage:
    """One retrieved chunk, with everything needed to cite it."""
    chunk_id: str
    text: str
    source: str = "Unknown document"
    doc_id: Optional[str] = None
    page: Optional[int] = None
    chunk_index: Optional[int] = None
    score: float = 0.0
    found_by: List[str] = field(default_factory=list)

    def citation_label(self) -> str:
        if self.page:
            return f"{self.source}, p. {self.page}"
        return self.source

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "source": self.source,
            "doc_id": self.doc_id,
            "page": self.page,
            "chunk_index": self.chunk_index,
            "score": round(float(self.score), 4),
            "found_by": self.found_by,
            "preview": self.text[:240].strip(),
        }


# --- Stage 1: condense -------------------------------------------------------
_CONDENSE_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "Rewrite the user's latest message into a single standalone search query.\n"
     "Resolve every pronoun and reference using the conversation history.\n"
     "Keep the user's own terminology, especially scheme names, section numbers "
     "and acronyms. Do not answer the question. Do not add words that are not "
     "implied by the conversation.\n"
     "Return ONLY the rewritten query on one line."),
    ("human", "Conversation so far:\n{history}\n\nLatest message: {question}"),
])


def condense_query(question: str, history: str) -> str:
    """Turn a follow-up into something worth embedding."""
    if not history.strip():
        return question
    if len(question.split()) > 18:
        # Already long and specific; rewriting risks losing detail.
        return question
    try:
        chain = _CONDENSE_PROMPT | fast_llm | StrOutputParser()
        rewritten = chain.invoke({"history": history[-2000:], "question": question}).strip()
        rewritten = rewritten.strip('"').strip("'").split("\n")[0][:400]
        if len(rewritten) < 3:
            return question
        logger.debug("Condensed %r -> %r", question, rewritten)
        return rewritten
    except Exception as exc:
        logger.warning("Query condensation failed, using the raw question: %s", exc)
        return question


# --- Stage 2: expand ---------------------------------------------------------
_EXPAND_PROMPT = ChatPromptTemplate.from_messages([
    ("system",
     "You generate alternative phrasings of a search query to improve document "
     "retrieval over government policy documents.\n"
     "Write {count} alternatives, each on its own line, no numbering, no "
     "commentary. Vary the vocabulary: use formal policy wording in one, plain "
     "language in another. Preserve every proper noun, scheme name and number."),
    ("human", "{query}"),
])


def expand_query(query: str) -> List[str]:
    """Paraphrase the query so vocabulary mismatch stops costing us recall."""
    variants = [query]
    if not config.MULTI_QUERY_ENABLED or config.MULTI_QUERY_COUNT < 1:
        return variants

    # Expansion buys recall by trading a round-trip. On a short keyword query
    # there is nothing to buy: "Article 46" has no vocabulary to mismatch on,
    # the lexical half matches it exactly, and paraphrasing a proper noun
    # mostly produces noise. Skipping those removes an LLM call from the
    # critical path of the queries that were already quickest to answer.
    if len(query.split()) <= 3:
        logger.debug("Short query; skipping expansion.")
        return variants
    try:
        chain = _EXPAND_PROMPT | fast_llm | StrOutputParser()
        raw = chain.invoke({"query": query, "count": config.MULTI_QUERY_COUNT})
        for line in raw.splitlines():
            cleaned = re.sub(r"^\s*[-*\d.)\]]+\s*", "", line).strip()
            if cleaned and cleaned.lower() != query.lower() and len(cleaned) > 4:
                variants.append(cleaned[:400])
        variants = variants[: config.MULTI_QUERY_COUNT + 1]
        logger.debug("Query variants: %s", variants)
    except Exception as exc:
        logger.warning("Query expansion failed, continuing with the original: %s", exc)
    return variants


# --- Stage 3: dense ----------------------------------------------------------
_vector_store = None


def _store() -> PineconeVectorStore:
    global _vector_store
    if _vector_store is None:
        _vector_store = PineconeVectorStore(
            index_name=index_name, embedding=get_embeddings()
        )
    return _vector_store


def dense_search(query: str, doc_id: Optional[str], k: int) -> List[Passage]:
    kwargs = {"k": k}
    if doc_id:
        kwargs["filter"] = {"doc_id": doc_id}
    try:
        results = _store().similarity_search_with_score(query, **kwargs)
    except Exception as exc:
        logger.error("Dense search failed: %s", exc)
        return []

    passages = []
    for doc, score in results:
        meta = doc.metadata or {}
        fallback_id = f"{meta.get('doc_id')}:{meta.get('chunk_index')}"
        passages.append(
            Passage(
                chunk_id=str(meta.get("chunk_id") or fallback_id),
                text=doc.page_content,
                source=meta.get("source") or "Unknown document",
                doc_id=meta.get("doc_id"),
                page=meta.get("page"),
                chunk_index=meta.get("chunk_index"),
                score=float(score),
                found_by=["dense"],
            )
        )
    return passages


# --- Stage 4: lexical --------------------------------------------------------
_LUCENE_SPECIALS = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')


def _escape_lucene(text: str) -> str:
    return _LUCENE_SPECIALS.sub(r"\\\1", text)


def lexical_search(query: str, doc_id: Optional[str], k: int) -> List[Passage]:
    """Neo4j full-text search. Catches the exact strings embeddings blur."""
    if not config.LEXICAL_SEARCH_ENABLED:
        return []

    terms = [t for t in re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]{2,}", query)][:12]
    if not terms:
        return []
    lucene = " OR ".join(_escape_lucene(t) for t in terms)

    cypher = """
        CALL db.index.fulltext.queryNodes('chunk_text_fulltext', $lucene)
        YIELD node, score
        WHERE $doc_id IS NULL OR node.doc_id = $doc_id
        RETURN node.id AS chunk_id, node.text AS text, node.doc_id AS doc_id,
               node.source AS source, node.page AS page, node.index AS chunk_index,
               score
        ORDER BY score DESC
        LIMIT $k
    """
    try:
        with neo4j_driver.session() as session:
            records = list(session.run(cypher, lucene=lucene, doc_id=doc_id, k=k))
    except Exception as exc:
        # A database without the full-text index, or an unparsable query.
        # Dense search alone is still a correct answer.
        logger.info("Lexical search unavailable (%s); continuing dense-only.", type(exc).__name__)
        return []

    return [
        Passage(
            chunk_id=r["chunk_id"],
            text=r["text"] or "",
            source=r["source"] or "Unknown document",
            doc_id=r["doc_id"],
            page=r["page"],
            chunk_index=r["chunk_index"],
            score=float(r["score"]),
            found_by=["lexical"],
        )
        for r in records
        if r["text"]
    ]


# --- Stage 5: fuse -----------------------------------------------------------
def reciprocal_rank_fusion(result_lists: Sequence[List[Passage]]) -> List[Passage]:
    """Combine ranked lists without needing their scores to be comparable.

    RRF only looks at rank position, which is exactly right here: a Pinecone
    cosine score and a Lucene BM25 score live on different scales and cannot be
    added together directly.
    """
    fused: dict = {}
    for passages in result_lists:
        for rank, passage in enumerate(passages):
            key = passage.chunk_id
            contribution = 1.0 / (RRF_K + rank + 1)
            if key in fused:
                existing = fused[key]
                existing.score += contribution
                for method in passage.found_by:
                    if method not in existing.found_by:
                        existing.found_by.append(method)
            else:
                fused[key] = Passage(
                    chunk_id=passage.chunk_id,
                    text=passage.text,
                    source=passage.source,
                    doc_id=passage.doc_id,
                    page=passage.page,
                    chunk_index=passage.chunk_index,
                    score=contribution,
                    found_by=list(passage.found_by),
                )
    return sorted(fused.values(), key=lambda p: p.score, reverse=True)


def _normalise(matrix):
    denom = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.clip(denom, 1e-9, None)


def embed_for_ranking(query: str, passages: List[Passage]):
    """Embed the query and every passage once, normalised.

    Both MMR and the relevance floor need exactly this, and each used to compute
    it independently - two `embed_query` calls and two `embed_documents` passes
    over overlapping text on every single message. Embedding is the most
    expensive local step in the pipeline, so doing it once and sharing the
    result is the largest saving available without changing behaviour.

    Returns `(query_vec, doc_vecs)` or `None` if the model is unavailable, in
    which case callers fall back to their previous rank-only behaviour.
    """
    if not passages:
        return None
    try:
        embedder = get_embeddings()
        query_vec = np.asarray(embedder.embed_query(query), dtype=np.float32)
        doc_vecs = np.asarray(
            embedder.embed_documents([p.text[:1200] for p in passages]), dtype=np.float32
        )
    except Exception as exc:
        logger.warning("Embedding for ranking failed: %s", exc)
        return None
    return _normalise(query_vec.reshape(1, -1))[0], _normalise(doc_vecs)


def mmr_select_indices(passages: List[Passage], k: int, lambda_: float, vectors) -> List[int]:
    """Maximal marginal relevance, returning positions rather than passages.

    Positions let the caller reuse the already-computed embeddings for the
    selected subset instead of embedding them a second time.
    """
    if vectors is None or len(passages) <= k:
        return list(range(min(k, len(passages))))

    query_vec, doc_vecs = vectors
    relevance = doc_vecs @ query_vec
    selected: List[int] = []
    remaining = list(range(len(passages)))

    while remaining and len(selected) < k:
        if not selected:
            best = int(max(remaining, key=lambda i: relevance[i]))
        else:
            chosen = doc_vecs[selected]
            best, best_score = remaining[0], -np.inf
            for i in remaining:
                redundancy = float(np.max(doc_vecs[i] @ chosen.T))
                score = lambda_ * float(relevance[i]) - (1 - lambda_) * redundancy
                if score > best_score:
                    best, best_score = i, score
        selected.append(best)
        remaining.remove(best)

    return selected


def mmr_select(query: str, passages: List[Passage], k: int, lambda_: float) -> List[Passage]:
    """Maximal marginal relevance: relevant, but not three copies of one thing.

    Kept as the standalone entry point. `retrieve` uses the index form so it can
    share one embedding pass with the relevance floor.
    """
    if len(passages) <= k:
        return passages
    vectors = embed_for_ranking(query, passages)
    if vectors is None:
        return passages[:k]
    return [passages[i] for i in mmr_select_indices(passages, k, lambda_, vectors)]


# --- Orchestration -----------------------------------------------------------
def document_overview(doc_id: Optional[str], k: int) -> List[Passage]:
    """An evenly spread slice of one document, in reading order.

    Used for broad requests. Similarity is the wrong tool for "what is in this
    document"; the right answer is a sample of the document itself, and taking
    it in document order means the model reads the structure rather than a bag
    of disconnected fragments.
    """
    if not doc_id:
        return []
    try:
        with neo4j_driver.session() as session:
            records = list(session.run(
                """
                MATCH (c:Chunk {doc_id: $doc_id})
                RETURN c.id AS chunk_id, c.text AS text, c.doc_id AS doc_id,
                       c.source AS source, c.page AS page, c.index AS chunk_index
                ORDER BY c.index ASC
                """,
                doc_id=doc_id,
            ))
    except Exception as exc:
        logger.info("Overview read unavailable (%s).", type(exc).__name__)
        return []

    if not records:
        return []

    # Sample evenly across the document, always keeping the opening chunk,
    # which is where a policy document states its purpose and scope.
    step = max(len(records) // k, 1)
    sampled = records[::step][:k]
    if records[0] not in sampled:
        sampled = [records[0]] + sampled[: k - 1]

    return [
        Passage(
            chunk_id=r["chunk_id"],
            text=r["text"] or "",
            source=r["source"] or "Unknown document",
            doc_id=r["doc_id"],
            page=r["page"],
            chunk_index=r["chunk_index"],
            score=1.0,  # the document is trivially "about" itself
            found_by=["overview"],
        )
        for r in sampled
        if r["text"]
    ]


def retrieve(
    question: str,
    doc_id: Optional[str] = None,
    history: str = "",
    final_k: Optional[int] = None,
    condense: bool = True,
) -> List[Passage]:
    """Run the full pipeline and return the passages worth showing the model."""
    broad = is_broad_query(question)
    final_k = final_k or (config.RETRIEVAL_BROAD_K if broad else config.RETRIEVAL_FINAL_K)

    # A broad request about one document is answered from the document, not
    # from whichever paragraph happens to embed nearest a vague sentence.
    if broad and doc_id:
        overview = document_overview(doc_id, final_k)
        if overview:
            logger.debug("Broad request; returning %d overview passages.", len(overview))
            return overview

    search_query = condense_query(question, history) if condense else question
    variants = expand_query(search_query)

    per_variant = max(config.RETRIEVAL_CANDIDATES // max(len(variants), 1), 6)

    # The searches are independent network calls, so running them one after
    # another simply added their latencies together: four variants against
    # Pinecone plus the Neo4j full-text query was five sequential round-trips
    # before the answer could even begin. They now overlap, and the slowest one
    # sets the cost rather than the sum.
    result_lists: List[List[Passage]] = []
    lexical: List[Passage] = []

    with ThreadPoolExecutor(max_workers=min(len(variants) + 1, 6)) as pool:
        dense_futures = [
            pool.submit(dense_search, variant, doc_id, per_variant) for variant in variants
        ]
        lexical_future = pool.submit(
            lexical_search, search_query, doc_id, config.RETRIEVAL_CANDIDATES
        )

        for future in dense_futures:
            try:
                dense = future.result()
            except Exception as exc:
                logger.warning("A dense search failed: %s", exc)
                continue
            if dense:
                result_lists.append(dense)

        try:
            lexical = lexical_future.result() or []
        except Exception as exc:
            logger.warning("Lexical search failed: %s", exc)

    if lexical:
        result_lists.append(lexical)

    if not result_lists:
        return []

    lexical_ids = {p.chunk_id for p in lexical}
    fused = reciprocal_rank_fusion(result_lists)[: config.RETRIEVAL_CANDIDATES]

    # One embedding pass, shared by the diversity step and the floor.
    vectors = embed_for_ranking(search_query, fused)
    chosen = mmr_select_indices(fused, final_k, config.RETRIEVAL_MMR_LAMBDA, vectors)
    selected = [fused[i] for i in chosen]

    similarities = None
    if vectors is not None and chosen:
        query_vec, doc_vecs = vectors
        similarities = doc_vecs[chosen] @ query_vec

    return _apply_relevance_floor(
        search_query, selected, lexical_ids, broad=broad, similarities=similarities
    )


def _apply_relevance_floor(
    query: str,
    passages: List[Passage],
    lexical_ids: Optional[set] = None,
    broad: bool = False,
    similarities=None,
) -> List[Passage]:
    """Score against the real query and drop the passages that are genuinely off-topic.

    The floor is relative first, absolute second. That ordering matters: an
    all-MiniLM-L6-v2 cosine has no fixed meaning across queries. A short
    keyword question scores 0.55 against its own answer; a full-sentence
    question about the same passage scores 0.25. Judging both against one
    absolute number threw away correct answers for the second kind and told
    the user nothing had been found - which is what made ordinary questions
    fail. Comparing each passage to the *best* passage for its own query is
    scale-free and does not have that failure mode.

    The absolute floor stays as a backstop so an entirely unrelated question
    still finds nothing and the abstain path can do its job.
    """
    if not passages:
        return []
    lexical_ids = lexical_ids or set()

    # `retrieve` passes these in, having already embedded the candidates for
    # MMR. Computing them again here was a second full embedding pass over
    # overlapping text on every message.
    if similarities is None:
        vectors = embed_for_ranking(query, passages)
        if vectors is None:
            return passages
        query_vec, doc_vecs = vectors
        similarities = doc_vecs @ query_vec

    for passage, similarity in zip(passages, similarities):
        passage.score = float(similarity)

    if broad:
        return passages

    best = max(p.score for p in passages)
    relative_cut = best * config.RETRIEVAL_RELATIVE_FLOOR

    kept = [
        p for p in passages
        # An exact-term hit is kept regardless of its cosine. A section number
        # or a scheme name matching verbatim is stronger evidence than an
        # embedding of it, and a 384-dimensional vector under-rates both.
        if p.chunk_id in lexical_ids
        or (p.score >= relative_cut and p.score >= config.RETRIEVAL_MIN_SCORE)
    ]

    # Never return empty purely because the floor was strict: the best passage
    # survives whenever it clears the absolute floor at all, and the prompt's
    # grounding rules decide whether it actually answers the question.
    if not kept:
        top = max(passages, key=lambda p: p.score)
        if top.score >= config.RETRIEVAL_MIN_SCORE:
            kept = [top]
    return kept


def format_context(passages: List[Passage]) -> str:
    """Number the passages so the model can cite them as [1], [2], ..."""
    if not passages:
        return ""
    blocks = []
    for i, passage in enumerate(passages, start=1):
        blocks.append(f"[{i}] Source: {passage.citation_label()}\n{passage.text.strip()}")
    return "\n\n".join(blocks)


def build_citations(passages: List[Passage]) -> List[dict]:
    """The citation list the UI renders under an answer."""
    return [
        {
            "n": i,
            "label": passage.citation_label(),
            "source": passage.source,
            "doc_id": passage.doc_id,
            "page": passage.page,
            "chunk_id": passage.chunk_id,
            "score": round(float(passage.score), 3),
            "preview": passage.text[:300].strip(),
        }
        for i, passage in enumerate(passages, start=1)
    ]
