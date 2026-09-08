"""Tests for answer post-processing and coverage-report shaping.

`_tidy_answer` is a safety net under prompting. Prompting gets the citation
format right most of the time; this makes it right every time, because a
citation the renderer cannot recognise appears to the reader as literal
punctuation in the middle of a sentence.
"""
import pytest

import querying


# --- _tidy_answer ------------------------------------------------------------
def test_full_width_brackets_become_ascii():
    """Models trained with CJK tokenisers emit these. The renderer only matches
    ASCII [n], so they render as literal glyphs mid-sentence."""
    assert querying._tidy_answer("Free studentship applies 【1】.") == \
        "Free studentship applies [1]."


def test_spaced_citations_are_joined():
    """`[1] [2]` renders as two disconnected chips; `[1][2]` reads as one."""
    assert querying._tidy_answer("Eligibility is limited [2] [3].") == \
        "Eligibility is limited [2][3]."


def test_citation_stranded_after_the_full_stop_moves_before_it():
    """A citation after the stop reads as a footnote to the *next* sentence."""
    assert querying._tidy_answer("Applicants must be under 35. [2]") == \
        "Applicants must be under 35 [2]."


def test_space_before_punctuation_is_closed_up():
    assert querying._tidy_answer("Three groups qualify [1][2] .") == \
        "Three groups qualify [1][2]."


def test_repeated_identical_citations_collapse():
    assert querying._tidy_answer("The scheme applies [1][1].") == \
        "The scheme applies [1]."


def test_runs_of_blank_lines_are_capped():
    assert "\n\n\n\n" not in querying._tidy_answer("First.\n\n\n\n\n\nSecond.")


def test_text_without_citations_is_untouched():
    text = "A plain sentence with no citations at all."
    assert querying._tidy_answer(text) == text


def test_empty_input_is_safe():
    assert querying._tidy_answer("") == ""
    assert querying._tidy_answer(None) is None


def test_a_markdown_table_survives_tidying():
    """The tidier must not disturb structure - a mangled table is exactly the
    bug the formatting work set out to fix."""
    table = (
        "| Attribute | Doc A | Doc B |\n"
        "| --- | --- | --- |\n"
        "| Objective | Widen access [1] | Not covered [2] |"
    )
    assert querying._tidy_answer(table) == table


# --- coverage report shaping -------------------------------------------------
@pytest.mark.parametrize("junk", ["hi", "hey", "hello!", "yo", "test", "ok", "thanks", "  "])
def test_greetings_are_not_coverage_gaps(junk):
    """A greeting is not a document worth ingesting. Leaving these in is what
    made the panel a list an administrator learns to skip."""
    assert querying._JUNK_QUESTION.match(junk) is not None


@pytest.mark.parametrize("real", [
    "What does Article 330 provide?",
    "eligibility for the TEAM initiative",
    "How do I apply for a scholarship?",
])
def test_real_questions_are_kept(real):
    assert querying._JUNK_QUESTION.match(real) is None


def test_topic_phrase_keeps_the_subject_and_drops_the_scaffolding():
    phrase = querying._topic_phrase("What do these documents say about Article 330?")
    assert "Article 330" in phrase
    assert not phrase.lower().startswith("what")


def test_topic_phrase_is_capped_and_capitalised():
    phrase = querying._topic_phrase("what is the eligibility criteria for scholarships")
    assert phrase[:1].isupper()
    assert len(phrase) <= 90


def test_topic_phrase_never_returns_empty():
    """Every branch must produce a label; an empty chip is worse than a clumsy one."""
    for question in ["What?", "the document", "how", "?"]:
        assert querying._topic_phrase(question).strip() != ""
