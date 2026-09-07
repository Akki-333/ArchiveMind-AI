"""Connections to the three stores: Pinecone (dense), Neo4j (graph + lexical),
and the local embedding model.

The embedding model stays local and free: `all-MiniLM-L6-v2` costs nothing, has
no quota and no vendor. Answer quality is recovered further up the stack, in
retrieval.py, rather than by paying for a bigger embedder.
"""
import logging
import time

from neo4j import GraphDatabase
from pinecone import Pinecone

import config

logger = logging.getLogger("archivemind.database")

# --- Pinecone ----------------------------------------------------------------
pc = Pinecone(api_key=config.PINECONE_API_KEY)
index_name = config.PINECONE_INDEX_NAME

# --- Embeddings --------------------------------------------------------------
_embeddings_model = None


def get_embeddings():
    """Lazy-load the sentence-transformer so the port binds before the download.

    Prefers the maintained `langchain-huggingface` package and falls back to the
    deprecated community import so an older install keeps working.
    """
    global _embeddings_model
    if _embeddings_model is None:
        logger.info("Loading embedding model '%s'...", config.EMBEDDING_MODEL)
        started = time.perf_counter()
        try:
            from langchain_huggingface import HuggingFaceEmbeddings
        except ImportError:  # pragma: no cover - legacy environments
            from langchain_community.embeddings import HuggingFaceEmbeddings
            logger.warning(
                "Using deprecated langchain_community embeddings. "
                "Install langchain-huggingface to silence this."
            )
        _embeddings_model = HuggingFaceEmbeddings(
            model_name=config.EMBEDDING_MODEL,
            encode_kwargs={"normalize_embeddings": True},
        )
        logger.info("Embedding model ready in %.1fs", time.perf_counter() - started)
    return _embeddings_model


def get_pinecone_index():
    if index_name not in pc.list_indexes().names():
        raise RuntimeError(
            f"Pinecone index '{index_name}' not found. Create it with "
            f"{config.EMBEDDING_DIMENSIONS} dimensions and the cosine metric."
        )
    return pc.Index(index_name)


# --- Neo4j -------------------------------------------------------------------
neo4j_driver = GraphDatabase.driver(
    config.NEO4J_URI,
    auth=(config.NEO4J_USERNAME, config.NEO4J_PASSWORD),
    max_connection_lifetime=300,
)


def test_neo4j_connection() -> bool:
    try:
        neo4j_driver.verify_connectivity()
        return True
    except Exception as exc:
        logger.error("Neo4j connection error: %s", exc)
        return False


# --- Health probes -----------------------------------------------------------
def check_neo4j() -> dict:
    """Real round-trip, not an environment-variable check."""
    started = time.perf_counter()
    try:
        with neo4j_driver.session() as session:
            session.run("RETURN 1 AS ok").single()
        return {"status": "up", "latency_ms": int((time.perf_counter() - started) * 1000)}
    except Exception as exc:
        return {
            "status": "down",
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": type(exc).__name__,
        }


def check_pinecone() -> dict:
    started = time.perf_counter()
    try:
        stats = get_pinecone_index().describe_index_stats()
        return {
            "status": "up",
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "vectors": stats.get("total_vector_count", 0),
        }
    except Exception as exc:
        return {
            "status": "down",
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": type(exc).__name__,
        }


def close() -> None:
    try:
        neo4j_driver.close()
    except Exception:
        pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("Pinecone:", check_pinecone())
    print("Neo4j:   ", check_neo4j())
