"""Tests for the retrieval pipeline's pure logic.

These are the functions where a regression is silent: nothing crashes, answers
just quietly get worse. That is exactly the profile that needs tests, and it is
why this file leads the suite.

The history matters. An absolute cosine floor of 0.28 with an abstain threshold
of 0.34 caused correct passages to be discarded for ordinary questions, and the
user was told the archive had nothing. The tests below pin the behaviour that
replaced it.
"""
import pytest

import retrieval
from retrieval import Passage


def _passage(chunk_id, text="text", score=0.0, found_by=None, **kwargs):
    return Passage(
        chunk_id=chunk_id,
        text=text,
        score=score,
        found_by=list(found_by or []),
        **kwargs,
    )


# --- is_broad_query ----------------------------------------------------------
@pytest.mark.parametrize("question", [
    "summarise this document",
    "give me an overview",
    "explain everything the document contains",
    "what does this document cover",
    "tell me about this",
    "key points",
    "walk me through it",
    "what is inside this",
])
def test_broad_requests_are_detected(question):
    """A request about the document as a whole, which similarity scores badly."""
    assert retrieval.is_broad_query(question) is True


@pytest.mark.parametrize("question", [
    "What is the eligibility for Article 46?",
    "Who administers the TEAM Initiative?",
    "What do these documents say about Article 330?",
    "summarise Article 46",
    "Tell me about the MSME TEAM Initiative",
    "What is the penalty under section 12",
])
def test_questions_naming_a_subject_are_not_broad(question):
    """The trap: these read like broad phrasings but name something specific.

    "What do these documents say about Article 330?" matches the broad pattern
    word for word. Routing it to the document-overview path would answer a
    precise question with an even sample of the whole document.
    """
    assert retrieval.is_broad_query(question) is False


def test_empty_query_is_not_broad():
    assert retrieval.is_broad_query("") is False
    assert retrieval.is_broad_query("   ") is False


# --- reciprocal_rank_fusion --------------------------------------------------
def test_rrf_merges_lists_without_comparing_scores():
    """The whole point of RRF: a Pinecone cosine and a Lucene score live on
    different scales, so only rank position may be used."""
    dense = [_passage("a", score=0.9, found_by=["dense"]),
             _passage("b", score=0.8, found_by=["dense"])]
    lexical = [_passage("b", score=42.0, found_by=["lexical"]),
               _passage("c", score=17.0, found_by=["lexical"])]

    fused = retrieval.reciprocal_rank_fusion([dense, lexical])
    by_id = {p.chunk_id: p for p in fused}

    assert set(by_id) == {"a", "b", "c"}
    # "b" is the only passage found by both methods, so it must win.
    assert fused[0].chunk_id == "b"
    assert sorted(by_id["b"].found_by) == ["dense", "lexical"]
    # The Lucene score of 42.0 must not have leaked into the fused score.
    assert by_id["b"].score < 1.0


def test_rrf_is_ordered_by_fused_score():
    lists = [[_passage("x"), _passage("y"), _passage("z")]]
    fused = retrieval.reciprocal_rank_fusion(lists)
    assert [p.chunk_id for p in fused] == ["x", "y", "z"]
    assert fused[0].score > fused[1].score > fused[2].score


def test_rrf_handles_empty_input():
    assert retrieval.reciprocal_rank_fusion([]) == []
    assert retrieval.reciprocal_rank_fusion([[]]) == []


# --- the relevance floor -----------------------------------------------------
class _FakeEmbedder:
    """Deterministic embeddings, so the floor can be tested without a model.

    Each text maps to a fixed vector supplied by the test. Using the real
    sentence-transformer here would make the suite slow, network-dependent and
    non-deterministic - and would test the model rather than our logic.
    """

    def __init__(self, vectors):
        self._vectors = vectors

    def embed_query(self, text):
        return self._vectors[text]

    def embed_documents(self, texts):
        return [self._vectors[t] for t in texts]


@pytest.fixture
def fake_embeddings(monkeypatch):
    def _install(vectors):
        monkeypatch.setattr(retrieval, "get_embeddings", lambda: _FakeEmbedder(vectors))
    return _install


