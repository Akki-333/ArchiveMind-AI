"""Dashboard figures, recommendations and coverage reporting.

The coverage report deliberately reframes the query log. An unanswered question
is the clearest signal of which document to ingest next, but presented as a
column of failures it reads as something broken - so it is grouped by topic and
shown as demand.
"""
import json
import logging
import re
import time
from typing import List

from fastapi import APIRouter, Depends, Query

import graph_store
from auth import CurrentUser, get_current_user, require_admin
from database import neo4j_driver
from .shared import prune_query_log

logger = logging.getLogger("archivemind.querying")
router = APIRouter()


@router.get("/stats")
def get_user_stats(user: CurrentUser = Depends(get_current_user)):
    """Dashboard figures, counted from the real graph rather than from summaries."""
    with neo4j_driver.session() as session:
        doc_ids = [r["id"] for r in session.run("MATCH (d:Document) RETURN d.id AS id")]
        totals = session.run(
            """
            MATCH (d:Document)
            OPTIONAL MATCH (c:Chunk)-[:PART_OF]->(d)
            RETURN count(DISTINCT d) AS documents, count(c) AS chunks
            """
        ).single()
        my_sessions = session.run(
            "MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession) "
            "RETURN count(s) AS n",
            username=user.username,
        ).single()

    stats = graph_store.graph_stats(doc_ids or None)
    top = graph_store.top_entities(doc_ids or None, limit=15)

    return {
        "total_entities": stats["entities"],
        "total_relations": stats["relations"],
        "total_documents": (totals["documents"] if totals else 0) or 0,
        "total_chunks": (totals["chunks"] if totals else 0) or 0,
        "my_sessions": (my_sessions["n"] if my_sessions else 0) or 0,
        "top_entities": [
            {"name": e["name"], "count": e["count"], "type": e["type"]} for e in top
        ],
    }


@router.get("/chat/recommendations")
def get_chat_recommendations(user: CurrentUser = Depends(get_current_user)):
    """Topics to explore next, grounded in what the archive actually contains.

    There used to be two handlers registered on this path; FastAPI bound the
    first and the second was unreachable. This is the single implementation.
    """
    with neo4j_driver.session() as session:
        doc_ids = [r["id"] for r in session.run("MATCH (d:Document) RETURN d.id AS id")]

    entities = graph_store.top_entities(doc_ids or None, limit=12)
    candidates = [e["name"] for e in entities if len(e["name"]) > 4][:8]

    if not candidates:
        # Fall back to the document profiles while the graph is still empty.
        seen: List[str] = []
        with neo4j_driver.session() as session:
            for row in session.run("MATCH (d:Document) RETURN d.key_entities AS ke LIMIT 20"):
                try:
                    for name in json.loads(row["ke"] or "[]"):
                        cleaned = str(name).strip()
                        if len(cleaned) > 4 and cleaned not in seen:
                            seen.append(cleaned)
                except (ValueError, TypeError):
                    continue
        candidates = seen[:8]

    if not candidates:
        return {"recommendations": ["Public Health", "Tax Policies", "Education Reform"]}

    return {"recommendations": candidates[:3]}


