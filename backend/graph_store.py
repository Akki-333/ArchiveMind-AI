"""The knowledge graph itself: writing it, resolving entities, reading it back.

Previously the extraction chain produced clean triples and then threw them away
the moment they were rendered. Nothing accumulated, nothing was queryable, and
`query_neo4j()` returned an empty string, so the "hybrid" half of the pipeline
did not exist. This module is where that is fixed.

Three ideas carry the design:

* **Normalised keys.** Entities merge on a canonical key, so "Article 5",
  "article 5" and "Art. 5" collapse into one node instead of three.
* **Provenance.** Every relationship records the chunks it was extracted from,
  so a user can click an edge and read the sentence that produced it. For a
  policy archive that is the difference between a suggestive picture and
  something an official can act on.
* **Accumulation.** Each query adds to a document's map instead of replacing
  it, so the graph grows the more the archive is used.
"""
import json
import logging
import re
import time
from typing import Dict, Iterable, List, Optional, Sequence

import config
from database import neo4j_driver

logger = logging.getLogger("archivemind.graph_store")

# Abbreviations worth folding together before keying. Deliberately short: an
# aggressive list would merge things that are genuinely distinct.
_ABBREVIATIONS = {
    r"\bart\.?\b": "article",
    r"\bsec\.?\b": "section",
    r"\bcl\.?\b": "clause",
    r"\bsch\.?\b": "schedule",
    r"\bgovt\.?\b": "government",
    r"\bdept\.?\b": "department",
    r"\bmin\.?\b": "ministry",
    r"\bno\.?\b": "number",
}

_PUNCT = re.compile(r"[^\w\s]")
_WHITESPACE = re.compile(r"\s+")
_LUCENE_SPECIALS = re.compile(r'([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)')
_STOP_PREFIXES = ("the ", "a ", "an ")

MAX_PROVENANCE_CHUNKS = 50


def normalise_key(name: str) -> str:
    """Canonical form used to merge entities that are the same thing."""
    if not name:
        return ""
    text = name.strip().lower()
    for pattern, replacement in _ABBREVIATIONS.items():
        text = re.sub(pattern, replacement, text)
    text = _PUNCT.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    for prefix in _STOP_PREFIXES:
        if text.startswith(prefix):
            text = text[len(prefix):]
    return text[:200]


def _clean_label(name: str) -> str:
    return _WHITESPACE.sub(" ", (name or "").strip())[:200]


def _escape_lucene(text: str) -> str:
    return _LUCENE_SPECIALS.sub(r"\\\1", text)