def test_floor_is_relative_so_a_weak_absolute_score_survives(fake_embeddings):
    """The regression this exists for.

    Every passage scores far below the old 0.28 absolute floor, but they are
    the best matches for this query. The relative floor keeps them; the old
    absolute one discarded all of them and reported that nothing was found.
    """
    vectors = {
        "query": [1.0, 0.0],
        "strong": [0.25, 0.968],     # cosine with query = 0.25
        "weaker": [0.20, 0.980],     # cosine = 0.20
    }
    fake_embeddings(vectors)

    passages = [_passage("s", text="strong"), _passage("w", text="weaker")]
    kept = retrieval._apply_relevance_floor("query", passages)

    assert {p.chunk_id for p in kept} == {"s", "w"}
    assert kept[0].score == pytest.approx(0.25, abs=1e-3)


def test_floor_drops_a_passage_far_below_the_best(fake_embeddings):
    """Relative does not mean permissive: something genuinely unrelated goes."""
    vectors = {
        "query": [1.0, 0.0],
        "relevant": [0.9, 0.436],      # cosine = 0.9
        "unrelated": [0.02, 0.9998],   # cosine = 0.02, below both floors
    }
    fake_embeddings(vectors)

    passages = [_passage("r", text="relevant"), _passage("u", text="unrelated")]
    kept = retrieval._apply_relevance_floor("query", passages)

    assert [p.chunk_id for p in kept] == ["r"]


def test_lexical_hits_survive_the_floor(fake_embeddings):
    """An exact term match beats its own embedding.

    A section number or scheme name matching verbatim is strong evidence that
    a 384-dimensional vector under-rates, so it is kept regardless of cosine.
    """
    vectors = {
        "query": [1.0, 0.0],
        "relevant": [0.9, 0.436],
        "exact": [0.02, 0.9998],   # would be dropped on cosine alone
    }
    fake_embeddings(vectors)

    passages = [_passage("r", text="relevant"), _passage("e", text="exact")]
    kept = retrieval._apply_relevance_floor("query", passages, lexical_ids={"e"})

    assert {p.chunk_id for p in kept} == {"r", "e"}


def test_broad_requests_bypass_the_floor(fake_embeddings):
    """A broad request is answered by a spread of the document, so filtering it
    by similarity to a vague sentence defeats the purpose."""
    vectors = {
        "query": [1.0, 0.0],
        "a": [0.01, 0.9999],
        "b": [0.02, 0.9998],
    }
    fake_embeddings(vectors)

    passages = [_passage("a", text="a"), _passage("b", text="b")]
    kept = retrieval._apply_relevance_floor("query", passages, broad=True)

    assert len(kept) == 2


def test_floor_never_returns_empty_when_the_best_clears_the_absolute_floor(
    fake_embeddings,
):
    vectors = {"query": [1.0, 0.0], "only": [0.30, 0.954]}
    fake_embeddings(vectors)

    kept = retrieval._apply_relevance_floor("query", [_passage("o", text="only")])
    assert [p.chunk_id for p in kept] == ["o"]


def test_floor_on_empty_input_returns_empty(fake_embeddings):
    fake_embeddings({})
    assert retrieval._apply_relevance_floor("query", []) == []


# --- shared embeddings and diversity ----------------------------------------
def test_the_floor_uses_precomputed_similarities_without_re_embedding(monkeypatch):
    """The latency fix. `retrieve` embeds the candidates once for MMR and hands
    the result to the floor; embedding again here was a second full pass over
    overlapping text on every message."""
    calls = {"n": 0}

    def _tripwire():
        calls["n"] += 1
        raise AssertionError("the floor must not embed when given similarities")

    monkeypatch.setattr(retrieval, "get_embeddings", _tripwire)

    import numpy as np

    passages = [_passage("a", text="a"), _passage("b", text="b")]
    kept = retrieval._apply_relevance_floor(
        "query", passages, similarities=np.array([0.9, 0.8], dtype="float32")
    )

    assert calls["n"] == 0
    assert {p.chunk_id for p in kept} == {"a", "b"}
    assert kept[0].score == pytest.approx(0.9, abs=1e-6)