# --- Admin analytics ---------------------------------------------------------
@router.get("/analytics/unanswered")
def unanswered_questions(
    limit: int = Query(20, ge=1, le=100),
    _: CurrentUser = Depends(require_admin),
):
    """Questions the archive could not answer - the ingestion backlog.

    This is the most actionable panel on the dashboard: it turns a user's dead
    end into a concrete decision about which document to add next.
    """
    with neo4j_driver.session() as session:
        rows = session.run(
            """
            MATCH (q:QueryLog)
            WHERE q.answered = false
            RETURN q.question AS question, q.doc_id AS doc_id,
                   q.best_score AS best_score, q.created_at AS created_at
            ORDER BY q.created_at DESC
            LIMIT $limit
            """,
            limit=limit,
        )
        questions = [
            {
                "question": r["question"],
                "doc_id": r["doc_id"],
                "best_score": round(r["best_score"] or 0.0, 3),
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    return {"questions": questions}


# Greetings and test strings are not coverage gaps. Filtering them out is what
# makes the panel actionable rather than a list of noise an admin learns to skip.
_JUNK_QUESTION = re.compile(
    r"^\s*(hi+|hey+|hello+|yo+|test+|ok+|thanks?|thank you|\W*)\s*[!.?]*\s*$",
    re.IGNORECASE,
)


def _topic_phrase(question: str) -> str:
    """Turn a raw question into a short topic label for the coverage panel."""
    text = re.sub(r"^\s*(what|which|who|when|where|why|how|does|do|is|are|can|could|"
                  r"tell me|explain|describe|list)\b[\s,]*", "", question.strip(),
                  flags=re.IGNORECASE)
    text = re.sub(r"^(do|does|did|the|these|this|that|a|an|about)\b\s*", "", text,
                  flags=re.IGNORECASE)
    text = re.sub(r"\b(documents?|archive|file|pdf)\b\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" ?.!,:;-")
    if not text:
        # Stripping can consume the whole string - "?" and "how" leave nothing
        # behind. Fall back to the raw question, and to a label of last resort
        # if even that is empty, because a blank chip on the dashboard is worse
        # than a clumsy one.
        text = question.strip(" ?.!,:;-") or question.strip()
    if not text:
        return "Unlabelled request"
    return (text[:1].upper() + text[1:])[:90]


@router.get("/analytics/coverage")
def coverage_report(_: CurrentUser = Depends(require_admin)):
    """What the archive covers well, and what it is being asked to cover next.

    This replaces the "what the archive could not answer" framing on the
    dashboard. The underlying data is the same query log, but a bare list of
    failures is a scoreboard of losses: it reads as something being wrong,
    when in fact an unanswered question is the single most useful signal the
    system produces - it is a citizen telling you exactly which document to
    add. Presenting it as demand rather than as failure is not spin; it is the
    framing that leads to the action the data actually supports.
    """
    prune_query_log()

    now_ms = int(time.time() * 1000)
    week_ago = now_ms - 7 * 86_400_000

    with neo4j_driver.session() as session:
        totals = session.run(
            """
            MATCH (q:QueryLog)
            RETURN count(q) AS total,
                   sum(CASE WHEN q.answered THEN 1 ELSE 0 END) AS answered,
                   sum(CASE WHEN q.answered AND q.created_at > $week THEN 1 ELSE 0 END)
                       AS answered_week
            """,
            week=week_ago,
        ).single()

        gap_rows = list(session.run(
            """
            MATCH (q:QueryLog)
            WHERE q.answered = false
            RETURN q.question AS question, q.doc_id AS doc_id,
                   q.best_score AS best_score, q.created_at AS created_at
            ORDER BY q.created_at DESC
            LIMIT 60
            """
        ))

        strong_rows = list(session.run(
            """
            MATCH (q:QueryLog)
            WHERE q.answered = true AND q.doc_id IS NOT NULL
            OPTIONAL MATCH (d:Document {id: q.doc_id})
            RETURN d.filename AS filename, count(q) AS answered
            ORDER BY answered DESC
            LIMIT 5
            """
        ))

    # Group repeated asks: three people asking the same thing is a stronger
    # signal than three unrelated one-offs, and the panel should say so.
    grouped: dict = {}
    for row in gap_rows:
        question = (row["question"] or "").strip()
        if not question or _JUNK_QUESTION.match(question):
            continue
        topic = _topic_phrase(question)
        key = topic.lower()
        entry = grouped.setdefault(key, {
            "topic": topic,
            "example": question,
            "asks": 0,
            "last_asked": row["created_at"],
            "closest_score": row["best_score"] or 0.0,
        })
        entry["asks"] += 1
        entry["last_asked"] = max(entry["last_asked"] or 0, row["created_at"] or 0)
        entry["closest_score"] = max(entry["closest_score"], row["best_score"] or 0.0)

    requests = sorted(
        grouped.values(),
        key=lambda e: (e["asks"], e["last_asked"] or 0),
        reverse=True,
    )[:8]
    for entry in requests:
        entry["closest_score"] = round(entry["closest_score"], 3)

    total = (totals["total"] if totals else 0) or 0
    answered = (totals["answered"] if totals else 0) or 0

    return {
        "coverage_score": round(answered / total, 3) if total else None,
        "answered": answered,
        "answered_this_week": (totals["answered_week"] if totals else 0) or 0,
        "total_queries": total,
        "requested_topics": requests,
        "well_covered": [
            {"filename": r["filename"] or "Removed document", "answered": r["answered"]}
            for r in strong_rows
        ],
    }


@router.get("/analytics/overview")
def analytics_overview(_: CurrentUser = Depends(require_admin)):
    """Query volume, answer rate and the most consulted documents."""
    now_ms = int(time.time() * 1000)
    day_ago = now_ms - 86_400_000
    week_ago = now_ms - 7 * 86_400_000

    with neo4j_driver.session() as session:
        totals = session.run(
            """
            MATCH (q:QueryLog)
            RETURN count(q) AS total,
                   sum(CASE WHEN q.answered THEN 1 ELSE 0 END) AS answered,
                   sum(CASE WHEN q.created_at > $day THEN 1 ELSE 0 END) AS last_day,
                   sum(CASE WHEN q.created_at > $week THEN 1 ELSE 0 END) AS last_week
            """,
            day=day_ago, week=week_ago,
        ).single()

        top_docs = [
            {"doc_id": r["doc_id"], "filename": r["filename"], "queries": r["queries"]}
            for r in session.run(
                """
                MATCH (q:QueryLog) WHERE q.doc_id IS NOT NULL
                OPTIONAL MATCH (d:Document {id: q.doc_id})
                RETURN q.doc_id AS doc_id, d.filename AS filename, count(q) AS queries
                ORDER BY queries DESC
                LIMIT 5
                """
            )
        ]

    total = (totals["total"] if totals else 0) or 0
    answered = (totals["answered"] if totals else 0) or 0
    return {
        "total_queries": total,
        "answered": answered,
        "unanswered": total - answered,
        "answer_rate": round(answered / total, 3) if total else None,
        "last_24h": (totals["last_day"] if totals else 0) or 0,
        "last_7d": (totals["last_week"] if totals else 0) or 0,
        "top_documents": top_docs,
    }
