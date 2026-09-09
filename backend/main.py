"""ArchiveMind AI - application entry point.

Responsibilities kept here and nowhere else: logging setup, CORS, schema
migration on boot, health endpoints, and the exception handler that stops
driver internals leaking to clients.
"""
import logging
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import config

# Logging is configured before the other modules import and start logging.
logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)-24s %(message)s",
    stream=sys.stdout,
)
logging.getLogger("neo4j").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("archivemind")

import auth          # noqa: E402
import database      # noqa: E402
import graph_api     # noqa: E402
import ingestion     # noqa: E402
import llm           # noqa: E402
import querying      # noqa: E402
import schema        # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting ArchiveMind AI (%s)", config.ENVIRONMENT)

    # config.py is imported above before basicConfig runs, so anything it logged
    # at import time would be dropped. It queues its messages instead; this is
    # where they surface.
    for notice in config.STARTUP_NOTICES:
        logger.info(notice)

    try:
        report = schema.apply_schema()
        if report["created"]:
            logger.info("Schema objects created: %s", ", ".join(report["created"]))
        if report["failed"]:
            logger.warning(
                "Schema objects that failed: %s", [f["name"] for f in report["failed"]]
            )
    except Exception as exc:
        # A schema failure degrades lexical search but must not stop the app.
        logger.error("Schema migration could not run: %s", exc)

    # Question logs are a record of what citizens asked a government service.
    # Prune them to the retention window on boot; the analytics routes repeat
    # this at most daily, so no scheduler is required.
    try:
        removed = querying.prune_query_log(force=True)
        logger.info(
            "Query-log retention: %d days, %d expired entries removed.",
            config.QUERY_LOG_RETENTION_DAYS, removed,
        )
    except Exception as exc:
        logger.warning("Query-log pruning failed at startup: %s", exc)

    logger.info("LLM providers: %s", ", ".join(llm.ACTIVE_PROVIDERS) or "none")
    yield
    database.close()
    logger.info("ArchiveMind AI stopped.")


# The interactive docs are genuinely useful in development and are free
# reconnaissance in production: /openapi.json enumerates every route, its
# payload shape and which ones are privileged. Nothing there is secret, but a
# public service need not hand an attacker the map. Any ENVIRONMENT other than
# "production" keeps them.
_docs_enabled = not config.IS_PRODUCTION

app = FastAPI(
    title="ArchiveMind AI API",
    version="2.0.0",
    description="Hybrid GraphRAG over government policy documents.",
    lifespan=lifespan,
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

# Allow explicit CORS origins, Vercel deployments, and standard headers
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request ID and log timing, so a report can be traced to a log line."""
    request_id = str(uuid.uuid4())[:8]
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id
    if request.url.path.startswith("/api"):
        logger.info(
            "%s %s -> %d (%dms) [%s]",
            request.method, request.url.path, response.status_code, elapsed_ms, request_id,
        )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    return JSONResponse(
        status_code=422,
        content={"detail": f"{field}: {first.get('msg', 'is not valid')}"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log the detail, return a generic message.

    Every route used to raise `HTTPException(500, detail=str(e))`, which handed
    Neo4j and Pinecone driver internals straight to the browser.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our side. The error has been logged."},
    )


# --- Routers -----------------------------------------------------------------
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ingestion.router, prefix="/api", tags=["ingestion"])
app.include_router(querying.router, prefix="/api", tags=["querying"])
app.include_router(graph_api.router, prefix="/api/graph", tags=["graph"])


# --- Health ------------------------------------------------------------------
@app.get("/")
def read_root():
    return {"status": "ArchiveMind AI is running", "version": app.version}


@app.get("/health")
def health():
    """Liveness only. Cheap enough for a platform health check to poll."""
    return {"status": "ok"}


# A dependency probe is not free: two network round-trips, and a deep probe
# bills an LLM completion. An open dashboard polls this every 60 seconds, so
# without a cache the badge costs more than the thing it reports on.
_health_cache: dict = {"shallow": (0.0, None), "deep": (0.0, None)}
_health_lock = threading.Lock()


def _probe(deep: bool) -> dict:
    neo4j_status = database.check_neo4j()
    pinecone_status = database.check_pinecone()
    llm_status = llm.ping(deep=deep)

    services = {"neo4j": neo4j_status, "pinecone": pinecone_status, "llm": llm_status}
    down = [name for name, s in services.items() if s.get("status") != "up"]

    return {
        "status": "degraded" if down else "ok",
        "unavailable": down,
        "services": services,
        "depth": "completion" if deep else "configuration",
        # Legacy keys, kept so an older frontend build does not break.
        "pinecone_configured": pinecone_status.get("status") == "up",
        "neo4j_configured": neo4j_status.get("status") == "up",
    }


@app.get("/health/db")
def health_db(
    deep: bool = False,
    _: auth.CurrentUser = Depends(auth.require_admin),
):
    """Real round-trips to every dependency. Administrators only.

    Three things this fixes, all of which were live problems:

    1. It was unauthenticated and `llm.ping()` made a real completion, so anyone
       could loop it to exhaust the free-tier quota - after which every user's
       chat returned 503. An unauthenticated endpoint must never be able to
       spend money.
    2. It is cached, so a dashboard left open does not become a standing cost.
    3. The completion is opt-in via `?deep=1`. The default reports whether the
       provider chain was built, which catches the common failures - a missing
       key, an uninstalled package, a bad model id.

    `/health` stays public and free for the platform's own health check.
    """
    slot = "deep" if deep else "shallow"
    now = time.time()

    with _health_lock:
        cached_at, cached = _health_cache[slot]
        if cached and now - cached_at < config.HEALTH_CACHE_SECONDS:
            return {**cached, "cached": True}

    payload = _probe(deep)

    with _health_lock:
        _health_cache[slot] = (time.time(), payload)
    return {**payload, "cached": False}


@app.get("/health/config")
def health_config(_: auth.CurrentUser = Depends(auth.require_admin)):
    """Non-secret configuration snapshot, useful when debugging a deployment.

    Administrators only. Nothing here is a credential, but it names the index,
    the configured providers, the retrieval tuning and whether an admin access
    code is set - free reconnaissance for anyone deciding where to push.
    """
    return config.summary()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT)
