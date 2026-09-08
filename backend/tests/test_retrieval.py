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
