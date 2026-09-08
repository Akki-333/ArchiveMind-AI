"""Request models and the helpers every router needs."""
import logging
import re
import time
import uuid
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

import config
from database import neo4j_driver

logger = logging.getLogger("archivemind.querying")


# --- Models ------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str


class ChatEditRequest(BaseModel):
    """Rewrite a question that was already asked and answer it again."""
    message: str = Field(min_length=1, max_length=4000)
    session_id: str
    message_id: str


class ChatSessionCreate(BaseModel):
    title: str = "New Chat"
    doc_id: Optional[str] = None


class ChatSessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class ChatSessionDocUpdate(BaseModel):
    doc_id: str


class CompareRequest(BaseModel):
    doc_ids: List[str]
    focus: str = ""


# --- Answer post-processing --------------------------------------------------
# Prompting gets the format right most of the time. This makes it right every
# time, because a citation the renderer cannot recognise is a citation the
# reader sees as literal punctuation in the middle of a sentence.
_CJK_CITATION = re.compile(r"[【\[［]\s*(\d{1,2})\s*[】\]］]")
_SPACED_CITATIONS = re.compile(r"\](\s+)\[")
_CITATION_BEFORE_PUNCT = re.compile(r"([.!?;:,])\s*(\[\d{1,2}\](?:\[\d{1,2}\])*)")
_CITATION_SPACED_PUNCT = re.compile(r"((?:\[\d{1,2}\])+)\s+([.!?;:,])")
_REPEATED_CITATION = re.compile(r"(\[(\d{1,2})\])\1+")
_EXCESS_BLANK_LINES = re.compile(r"\n{4,}")


def _tidy_answer(text: str) -> str:
    """Normalise citation markers and whitespace in a generated answer.

    Four fixes, each for something models actually emit:
      1. Full-width brackets from CJK-trained tokenisers, which render as
         literal 【1】 and are invisible to the citation renderer.
      2. `[1] [2]` with a space, which the renderer treats as two separate
         runs and shows as two disconnected chips.
      3. A citation stranded after the full stop, which reads as a footnote to
         the next sentence rather than to the one it supports.
      4. `[1][1]` duplication, and runs of blank lines that open a hole in the
         middle of an answer.
    """
    if not text:
        return text
    cleaned = _CJK_CITATION.sub(r"[\1]", text)
    cleaned = _SPACED_CITATIONS.sub("][", cleaned)
    cleaned = _CITATION_BEFORE_PUNCT.sub(r" \2\1", cleaned)
    cleaned = _CITATION_SPACED_PUNCT.sub(r"\1\2", cleaned)
    cleaned = _REPEATED_CITATION.sub(r"\1", cleaned)
    cleaned = _EXCESS_BLANK_LINES.sub("\n\n\n", cleaned)
    return cleaned.strip()


# --- Helpers -----------------------------------------------------------------
def _session_doc_id(session, session_id: str, username: str) -> Optional[str]:
    record = session.run(
        """
        MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
        RETURN s.doc_id AS doc_id
        """,
        username=username, session_id=session_id,
    ).single()
    if not record:
        raise HTTPException(status_code=404, detail="That conversation was not found.")
    return record["doc_id"]


def _document_name(doc_id: Optional[str]) -> str:
    if not doc_id:
        return "the archive"
    with neo4j_driver.session() as session:
        record = session.run(
            "MATCH (d:Document {id: $doc_id}) RETURN d.filename AS filename",
            doc_id=doc_id,
        ).single()
    return record["filename"] if record and record["filename"] else "the archive"


_last_prune_at = 0.0
_PRUNE_INTERVAL_SECONDS = 86_400


def prune_query_log(force: bool = False) -> int:
    """Delete query-log rows older than the retention window.

    These rows are a record of what citizens asked a government service. They
    earn their place - an unanswered question is the clearest signal of which
    document to ingest next - but that is a reason to keep them for a while,
    not forever. Called on boot and at most daily from the analytics routes,
    so no scheduler is needed.

    Returns the number of rows deleted.
    """
    global _last_prune_at
    days = config.QUERY_LOG_RETENTION_DAYS
    if days <= 0:
        return 0

    now = time.time()
    if not force and now - _last_prune_at < _PRUNE_INTERVAL_SECONDS:
        return 0
    _last_prune_at = now

    cutoff = int((now - days * 86_400) * 1000)
    try:
        with neo4j_driver.session() as session:
            record = session.run(
                """
                MATCH (q:QueryLog) WHERE q.created_at < $cutoff
                WITH q LIMIT 20000
                DETACH DELETE q
                RETURN count(*) AS deleted
                """,
                cutoff=cutoff,
            ).single()
        deleted = (record["deleted"] if record else 0) or 0
        if deleted:
            logger.info("Pruned %d query-log entries older than %d days.", deleted, days)
        return deleted
    except Exception as exc:
        logger.warning("Query-log pruning failed: %s", exc)
        return 0


def _log_query(username: str, question: str, doc_id: Optional[str],
               best_score: float, answered: bool) -> None:
    """Record every question so admins can see what the archive cannot answer.

    An unanswered question is not a failure to hide - it is the single most
    useful signal for deciding which document to ingest next.
    """
    try:
        with neo4j_driver.session() as session:
            session.run(
                """
                CREATE (q:QueryLog {
                    id: $id, username: $username, question: $question,
                    doc_id: $doc_id, best_score: $best_score,
                    answered: $answered, created_at: $ts
                })
                """,
                id=str(uuid.uuid4()), username=username, question=question[:500],
                doc_id=doc_id, best_score=float(best_score), answered=answered,
                ts=int(time.time() * 1000),
            )
    except Exception as exc:
        logger.debug("Query logging failed: %s", exc)