# --- Writing -----------------------------------------------------------------
def save_graph(
    nodes: Sequence[dict],
    edges: Sequence[dict],
    doc_id: str,
    chunk_ids: Optional[Sequence[str]] = None,
) -> dict:
    """Persist an extraction. Idempotent: running it twice adds nothing new."""
    if not doc_id:
        return {"entities": 0, "relations": 0}

    chunk_ids = list(chunk_ids or [])[:MAX_PROVENANCE_CHUNKS]
    now = int(time.time() * 1000)

    # Deduplicate within this batch first, so one payload cannot double-count.
    entity_rows: Dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        raw = node.get("id")
        key = normalise_key(raw or "")
        if not key or len(key) < 2:
            continue
        entity_rows.setdefault(key, {
            "key": key,
            "label": _clean_label(raw),
            "type": _clean_label(node.get("type") or "Concept") or "Concept",
        })

    relation_rows = []
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source_key = normalise_key(edge.get("source") or "")
        target_key = normalise_key(edge.get("target") or "")
        if not source_key or not target_key or source_key == target_key:
            continue
        # The model sometimes references an entity it did not declare. Create
        # it rather than silently dropping the relationship.
        for key, raw in ((source_key, edge.get("source")), (target_key, edge.get("target"))):
            entity_rows.setdefault(key, {
                "key": key,
                "label": _clean_label(raw),
                "type": "Concept",
            })
        relation_rows.append({
            "source": source_key,
            "target": target_key,
            "type": _clean_label(edge.get("label") or "related_to") or "related_to",
        })

    if not entity_rows:
        return {"entities": 0, "relations": 0}

    # Plain Cypher only: APOC is not guaranteed on AuraDB Free.
    entity_cypher = """
        MATCH (d:Document {id: $doc_id})
        UNWIND $entities AS row
        MERGE (e:Entity {key: row.key})
          ON CREATE SET e.id = row.label, e.type = row.type,
                        e.first_seen = $now, e.mentions = 1
          ON MATCH  SET e.mentions = coalesce(e.mentions, 0) + 1,
                        e.type = coalesce(e.type, row.type)
        MERGE (e)-[f:FOUND_IN]->(d)
          ON CREATE SET f.first_seen = $now, f.chunk_ids = $chunk_ids
          ON MATCH  SET f.chunk_ids =
                (coalesce(f.chunk_ids, []) + [c IN $chunk_ids
                    WHERE NOT c IN coalesce(f.chunk_ids, [])])[..$max_chunks]
    """

    relation_cypher = """
        UNWIND $relations AS row
        MATCH (s:Entity {key: row.source})
        MATCH (t:Entity {key: row.target})
        MERGE (s)-[r:RELATED_TO {type: row.type, doc_id: $doc_id}]->(t)
          ON CREATE SET r.weight = 1, r.first_seen = $now, r.chunk_ids = $chunk_ids
          ON MATCH  SET r.weight = coalesce(r.weight, 1) + 1,
                        r.chunk_ids =
                (coalesce(r.chunk_ids, []) + [c IN $chunk_ids
                    WHERE NOT c IN coalesce(r.chunk_ids, [])])[..$max_chunks]
    """

    with neo4j_driver.session() as session:
        session.run(
            entity_cypher,
            doc_id=doc_id,
            entities=list(entity_rows.values()),
            chunk_ids=chunk_ids,
            now=now,
            max_chunks=MAX_PROVENANCE_CHUNKS,
        )
        if relation_rows:
            session.run(
                relation_cypher,
                relations=relation_rows,
                doc_id=doc_id,
                chunk_ids=chunk_ids,
                now=now,
                max_chunks=MAX_PROVENANCE_CHUNKS,
            )

    logger.info(
        "Graph updated for %s: %d entities, %d relations",
        doc_id, len(entity_rows), len(relation_rows),
    )
    return {"entities": len(entity_rows), "relations": len(relation_rows)}


# --- Reading -----------------------------------------------------------------
def get_document_graph(doc_id: str, limit: Optional[int] = None) -> dict:
    """The accumulated map for one document, built from every query so far."""
    limit = limit or config.GRAPH_MAX_NODES
    with neo4j_driver.session() as session:
        nodes = [
            {
                "id": r["id"],
                "key": r["key"],
                "type": r["type"] or "Concept",
                "mentions": r["mentions"] or 1,
            }
            for r in session.run(
                """
                MATCH (e:Entity)-[:FOUND_IN]->(d:Document {id: $doc_id})
                RETURN e.id AS id, e.key AS key, e.type AS type,
                       coalesce(e.mentions, 1) AS mentions
                ORDER BY mentions DESC
                LIMIT $limit
                """,
                doc_id=doc_id, limit=limit,
            )
        ]
        keys = [n["key"] for n in nodes]
        links = []
        if keys:
            links = [
                {
                    "source": r["source"],
                    "target": r["target"],
                    "label": r["label"],
                    "weight": r["weight"] or 1,
                    "chunk_ids": r["chunk_ids"] or [],
                }
                for r in session.run(
                    """
                    MATCH (s:Entity)-[r:RELATED_TO {doc_id: $doc_id}]->(t:Entity)
                    WHERE s.key IN $keys AND t.key IN $keys
                    RETURN s.id AS source, t.id AS target, r.type AS label,
                           r.weight AS weight, r.chunk_ids AS chunk_ids
                    ORDER BY r.weight DESC
                    LIMIT $limit
                    """,
                    doc_id=doc_id, keys=keys, limit=limit * 4,
                )
            ]
    return {"nodes": nodes, "links": links}


