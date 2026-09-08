"""Tests for entity resolution.

`normalise_key` decides whether two extracted entities are the same thing. Get
it wrong in one direction and the graph fills with duplicates - "Article 5",
"article 5" and "Art. 5" as three unrelated nodes. Get it wrong in the other
and genuinely distinct entities silently merge, which is worse: the graph then
asserts relationships that were never extracted.

It is pure, it has no I/O, and every extraction runs through it.
"""
import pytest

from graph_store import normalise_key


@pytest.mark.parametrize("variants", [
    ["Article 5", "article 5", "ARTICLE 5", "  Article 5  ", "Article  5"],
    ["Art. 5", "art 5", "Art 5"],
    ["Section 12", "sec. 12", "SEC 12"],
    ["Clause 3", "cl. 3", "cl 3"],
    ["Schedule 2", "sch. 2"],
    ["Government of India", "govt. of India", "GOVT OF INDIA"],
    ["Department of Revenue", "dept. of revenue"],
    ["Ministry of Finance", "min. of finance"],
])
def test_variants_of_the_same_entity_collapse_to_one_key(variants):
    keys = {normalise_key(v) for v in variants}
    assert len(keys) == 1, f"expected one key, got {keys}"


def test_abbreviations_fold_across_forms():
    """The point of the abbreviation table: "Art. 5" and "Article 5" are the
    same provision and must share a node."""
    assert normalise_key("Art. 5") == normalise_key("Article 5")
    assert normalise_key("Sec 12") == normalise_key("Section 12")


def test_leading_articles_are_stripped():
    assert normalise_key("The Ministry of Finance") == normalise_key("Ministry of Finance")
    assert normalise_key("A Scheme") == normalise_key("Scheme")
    assert normalise_key("An Initiative") == normalise_key("Initiative")


def test_punctuation_does_not_split_an_entity():
    assert normalise_key("Article-5") == normalise_key("Article 5")
    assert normalise_key("Article, 5") == normalise_key("Article 5")


@pytest.mark.parametrize("left,right", [
    ("Article 5", "Article 6"),
    ("Section 12", "Section 21"),
    ("Ministry of Finance", "Ministry of Defence"),
    ("Scheduled Castes", "Scheduled Tribes"),
])
def test_distinct_entities_do_not_merge(left, right):
    """The dangerous direction. A false merge makes the graph assert a
    relationship that was never extracted."""
    assert normalise_key(left) != normalise_key(right)


def test_empty_and_none_are_handled():
    assert normalise_key("") == ""
    assert normalise_key(None) == ""
    assert normalise_key("   ") == ""


def test_key_is_length_capped():
    """Neo4j indexes the key; an unbounded label would be a way to bloat it."""
    assert len(normalise_key("word " * 200)) <= 200


def test_key_is_lowercase_and_single_spaced():
    assert normalise_key("  Scheduled   Castes  ") == "scheduled castes"
