"""Chat, sessions, documents and analytics - assembled from `routers/`.

Access model, made explicit because the original code left it ambiguous:

    ArchiveMind is a shared public archive. Every signed-in person can read and
    query every document - that is the point of a citizen policy portal.
    Administrators are the only ones who can add or remove documents.
    Chat sessions and their messages are private to the person who created them.

Every route is a plain `def`. The work behind them - Neo4j, Pinecone, the LLM -
is synchronous and slow, so running it on the event loop stalled every other
request in the process. Sync routes get a threadpool and real concurrency.

This module was 1,300 lines covering five unrelated concerns. Those now live in
`routers/`, one module each, and this file assembles them. It stays because
`main.py` mounts `querying.router` and because the names re-exported below are
part of how the rest of the application and the test suite address this code -
splitting the implementation should not have forced every caller to move.
"""
from fastapi import APIRouter

from routers import analytics, chat, compare, documents, sessions

# Re-exported so `querying.X` keeps working for callers and tests.
from routers.prompts import (  # noqa: F401
    ABSTAIN_THRESHOLD, CHAT_SYSTEM, FORMATTING_RULES, NO_CONTEXT_ANSWER, chat_prompt,
)
from routers.shared import (  # noqa: F401
    ChatEditRequest, ChatRequest, ChatSessionCreate, ChatSessionDocUpdate,
    ChatSessionUpdate, CompareRequest, _document_name, _log_query,
    _session_doc_id, _tidy_answer, prune_query_log,
)
from routers.analytics import _JUNK_QUESTION, _topic_phrase  # noqa: F401
from routers.chat import _answer_question, _plan_answer, _save_answer  # noqa: F401

router = APIRouter()

# Order matters only where a literal path could be captured by a parameterised
# one. `/documents/compare` is a POST and `/documents/{doc_id}` a DELETE, so
# they cannot collide, but keeping compare ahead of the catch-all documents
# routes makes that independent of HTTP method if either ever gains one.
router.include_router(compare.router)
router.include_router(documents.router)
router.include_router(sessions.router)
router.include_router(chat.router)
router.include_router(analytics.router)
