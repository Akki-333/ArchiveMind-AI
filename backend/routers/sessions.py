"""Conversations and their transcripts.

Chat sessions and their messages are private to the person who created them,
which is why every query here is scoped by username rather than by session id
alone.
"""
import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException

from auth import CurrentUser, get_current_user
from database import neo4j_driver
from .shared import ChatSessionCreate, ChatSessionDocUpdate, ChatSessionUpdate

logger = logging.getLogger("archivemind.querying")
router = APIRouter()


@router.get("/chat/sessions")
def get_chat_sessions(user: CurrentUser = Depends(get_current_user)):
    with neo4j_driver.session() as session:
        result = session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession)
            OPTIONAL MATCH (s)-[:HAS_MESSAGE]->(m:Message)
            RETURN s.id AS id, s.title AS title, s.doc_id AS doc_id,
                   s.created_at AS created_at, count(m) AS message_count
            ORDER BY s.created_at DESC
            """,
            username=user.username,
        )
        sessions = [
            {
                "id": r["id"], "title": r["title"], "doc_id": r["doc_id"],
                "created_at": r["created_at"], "message_count": r["message_count"],
            }
            for r in result
        ]
    return {"sessions": sessions}


@router.post("/chat/sessions")
def create_chat_session(
    request: ChatSessionCreate, user: CurrentUser = Depends(get_current_user)
):
    session_id = str(uuid.uuid4())
    ts = int(time.time() * 1000)
    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (u:User {username: $username})
            CREATE (u)-[:HAS_SESSION]->(s:ChatSession {
                id: $session_id, title: $title, doc_id: $doc_id, created_at: $ts
            })
            """,
            username=user.username, session_id=session_id,
            title=request.title[:120], doc_id=request.doc_id, ts=ts,
        )
    return {
        "id": session_id, "title": request.title, "doc_id": request.doc_id,
        "created_at": ts, "message_count": 0,
    }


@router.put("/chat/sessions/{session_id}")
def rename_chat_session(
    session_id: str,
    request: ChatSessionUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    with neo4j_driver.session() as session:
        updated = session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
            SET s.title = $title
            RETURN s.id AS id
            """,
            username=user.username, session_id=session_id, title=request.title[:120],
        ).single()
    if not updated:
        raise HTTPException(status_code=404, detail="That conversation was not found.")
    return {"status": "success", "title": request.title}


@router.put("/chat/sessions/{session_id}/document")
def update_chat_session_document(
    session_id: str,
    request: ChatSessionDocUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    with neo4j_driver.session() as session:
        updated = session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
            SET s.doc_id = $doc_id
            RETURN s.id AS id
            """,
            username=user.username, session_id=session_id, doc_id=request.doc_id,
        ).single()
    if not updated:
        raise HTTPException(status_code=404, detail="That conversation was not found.")
    return {"status": "success", "doc_id": request.doc_id}


@router.delete("/chat/sessions/{session_id}")
def delete_chat_session(session_id: str, user: CurrentUser = Depends(get_current_user)):
    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
            OPTIONAL MATCH (s)-[:HAS_MESSAGE]->(m:Message)
            DETACH DELETE m, s
            """,
            username=user.username, session_id=session_id,
        )
    return {"status": "success"}


@router.get("/chat/history/{session_id}")
def get_chat_history(session_id: str, user: CurrentUser = Depends(get_current_user)):
    with neo4j_driver.session() as session:
        result = session.run(
            """
            MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                  -[:HAS_MESSAGE]->(m:Message)
            RETURN m.id AS id, m.role AS role, m.content AS content,
                   m.citations AS citations, m.timestamp AS timestamp,
                   m.edited AS edited
            ORDER BY m.timestamp ASC
            LIMIT 200
            """,
            username=user.username, session_id=session_id,
        )
        messages = []
        for r in result:
            # `id` is returned so the UI can edit a specific message. Without
            # it the client could only address messages by list position, which
            # breaks the moment anything is inserted or removed.
            message = {
                "id": r["id"],
                "role": r["role"],
                "content": r["content"],
                "timestamp": r["timestamp"],
            }
            if r["edited"]:
                message["edited"] = True
            if r["citations"]:
                try:
                    message["citations"] = json.loads(r["citations"])
                except (ValueError, TypeError):
                    pass
            messages.append(message)
    return {"messages": messages}
