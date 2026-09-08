"""Answering questions, buffered and streamed.

Both entry points share `_plan_answer`. Two copies of the retrieval and
abstention logic would drift, and the copy that drifted would be the one that
quietly stopped abstaining.
"""
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate

import config
import graph_store
import ratelimit
import retrieval
from auth import CurrentUser, get_current_user
from database import neo4j_driver
from llm import fast_llm, smart_llm
from .prompts import ABSTAIN_THRESHOLD, NO_CONTEXT_ANSWER, chat_prompt
from .shared import (
    ChatEditRequest, ChatRequest, _document_name, _log_query, _session_doc_id,
    _tidy_answer,
)

logger = logging.getLogger("archivemind.querying")
router = APIRouter()


@dataclass
class _AnswerPlan:
    """Everything decided before a single token is generated.

    Split out so the buffered and streaming endpoints share one implementation
    of retrieval, abstention and citation building. Two copies of this logic
    would drift, and the copy that drifted would be the one that quietly
    stopped abstaining.
    """
    history_text: str
    passages: list
    context: str
    graph_text: str
    citations: list
    best_score: float
    scope: str
    abstain: bool

    @property
    def prompt_inputs(self) -> dict:
        return {
            "history": self.history_text or "(this is the first message)",
            "context": self.context,
            "graph": self.graph_text or "(no relationships extracted yet for this topic)",
        }


def _conversation_history(session_id: str, question: str) -> str:
    with neo4j_driver.session() as session:
        records = list(session.run(
            """
            MATCH (s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message)
            RETURN m.role AS role, m.content AS content
            ORDER BY m.timestamp DESC
            LIMIT $limit
            """,
            session_id=session_id, limit=config.HISTORY_TURNS * 2,
        ))
    records.reverse()

    lines = []
    for record in records:
        if record["role"] == "user" and record["content"] == question:
            continue
        speaker = "User" if record["role"] == "user" else "Assistant"
        lines.append(f"{speaker}: {record['content'][:1500]}")
    return "\n".join(lines)


def _plan_answer(session_id: str, doc_id: Optional[str], question: str) -> _AnswerPlan:
    """Retrieve and decide whether there is anything worth answering from."""
    history_text = _conversation_history(session_id, question)

    passages = retrieval.retrieve(question, doc_id=doc_id, history=history_text)
    best_score = max((p.score for p in passages), default=0.0)

    # Abstain only when there is genuinely nothing to work with.
    #
    # The old condition was `best_score < ABSTAIN_THRESHOLD` against an absolute
    # cosine, which refused to answer ordinary questions whose passages were
    # sitting right there. Two escape hatches now apply, because in both cases
    # the cosine is known to under-report:
    #   - a broad request ("what does this document contain") shares no
    #     vocabulary with policy prose, so it always scores low;
    #   - an exact-term match on a scheme name or section number is strong
    #     evidence that a 384-dimensional embedding cannot represent.
    broad = retrieval.is_broad_query(question)
    exact_hit = any("lexical" in p.found_by for p in passages)
    abstain = not passages or (
        best_score < ABSTAIN_THRESHOLD and not broad and not exact_hit
    )

    if abstain:
        return _AnswerPlan(
            history_text=history_text, passages=[], context="", graph_text="",
            citations=[], best_score=best_score, scope=_document_name(doc_id),
            abstain=True,
        )

    return _AnswerPlan(
        history_text=history_text,
        passages=passages,
        context=retrieval.format_context(passages),
        graph_text=graph_store.graph_context(question, doc_id),
        citations=retrieval.build_citations(passages),
        best_score=best_score,
        scope=_document_name(doc_id),
        abstain=False,
    )


def _answer_question(
    session_id: str,
    doc_id: Optional[str],
    question: str,
    username: str,
    started: float,
) -> dict:
    """Retrieve, generate, persist. Shared by /chat and /chat/edit.

    Both entry points must behave identically - an edited question deserves the
    same retrieval, the same grounding and the same citations as the original.
    Keeping one implementation is the only way that stays true.
    """
    plan = _plan_answer(session_id, doc_id, question)

    if plan.abstain:
        answer = NO_CONTEXT_ANSWER.format(scope=plan.scope)
        _save_answer(session_id, answer, [])
        _log_query(username, question, doc_id, plan.best_score, answered=False)
        return {
            "answer": answer,
            "sources_used": False,
            "citations": [],
            "grounded": False,
            "graph_used": False,
            "elapsed_seconds": round(time.perf_counter() - started, 2),
        }

    try:
        chain = chat_prompt | smart_llm | StrOutputParser()
        answer = chain.invoke({**plan.prompt_inputs, "question": question})
    except Exception:
        logger.exception("Answer generation failed")
        raise HTTPException(
            status_code=503,
            detail="Every language model provider is currently unavailable. Please try again shortly.",
        )

    answer = _tidy_answer(answer)
    _save_answer(session_id, answer, plan.citations)
    _log_query(username, question, doc_id, plan.best_score, answered=True)

    return {
        "answer": answer,
        "sources_used": True,
        "citations": plan.citations,
        "grounded": True,
        "graph_used": bool(plan.graph_text),
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }


