"""Neo4j schema: constraints, indexes and the lexical search index.

Run once at startup. Every statement is idempotent (`IF NOT EXISTS`), so this is
safe on every boot and on an already-populated database.

The uniqueness constraints are not cosmetic. Registration previously did a
check-then-create with no constraint, which is a race: two simultaneous signups
for the same username both pass the check and both create a node. The constraint
closes that window at the database level.
"""
import logging

from database import neo4j_driver

logger = logging.getLogger("archivemind.schema")

CONSTRAINTS = [
    ("user_username_unique",
     "CREATE CONSTRAINT user_username_unique IF NOT EXISTS "
     "FOR (u:User) REQUIRE u.username IS UNIQUE"),
    ("document_id_unique",
     "CREATE CONSTRAINT document_id_unique IF NOT EXISTS "
     "FOR (d:Document) REQUIRE d.id IS UNIQUE"),
    ("session_id_unique",
     "CREATE CONSTRAINT session_id_unique IF NOT EXISTS "
     "FOR (s:ChatSession) REQUIRE s.id IS UNIQUE"),
    ("message_id_unique",
     "CREATE CONSTRAINT message_id_unique IF NOT EXISTS "
     "FOR (m:Message) REQUIRE m.id IS UNIQUE"),
    # Entities are keyed on a normalised form so "Article 5", "article 5" and
    # "Art. 5 " collapse into one node instead of three.
    ("entity_key_unique",
     "CREATE CONSTRAINT entity_key_unique IF NOT EXISTS "
     "FOR (e:Entity) REQUIRE e.key IS UNIQUE"),
    ("chunk_id_unique",
     "CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS "
     "FOR (c:Chunk) REQUIRE c.id IS UNIQUE"),
    ("graph_cache_key_unique",
     "CREATE CONSTRAINT graph_cache_key_unique IF NOT EXISTS "
     "FOR (g:GraphCache) REQUIRE g.key IS UNIQUE"),
]

INDEXES = [
    ("document_created_at",
     "CREATE INDEX document_created_at IF NOT EXISTS "
     "FOR (d:Document) ON (d.created_at)"),
    ("session_created_at",
     "CREATE INDEX session_created_at IF NOT EXISTS "
     "FOR (s:ChatSession) ON (s.created_at)"),
    ("message_timestamp",
     "CREATE INDEX message_timestamp IF NOT EXISTS "
     "FOR (m:Message) ON (m.timestamp)"),
    ("chunk_doc_id",
     "CREATE INDEX chunk_doc_id IF NOT EXISTS "
     "FOR (c:Chunk) ON (c.doc_id)"),
    ("query_log_created_at",
     "CREATE INDEX query_log_created_at IF NOT EXISTS "
     "FOR (q:QueryLog) ON (q.created_at)"),
]

# Neo4j's native full-text index gives us the sparse half of hybrid retrieval
# without adding a BM25 dependency or a second service.
FULLTEXT_INDEXES = [
    ("chunk_text_fulltext",
     "CREATE FULLTEXT INDEX chunk_text_fulltext IF NOT EXISTS "
     "FOR (c:Chunk) ON EACH [c.text]"),
    ("entity_name_fulltext",
     "CREATE FULLTEXT INDEX entity_name_fulltext IF NOT EXISTS "
     "FOR (e:Entity) ON EACH [e.id]"),
]


def apply_schema() -> dict:
    """Create everything that is missing. Returns a per-statement report."""
    created, skipped, failed = [], [], []

    with neo4j_driver.session() as session:
        for name, statement in CONSTRAINTS + INDEXES + FULLTEXT_INDEXES:
            try:
                result = session.run(statement)
                counters = result.consume().counters
                touched = counters.constraints_added or counters.indexes_added
                (created if touched else skipped).append(name)
            except Exception as exc:
                # A pre-existing constraint under a different name, or an
                # older Neo4j without full-text support. Never fatal.
                failed.append({"name": name, "error": str(exc)[:200]})
                logger.warning("Schema statement '%s' failed: %s", name, exc)

    logger.info(
        "Schema applied: %d created, %d already present, %d failed",
        len(created), len(skipped), len(failed),
    )
    return {"created": created, "already_present": skipped, "failed": failed}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    import json
    print(json.dumps(apply_schema(), indent=2))
