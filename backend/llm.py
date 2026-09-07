"""Provider-agnostic LLM access with automatic failover.

No single free tier is reliable: quotas get hit, model IDs get retired, regions
go down. Rather than binding the whole application to one provider, we build a
chain and let LangChain fall through it. Adding or removing a provider is an
environment change, not a code change.

Two tiers are exposed:
    smart_llm - answers, entity extraction, comparisons. Quality matters.
    fast_llm  - titles, query rewrites, classification. Latency and cost matter.
"""
import logging
import time
from typing import List, Tuple

import config

logger = logging.getLogger("archivemind.llm")

# Which providers actually constructed successfully, in priority order.
ACTIVE_PROVIDERS: List[str] = []


def _build_groq(model: str):
    if not config.GROQ_API_KEY:
        return None
    try:
        from langchain_groq import ChatGroq
    except ImportError:
        logger.warning("langchain-groq is not installed; skipping Groq.")
        return None
    return ChatGroq(
        model=model,
        temperature=0,
        groq_api_key=config.GROQ_API_KEY,
        max_retries=1,
        timeout=60,
    )


def _build_google(model: str):
    if not config.GOOGLE_API_KEY:
        return None
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
    except ImportError:
        logger.info("langchain-google-genai is not installed; skipping Gemini.")
        return None
    return ChatGoogleGenerativeAI(
        model=model,
        temperature=0,
        google_api_key=config.GOOGLE_API_KEY,
        max_retries=1,
        timeout=60,
    )


def _build_cerebras(model: str):
    if not config.CEREBRAS_API_KEY:
        return None
    try:
        from langchain_cerebras import ChatCerebras
    except ImportError:
        logger.info("langchain-cerebras is not installed; skipping Cerebras.")
        return None
    return ChatCerebras(
        model=model,
        temperature=0,
        api_key=config.CEREBRAS_API_KEY,
        max_retries=1,
        timeout=60,
    )


def _build_openrouter(model: str):
    if not config.OPENROUTER_API_KEY:
        return None
    try:
        from langchain_openai import ChatOpenAI
    except ImportError:
        logger.info("langchain-openai is not installed; skipping OpenRouter.")
        return None
    return ChatOpenAI(
        model=model,
        temperature=0,
        api_key=config.OPENROUTER_API_KEY,
        base_url="https://openrouter.ai/api/v1",
        max_retries=1,
        timeout=60,
    )


def _chain(specs: List[Tuple[str, object]], label: str):
    """Build a primary model with the remaining specs as ordered fallbacks."""
    built = []
    for name, factory in specs:
        try:
            model = factory()
        except Exception as exc:  # a bad key or an unknown model id
            logger.warning("Provider '%s' failed to initialise: %s", name, exc)
            continue
        if model is not None:
            built.append((name, model))

    if not built:
        raise RuntimeError(
            "No LLM provider could be initialised. Check your API keys and that "
            "the corresponding langchain integration package is installed."
        )

    names = [n for n, _ in built]
    logger.info("%s chain: %s", label, " -> ".join(names))
    for n in names:
        if n not in ACTIVE_PROVIDERS:
            ACTIVE_PROVIDERS.append(n)

    primary = built[0][1]
    fallbacks = [m for _, m in built[1:]]
    return primary.with_fallbacks(fallbacks) if fallbacks else primary


smart_llm = _chain(
    [
        ("groq", lambda: _build_groq(config.GROQ_MODEL)),
        ("google", lambda: _build_google(config.GOOGLE_MODEL)),
        ("cerebras", lambda: _build_cerebras(config.CEREBRAS_MODEL)),
        ("openrouter", lambda: _build_openrouter(config.OPENROUTER_MODEL)),
    ],
    "smart",
)

fast_llm = _chain(
    [
        ("groq", lambda: _build_groq(config.GROQ_FAST_MODEL)),
        ("google", lambda: _build_google(config.GOOGLE_MODEL)),
        ("cerebras", lambda: _build_cerebras(config.CEREBRAS_MODEL)),
        ("openrouter", lambda: _build_openrouter(config.OPENROUTER_MODEL)),
    ],
    "fast",
)

# Backwards-compatible alias for modules that previously imported `llm`.
llm = smart_llm


def ping() -> dict:
    """Cheap liveness probe for the health endpoint. Never raises."""
    started = time.perf_counter()
    try:
        response = fast_llm.invoke("Reply with the single word: ok")
        text = getattr(response, "content", str(response))
        return {
            "status": "up",
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "providers": ACTIVE_PROVIDERS,
            "sample": str(text)[:40],
        }
    except Exception as exc:
        return {
            "status": "down",
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "providers": ACTIVE_PROVIDERS,
            "error": type(exc).__name__,
        }