# --- Streaming ---------------------------------------------------------------
def _sse(payload: dict) -> str:
    """One server-sent event. A single JSON object per frame keeps the client
    parser trivial and avoids a second dimension of event-name handling."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_answer(
    session_id: str,
    doc_id: Optional[str],
    question: str,
    username: str,
    started: float,
):
    """Generate an answer as a stream of server-sent events.

    Why this exists: retrieval alone is two LLM calls and four vector searches,
    and generation is several seconds more. Buffering all of it meant the user
    watched a spinner for the entire time with no evidence anything was
    happening. Streaming does not make it faster - it makes the first useful
    output arrive in about a second instead of at the end.

    Citations are sent *before* the tokens, because they are known as soon as
    retrieval finishes and they let the UI render the sources while the prose
    is still arriving.

    Errors are emitted as a final event rather than raised: the response status
    is already 200 by the time generation starts, so an exception here would
    otherwise truncate the body with no explanation.
    """
    try:
        yield _sse({"type": "status", "stage": "searching"})

        plan = _plan_answer(session_id, doc_id, question)

        if plan.abstain:
            answer = NO_CONTEXT_ANSWER.format(scope=plan.scope)
            _save_answer(session_id, answer, [])
            _log_query(username, question, doc_id, plan.best_score, answered=False)
            yield _sse({"type": "token", "text": answer})
            yield _sse({
                "type": "done",
                "answer": answer,
                "citations": [],
                "grounded": False,
                "sources_used": False,
                "graph_used": False,
                "elapsed_seconds": round(time.perf_counter() - started, 2),
            })
            return

        yield _sse({"type": "citations", "citations": plan.citations})
        yield _sse({"type": "status", "stage": "writing"})

        chunks = []
        try:
            chain = chat_prompt | smart_llm | StrOutputParser()
            for piece in chain.stream({**plan.prompt_inputs, "question": question}):
                if not piece:
                    continue
                chunks.append(piece)
                yield _sse({"type": "token", "text": piece})
        except Exception:
            logger.exception("Streamed answer generation failed")
            yield _sse({
                "type": "error",
                "detail": "Every language model provider is currently unavailable. "
                          "Please try again shortly.",
            })
            return

        # Tidying is whole-text work - moving a citation across a full stop
        # cannot be done a token at a time - so the client replaces its
        # accumulated draft with this final version.
        answer = _tidy_answer("".join(chunks))
        _save_answer(session_id, answer, plan.citations)
        _log_query(username, question, doc_id, plan.best_score, answered=True)

        yield _sse({
            "type": "done",
            "answer": answer,
            "citations": plan.citations,
            "grounded": True,
            "sources_used": True,
            "graph_used": bool(plan.graph_text),
            "elapsed_seconds": round(time.perf_counter() - started, 2),
        })
    except Exception:
        logger.exception("Chat stream failed")
        yield _sse({"type": "error", "detail": "Something went wrong generating that answer."})


def _enforce_chat_limit(http_request: Request, username: str) -> None:
    """Answering costs three or four LLM calls. Without a limit one account can
    drain a free-tier quota in minutes, and when it is gone every *other* user
    gets a 503 - so this protects the other users, not the server."""
    ratelimit.enforce(
        "chat",
        ratelimit.client_key(http_request, username),
        config.CHAT_RATE_LIMIT,
        config.CHAT_RATE_WINDOW,
        message="You are sending messages too quickly.",
    )


@router.post("/chat")
def chat_with_archive(
    request: ChatRequest,
    http_request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    _enforce_chat_limit(http_request, user.username)
    question = request.message.strip()
    session_id = request.session_id
    started = time.perf_counter()

    with neo4j_driver.session() as session:
        doc_id = _session_doc_id(session, session_id, user.username)

        session.run(
            """
            MATCH (s:ChatSession {id: $session_id})
            CREATE (s)-[:HAS_MESSAGE]->(m:Message {
                id: $id, role: 'user', content: $content, timestamp: $ts
            })
            """,
            session_id=session_id, id=str(uuid.uuid4()),
            content=question, ts=int(time.time() * 1000),
        )

        existing = session.run(
            "MATCH (s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message) "
            "RETURN count(m) AS n",
            session_id=session_id,
        ).single()

    if existing and existing["n"] <= 1:
        _autotitle_session(session_id, question)

    return _answer_question(session_id, doc_id, question, user.username, started)


@router.post("/chat/stream")
def chat_with_archive_streamed(
    request: ChatRequest,
    http_request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """The same answer as POST /api/chat, delivered as it is written.

    `/api/chat` is kept and still works. Two consumers justify that: the edit
    flow, which replaces a whole turn and has nothing useful to show
    progressively, and any client that cannot read a stream.
    """
    _enforce_chat_limit(http_request, user.username)
    question = request.message.strip()
    session_id = request.session_id
    started = time.perf_counter()

    with neo4j_driver.session() as session:
        doc_id = _session_doc_id(session, session_id, user.username)

        session.run(
            """
            MATCH (s:ChatSession {id: $session_id})
            CREATE (s)-[:HAS_MESSAGE]->(m:Message {
                id: $id, role: 'user', content: $content, timestamp: $ts
            })
            """,
            session_id=session_id, id=str(uuid.uuid4()),
            content=question, ts=int(time.time() * 1000),
        )

        existing = session.run(
            "MATCH (s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message) "
            "RETURN count(m) AS n",
            session_id=session_id,
        ).single()

    if existing and existing["n"] <= 1:
        _autotitle_session(session_id, question)

    return StreamingResponse(
        _stream_answer(session_id, doc_id, question, user.username, started),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Nginx buffers proxied responses by default, which would hold the
            # whole stream and deliver it at once - the exact behaviour this
            # endpoint exists to avoid.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/edit")
def edit_and_regenerate(
    request: ChatEditRequest,
    http_request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Rewrite a question already asked, and answer the new one.

    Everything from the edited message onwards is removed before regenerating.
    Keeping the old answer would leave the transcript claiming the assistant
    responded to a question that was never asked, and keeping the later turns
    would leave follow-ups attached to an answer that no longer exists.
    """
    _enforce_chat_limit(http_request, user.username)
    question = request.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="The edited question cannot be empty.")

    started = time.perf_counter()

    with neo4j_driver.session() as session:
        doc_id = _session_doc_id(session, request.session_id, user.username)

        target = session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                  -[:HAS_MESSAGE]->(m:Message {id: $message_id})
            RETURN m.timestamp AS timestamp, m.role AS role
            """,
            username=user.username, session_id=request.session_id,
            message_id=request.message_id,
        ).single()

        if not target:
            raise HTTPException(status_code=404, detail="That message was not found.")
        if target["role"] != "user":
            raise HTTPException(status_code=400, detail="Only your own questions can be edited.")

        # Drop this message and everything after it, then re-ask.
        session.run(
            """
            MATCH (s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message)
            WHERE m.timestamp >= $ts
            DETACH DELETE m
            """,
            session_id=request.session_id, ts=target["timestamp"],
        )

        session.run(
            """
            MATCH (s:ChatSession {id: $session_id})
            CREATE (s)-[:HAS_MESSAGE]->(m:Message {
                id: $id, role: 'user', content: $content, timestamp: $ts, edited: true
            })
            """,
            session_id=request.session_id, id=str(uuid.uuid4()),
            content=question, ts=int(time.time() * 1000),
        )

    result = _answer_question(
        request.session_id, doc_id, question, user.username, started
    )
    result["question"] = question
    return result


def _autotitle_session(session_id: str, question: str) -> None:
    try:
        title_prompt = ChatPromptTemplate.from_messages([
            ("system",
             "Generate a title of exactly 2 to 4 words capturing what this "
             "question is about. Title Case. No quotes, no trailing punctuation. "
             "Return only the title."),
            ("human", "{message}"),
        ])
        chain = title_prompt | fast_llm | StrOutputParser()
        title = chain.invoke({"message": question}).strip().strip('"').strip("'")[:60]
        if len(title) < 3:
            raise ValueError("title too short")
    except Exception:
        title = " ".join(question.split()[:4])[:60] or "New Chat"

    try:
        with neo4j_driver.session() as session:
            session.run(
                "MATCH (s:ChatSession {id: $session_id}) SET s.title = $title",
                session_id=session_id, title=title,
            )
    except Exception as exc:
        logger.debug("Auto-title failed: %s", exc)


def _save_answer(session_id: str, answer: str, citations: List[dict]) -> None:
    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (s:ChatSession {id: $session_id})
            CREATE (s)-[:HAS_MESSAGE]->(m:Message {
                id: $id, role: 'ai', content: $content,
                citations: $citations, timestamp: $ts
            })
            """,
            session_id=session_id, id=str(uuid.uuid4()), content=answer,
            citations=json.dumps(citations) if citations else None,
            ts=int(time.time() * 1000) + 1,
        )
