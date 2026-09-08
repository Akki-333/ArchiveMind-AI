"""Test bootstrap.

Two jobs, both of which have to happen before any backend module is imported:

1. Put `backend/` on `sys.path`. The application uses flat imports
   (`import config`) because it runs with `backend/` as the working directory,
   so the tests have to reproduce that.

2. Set synthetic credentials. `config.py` raises `ConfigError` at import when a
   required secret is missing, which is deliberate - but it means importing
   anything at all requires an environment. `python-dotenv` does not override
   variables that are already set, so setting them here guarantees the tests
   use these values and never the developer's real `.env`.

Nothing in this suite touches a network service. The Pinecone client and the
Neo4j driver are both lazy - constructing them opens no connection - so the
modules import cleanly against these placeholder values.
"""
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("JWT_SECRET", "test-only-signing-key-not-a-real-secret")
os.environ.setdefault("PINECONE_API_KEY", "test-pinecone-key")
os.environ.setdefault("PINECONE_INDEX_NAME", "archivemind-test")
os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USERNAME", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "test-password")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("ADMIN_ACCESS_CODE", "test-access-code")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_rate_limiter():
    """Every test starts with an empty limiter.

    Without this the sliding windows leak between tests and the failures become
    order-dependent, which is the least useful kind.
    """
    import ratelimit

    ratelimit.reset_all()
    yield
    ratelimit.reset_all()