def test_lambda_trades_relevance_against_diversity(fake_embeddings):
    """What MMR actually guarantees.

    "b" is nearly a duplicate of "a" but scores much higher than "c", so which
    one is picked second is a genuine trade-off, not a fixed answer. A high
    lambda weights relevance and takes the near-duplicate; a low one weights
    novelty and takes the passage that adds something. Asserting one fixed
    outcome would pin an arbitrary point on that curve.
    """
    vectors = {
        "query": [1.0, 0.0],
        "near-duplicate A": [0.99, 0.141],
        "near-duplicate B": [0.98, 0.199],
        "different angle": [0.60, 0.800],
    }
    fake_embeddings(vectors)

    passages = [
        _passage("a", text="near-duplicate A"),
        _passage("b", text="near-duplicate B"),
        _passage("c", text="different angle"),
    ]

    relevance_heavy = {p.chunk_id for p in
                       retrieval.mmr_select("query", passages, k=2, lambda_=0.9)}
    diversity_heavy = {p.chunk_id for p in
                       retrieval.mmr_select("query", passages, k=2, lambda_=0.3)}

    # The most relevant passage is taken first either way.
    assert "a" in relevance_heavy and "a" in diversity_heavy
    assert relevance_heavy == {"a", "b"}
    assert diversity_heavy == {"a", "c"}


def test_mmr_returns_everything_when_k_exceeds_the_candidates():
    passages = [_passage("a"), _passage("b")]
    assert retrieval.mmr_select("q", passages, k=5, lambda_=0.7) == passages


def test_mmr_degrades_to_plain_ranking_without_a_model(monkeypatch):
    """An embedding failure must cost diversity, not the whole answer."""
    monkeypatch.setattr(
        retrieval, "get_embeddings",
        lambda: (_ for _ in ()).throw(RuntimeError("model unavailable")),
    )
    passages = [_passage(str(i)) for i in range(5)]
    selected = retrieval.mmr_select("q", passages, k=2, lambda_=0.7)

    assert [p.chunk_id for p in selected] == ["0", "1"]


# --- expansion ---------------------------------------------------------------
def test_short_queries_skip_expansion(monkeypatch):
    """A keyword query has no vocabulary to mismatch on, and the lexical half
    already matches it exactly - so the extra LLM call buys nothing."""
    monkeypatch.setattr(
        retrieval, "fast_llm",
        property(lambda self: (_ for _ in ()).throw(AssertionError("must not call the LLM"))),
        raising=False,
    )
    assert retrieval.expand_query("Article 46") == ["Article 46"]
    assert retrieval.expand_query("MSME TEAM eligibility") == ["MSME TEAM eligibility"]


def test_expansion_is_disabled_by_configuration(monkeypatch):
    import config

    monkeypatch.setattr(config, "MULTI_QUERY_ENABLED", False)
    query = "a longer question about eligibility criteria for the scheme"
    assert retrieval.expand_query(query) == [query]


# --- formatting --------------------------------------------------------------
def test_format_context_numbers_passages_from_one():
    passages = [
        _passage("a", text="First passage.", source="Doc A.pdf", page=3),
        _passage("b", text="Second passage.", source="Doc B.pdf"),
    ]
    context = retrieval.format_context(passages)

    assert "[1] Source: Doc A.pdf, p. 3" in context
    assert "[2] Source: Doc B.pdf" in context


def test_build_citations_matches_the_context_numbering():
    """The numbers the model is shown must match the ones the UI renders, or
    every [n] in an answer points at the wrong source."""
    passages = [
        _passage("a", text="First.", source="Doc A.pdf", page=3),
        _passage("b", text="Second.", source="Doc B.pdf"),
    ]
    citations = retrieval.build_citations(passages)

    assert [c["n"] for c in citations] == [1, 2]
    assert citations[0]["label"] == "Doc A.pdf, p. 3"
    assert citations[0]["chunk_id"] == "a"


def test_format_context_of_nothing_is_empty():
    assert retrieval.format_context([]) == ""
