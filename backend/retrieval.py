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


def mmr_select(query: str, passages: List[Passage], k: int, lambda_: float) -> List[Passage]:
    """Maximal marginal relevance: relevant, but not three copies of one thing."""
    if len(passages) <= k:
        return passages

    embedder = get_embeddings()
    try:
        query_vec = np.asarray(embedder.embed_query(query), dtype=np.float32)
        doc_vecs = np.asarray(
            embedder.embed_documents([p.text[:1200] for p in passages]), dtype=np.float32
        )
    except Exception as exc:
        logger.warning("MMR embedding failed, falling back to plain ranking: %s", exc)
        return passages[:k]

    def _norm(matrix):
        denom = np.linalg.norm(matrix, axis=-1, keepdims=True)
        return matrix / np.clip(denom, 1e-9, None)

    query_vec = _norm(query_vec.reshape(1, -1))[0]
    doc_vecs = _norm(doc_vecs)

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

    return [passages[i] for i in selected]


# --- Orchestration -----------------------------------------------------------
def retrieve(
    question: str,
    doc_id: Optional[str] = None,
    history: str = "",
    final_k: Optional[int] = None,
    condense: bool = True,
) -> List[Passage]:
    """Run the full pipeline and return the passages worth showing the model."""
    final_k = final_k or config.RETRIEVAL_FINAL_K

    search_query = condense_query(question, history) if condense else question
    variants = expand_query(search_query)

    per_variant = max(config.RETRIEVAL_CANDIDATES // max(len(variants), 1), 6)
    result_lists: List[List[Passage]] = []

    for variant in variants:
        dense = dense_search(variant, doc_id, per_variant)
        if dense:
            result_lists.append(dense)

    lexical = lexical_search(search_query, doc_id, config.RETRIEVAL_CANDIDATES)
    if lexical:
        result_lists.append(lexical)

    if not result_lists:
        return []

    fused = reciprocal_rank_fusion(result_lists)[: config.RETRIEVAL_CANDIDATES]
    selected = mmr_select(search_query, fused, final_k, config.RETRIEVAL_MMR_LAMBDA)
    return _apply_relevance_floor(search_query, selected)


def _apply_relevance_floor(query: str, passages: List[Passage]) -> List[Passage]:
    """Score against the real query, not the fused rank, and drop the weak ones.

    A uniformly weak result set should return nothing so the prompt's grounding
    rule can make the model say it does not know.
    """
    if not passages:
        return []
    try:
        embedder = get_embeddings()
        query_vec = np.asarray(embedder.embed_query(query), dtype=np.float32)
        doc_vecs = np.asarray(
            embedder.embed_documents([p.text[:1200] for p in passages]), dtype=np.float32
        )
        query_vec = query_vec / max(float(np.linalg.norm(query_vec)), 1e-9)
        doc_vecs = doc_vecs / np.clip(np.linalg.norm(doc_vecs, axis=1, keepdims=True), 1e-9, None)
        similarities = doc_vecs @ query_vec
    except Exception:
        return passages

    kept = []
    for passage, similarity in zip(passages, similarities):
        passage.score = float(similarity)
        if similarity >= config.RETRIEVAL_MIN_SCORE:
            kept.append(passage)

    # Never return empty purely because the floor was strict: keep the single
    # best passage if it is close, and let the prompt decide.
    if not kept and passages:
        best = max(passages, key=lambda p: p.score)
        if best.score >= config.RETRIEVAL_MIN_SCORE * 0.6:
            kept = [best]
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