def _find_seed_entities(query: str, doc_id: Optional[str], limit: int = 8) -> List[str]:
    """Entities whose names match the query, used as graph traversal seeds."""
    terms = re.findall(r"[A-Za-z0-9][A-Za-z0-9._-]{2,}", query)[:10]
    if not terms:
        return []
    lucene = " OR ".join(_escape_lucene(t) for t in terms)
    cypher = """
        CALL db.index.fulltext.queryNodes('entity_name_fulltext', $lucene)
        YIELD node, score
        WHERE $doc_id IS NULL OR EXISTS {
            MATCH (node)-[:FOUND_IN]->(:Document {id: $doc_id})
        }
        RETURN node.key AS key
        ORDER BY score DESC
        LIMIT $limit
    """
    try:
        with neo4j_driver.session() as session:
            return [
                r["key"]
                for r in session.run(cypher, lucene=lucene, doc_id=doc_id, limit=limit)
            ]
    except Exception as exc:
        logger.info("Entity seed lookup unavailable (%s).", type(exc).__name__)
        return []


def neighbourhood_triples(
    query: str,
    doc_id: Optional[str] = None,
    hops: Optional[int] = None,
    limit: Optional[int] = None,
) -> List[str]:
    """Triples around the entities the query mentions.

    This is the graph half of GraphRAG: the vector store finds relevant text,
    the graph explains how the things in that text relate to one another.
    """
    hops = max(1, min(hops or config.GRAPH_NEIGHBOURHOOD_HOPS, 3))
    limit = limit or config.GRAPH_MAX_TRIPLES_IN_PROMPT

    seeds = _find_seed_entities(query, doc_id)
    if not seeds:
        return []

    # A variable-length bound cannot be parameterised, so the validated integer
    # is interpolated instead.
    cypher = f"""
        MATCH (seed:Entity) WHERE seed.key IN $seeds
        MATCH path = (seed)-[:RELATED_TO*1..{hops}]-(other:Entity)
        WHERE $doc_id IS NULL OR EXISTS {{
            MATCH (other)-[:FOUND_IN]->(:Document {{id: $doc_id}})
        }}
        UNWIND relationships(path) AS rel
        WITH DISTINCT startNode(rel) AS s, endNode(rel) AS t, rel
        RETURN s.id AS source, rel.type AS label, t.id AS target,
               coalesce(rel.weight, 1) AS weight
        ORDER BY weight DESC
        LIMIT $limit
    """
    try:
        with neo4j_driver.session() as session:
            records = list(session.run(cypher, seeds=seeds, doc_id=doc_id, limit=limit))
    except Exception as exc:
        logger.warning("Neighbourhood query failed: %s", exc)
        return []

    return [f"{r['source']} --[{r['label']}]--> {r['target']}" for r in records]


def graph_context(query: str, doc_id: Optional[str] = None) -> str:
    """Formatted triples for the chat prompt. Empty string when there is nothing."""
    triples = neighbourhood_triples(query, doc_id)
    if not triples:
        return ""
    return "\n".join(f"- {t}" for t in triples)


# --- Cache -------------------------------------------------------------------
def _cache_key(doc_id: Optional[str], query: str) -> str:
    return f"{doc_id or 'all'}::{normalise_key(query)}"


