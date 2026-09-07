"""Central configuration and environment validation.

Every secret and tunable lives here. Missing critical secrets fail loudly at
import time instead of silently falling back to an insecure default.
"""
import os
import secrets
import logging
from pathlib import Path
from dotenv import load_dotenv

# .env sits at the repository root, one level above backend/
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

logger = logging.getLogger("archivemind.config")


class ConfigError(RuntimeError):
    """Raised when the process cannot start safely with the current environment."""


def _require(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(
            f"Required environment variable '{name}' is not set. "
            f"Copy .env.example to .env and fill it in."
        )
    return value


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


# --- Runtime -----------------------------------------------------------------
ENVIRONMENT = _optional("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"
PORT = _int("PORT", 8000)
LOG_LEVEL = _optional("LOG_LEVEL", "INFO").upper()

# --- Security ----------------------------------------------------------------
# SEC-2: never fall back to a committed literal. In production the variable is
# mandatory; in development we generate an ephemeral key so a fresh clone runs,
# but tokens then die with the process, which is the correct dev behaviour.
_jwt_secret = _optional("JWT_SECRET")
if not _jwt_secret:
    if IS_PRODUCTION:
        raise ConfigError(
            "JWT_SECRET must be set in production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )
    _jwt_secret = secrets.token_urlsafe(32)
    logger.warning(
        "JWT_SECRET is not set. Generated an ephemeral development key - "
        "all sessions will be invalidated when this process restarts."
    )
JWT_SECRET = _jwt_secret
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = _int("JWT_EXPIRY_HOURS", 24)

MIN_PASSWORD_LENGTH = _int("MIN_PASSWORD_LENGTH", 8)
LOGIN_MAX_ATTEMPTS = _int("LOGIN_MAX_ATTEMPTS", 8)
LOGIN_WINDOW_SECONDS = _int("LOGIN_WINDOW_SECONDS", 300)

# SEC-1: roles are never accepted from a client. Admins are named here, or the
# very first account created on an empty database is bootstrapped as admin.
ADMIN_USERNAMES = {
    u.strip().lower()
    for u in _optional("ADMIN_USERNAMES").split(",")
    if u.strip()
}
BOOTSTRAP_FIRST_USER_AS_ADMIN = _flag("BOOTSTRAP_FIRST_USER_AS_ADMIN", True)

# --- CORS --------------------------------------------------------------------
# "*" with credentials is rejected by browsers, so we resolve it explicitly.
_origins = _optional("CORS_ORIGINS")
if _origins:
    CORS_ORIGINS = [o.strip() for o in _origins.split(",") if o.strip()]
else:
    CORS_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://localhost:3000",
    ]
CORS_ALLOW_CREDENTIALS = "*" not in CORS_ORIGINS

# --- Vector store ------------------------------------------------------------
PINECONE_API_KEY = _require("PINECONE_API_KEY")
PINECONE_INDEX_NAME = _optional("PINECONE_INDEX_NAME", "archivemind-index")

# --- Graph store -------------------------------------------------------------
NEO4J_URI = _require("NEO4J_URI")
NEO4J_USERNAME = _optional("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = _require("NEO4J_PASSWORD")

# --- Embeddings --------------------------------------------------------------
# Kept local and free forever. 384 dimensions, matching the existing index.
EMBEDDING_MODEL = _optional("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_DIMENSIONS = 384

# --- LLM providers -----------------------------------------------------------
# A fallback chain rather than a single provider: free tiers are individually
# unreliable and collectively very reliable.
GROQ_API_KEY = _optional("GROQ_API_KEY")
GOOGLE_API_KEY = _optional("GOOGLE_API_KEY")
CEREBRAS_API_KEY = _optional("CEREBRAS_API_KEY")
OPENROUTER_API_KEY = _optional("OPENROUTER_API_KEY")

# Model ids are configuration, not code. Groq retires ids periodically, which
# is the whole reason the fallback chain in llm.py exists. The default here is
# the id this deployment is known to work with; override per environment.
GROQ_MODEL = _optional("GROQ_MODEL", "openai/gpt-oss-120b")
# The fast tier defaults to the same id so there is only ever one model name to
# keep correct. Point it at a smaller model to cut latency on titles and query
# rewrites once you have confirmed that id is live on your account.
GROQ_FAST_MODEL = _optional("GROQ_FAST_MODEL", "") or GROQ_MODEL
GOOGLE_MODEL = _optional("GOOGLE_MODEL", "gemini-2.0-flash")
CEREBRAS_MODEL = _optional("CEREBRAS_MODEL", "llama-3.3-70b")
OPENROUTER_MODEL = _optional("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")

if not any([GROQ_API_KEY, GOOGLE_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY]):
    raise ConfigError(
        "No LLM provider configured. Set at least one of GROQ_API_KEY, "
        "GOOGLE_API_KEY, CEREBRAS_API_KEY or OPENROUTER_API_KEY."
    )

# --- Ingestion ---------------------------------------------------------------
MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 25)
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
MAX_DOCUMENTS_PER_USER = _int("MAX_DOCUMENTS_PER_USER", 5)
CHUNK_SIZE = _int("CHUNK_SIZE", 1100)
CHUNK_OVERLAP = _int("CHUNK_OVERLAP", 180)
ALLOWED_EXTENSIONS = {"pdf", "docx", "pptx", "txt", "md", "csv"}

# --- Retrieval ---------------------------------------------------------------
# Wide recall then aggressive narrowing. A small embedding model needs the
# extra candidates; the fusion and MMR stages put precision back.
RETRIEVAL_CANDIDATES = _int("RETRIEVAL_CANDIDATES", 24)
RETRIEVAL_FINAL_K = _int("RETRIEVAL_FINAL_K", 6)
RETRIEVAL_MIN_SCORE = _float("RETRIEVAL_MIN_SCORE", 0.28)
RETRIEVAL_MMR_LAMBDA = _float("RETRIEVAL_MMR_LAMBDA", 0.72)
MULTI_QUERY_ENABLED = _flag("MULTI_QUERY_ENABLED", True)
MULTI_QUERY_COUNT = _int("MULTI_QUERY_COUNT", 3)
LEXICAL_SEARCH_ENABLED = _flag("LEXICAL_SEARCH_ENABLED", True)

# --- Chat --------------------------------------------------------------------
HISTORY_TURNS = _int("HISTORY_TURNS", 10)

# --- Graph -------------------------------------------------------------------
GRAPH_CACHE_ENABLED = _flag("GRAPH_CACHE_ENABLED", True)
GRAPH_NEIGHBOURHOOD_HOPS = _int("GRAPH_NEIGHBOURHOOD_HOPS", 2)
GRAPH_MAX_TRIPLES_IN_PROMPT = _int("GRAPH_MAX_TRIPLES_IN_PROMPT", 30)
GRAPH_MAX_NODES = _int("GRAPH_MAX_NODES", 60)


def summary() -> dict:
    """Non-secret configuration snapshot, safe to log or expose to admins."""
    return {
        "environment": ENVIRONMENT,
        "embedding_model": EMBEDDING_MODEL,
        "pinecone_index": PINECONE_INDEX_NAME,
        "providers_configured": [
            name
            for name, key in [
                ("groq", GROQ_API_KEY),
                ("google", GOOGLE_API_KEY),
                ("cerebras", CEREBRAS_API_KEY),
                ("openrouter", OPENROUTER_API_KEY),
            ]
            if key
        ],
        "retrieval": {
            "candidates": RETRIEVAL_CANDIDATES,
            "final_k": RETRIEVAL_FINAL_K,
            "min_score": RETRIEVAL_MIN_SCORE,
            "multi_query": MULTI_QUERY_ENABLED,
            "lexical": LEXICAL_SEARCH_ENABLED,
        },
        "limits": {
            "max_upload_mb": MAX_UPLOAD_MB,
            "max_documents_per_user": MAX_DOCUMENTS_PER_USER,
        },
    }