def cache_get(doc_id: Optional[str], query: str) -> Optional[dict]:
    if not config.GRAPH_CACHE_ENABLED:
        return None
    try:
        with neo4j_driver.session() as session:
            record = session.run(
                "MATCH (g:GraphCache {key: $key}) RETURN g.payload AS payload",
                key=_cache_key(doc_id, query),
            ).single()
        if record and record["payload"]:
            return json.loads(record["payload"])
    except Exception as exc:
        logger.debug("Graph cache read failed: %s", exc)
    return None


def cache_put(doc_id: Optional[str], query: str, payload: dict) -> None:
    if not config.GRAPH_CACHE_ENABLED:
        return
    try:
        with neo4j_driver.session() as session:
            session.run(
                "MERGE (g:GraphCache {key: $key}) "
                "SET g.payload = $payload, g.updated_at = $now, g.doc_id = $doc_id",
                key=_cache_key(doc_id, query),
                payload=json.dumps(payload)[:60000],
                doc_id=doc_id,
                now=int(time.time() * 1000),
            )
    except Exception as exc:
        logger.debug("Graph cache write failed: %s", exc)


def invalidate_document_cache(doc_id: str) -> None:
    try:
        with neo4j_driver.session() as session:
            session.run("MATCH (g:GraphCache {doc_id: $doc_id}) DELETE g", doc_id=doc_id)
    except Exception as exc:
        logger.debug("Graph cache invalidation failed: %s", exc)


# --- Statistics --------------------------------------------------------------
def graph_stats(doc_ids: Optional[Iterable[str]] = None) -> dict:
    """Real graph counts, replacing the summary-derived numbers on the dashboard."""
    doc_list = list(doc_ids) if doc_ids is not None else None
    try:
        with neo4j_driver.session() as session:
            record = session.run(
                """
                MATCH (e:Entity)-[:FOUND_IN]->(d:Document)
                WHERE $doc_ids IS NULL OR d.id IN $doc_ids
                WITH collect(DISTINCT e) AS entities
                UNWIND (CASE WHEN size(entities) = 0 THEN [null] ELSE entities END) AS e
                OPTIONAL MATCH (e)-[r:RELATED_TO]->(:Entity)
                RETURN count(DISTINCT e) AS entities, count(DISTINCT r) AS relations
                """,
                doc_ids=doc_list,
            ).single()
    except Exception as exc:
        logger.warning("graph_stats failed: %s", exc)
        return {"entities": 0, "relations": 0}

    return {
        "entities": (record["entities"] if record else 0) or 0,
        "relations": (record["relations"] if record else 0) or 0,
    }


def top_entities(doc_ids: Optional[Iterable[str]] = None, limit: int = 15) -> List[dict]:
    doc_list = list(doc_ids) if doc_ids is not None else None
    cypher = """
        MATCH (e:Entity)-[:FOUND_IN]->(d:Document)
        WHERE $doc_ids IS NULL OR d.id IN $doc_ids
        RETURN e.id AS name, e.type AS type, coalesce(e.mentions, 1) AS count
        ORDER BY count DESC, name ASC
        LIMIT $limit
    """
    try:
        with neo4j_driver.session() as session:
            return [
                {"name": r["name"], "type": r["type"] or "Concept", "count": r["count"]}
                for r in session.run(cypher, doc_ids=doc_list, limit=limit)
            ]
    except Exception as exc:
        logger.warning("top_entities failed: %s", exc)
        return []


def delete_document_graph(doc_id: str) -> None:
    """Remove a document's entities, dropping any that become orphaned."""
    with neo4j_driver.session() as session:
        session.run(
            "MATCH (:Entity)-[r:RELATED_TO {doc_id: $doc_id}]->(:Entity) DELETE r",
            doc_id=doc_id,
        )
        session.run(
            """
            MATCH (e:Entity)-[f:FOUND_IN]->(:Document {id: $doc_id})
            DELETE f
            WITH e
            WHERE NOT (e)-[:FOUND_IN]->(:Document)
            DETACH DELETE e
            """,
            doc_id=doc_id,
        )
    invalidate_document_cache(doc_id)
