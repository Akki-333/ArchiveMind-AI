"""Knowledge graph endpoints.

Every route here is authenticated - `/data` and `/document/{id}` previously had
no dependency at all - and every route now reads or writes a graph that
actually persists.

The important behavioural change is in `/highlight`: an extraction is saved
before it is returned, and served from cache on a repeat. The graph therefore
accumulates as the archive is used instead of being rebuilt and discarded on
every click, which also means the same question renders the same picture twice.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

import graph_store
import retrieval
from auth import CurrentUser, get_current_user
from database import neo4j_driver
from ingestion import extraction_chain, parser

logger = logging.getLogger("archivemind.graph_api")
router = APIRouter()


class HighlightRequest(BaseModel):
    query: str
    doc_id: Optional[str] = None
    refresh: bool = False


@router.get("/data")
def get_graph_data(
    limit: int = Query(120, ge=10, le=500),
    _: CurrentUser = Depends(get_current_user),
):
    """The whole accumulated graph across every document."""
    try:
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
                    MATCH (e:Entity)
                    RETURN e.id AS id, e.key AS key, e.type AS type,
                           coalesce(e.mentions, 1) AS mentions
                    ORDER BY mentions DESC
                    LIMIT $limit
                    """,
                    limit=limit,
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
                    }
                    for r in session.run(
                        """
                        MATCH (s:Entity)-[r:RELATED_TO]->(t:Entity)
                        WHERE s.key IN $keys AND t.key IN $keys
                        RETURN s.id AS source, t.id AS target, r.type AS label,
                               r.weight AS weight
                        ORDER BY r.weight DESC
                        LIMIT $limit
                        """,
                        keys=keys, limit=limit * 4,
                    )
                ]
        return {"nodes": nodes, "links": links}
    except Exception:
        logger.exception("Graph data query failed")
        raise HTTPException(status_code=500, detail="The knowledge graph could not be read.")


@router.get("/document/{doc_id}")
def get_document_graph(
    doc_id: str,
    limit: int = Query(60, ge=10, le=300),
    _: CurrentUser = Depends(get_current_user),
):
    """A document's accumulated map, built up from every question asked of it.

    This endpoint used to match `:Entity` nodes that were never created, so it
    returned an empty result forever. It is now the "whole document" view that
    sits alongside the per-query focus view.
    """
    try:
        return graph_store.get_document_graph(doc_id, limit=limit)
    except Exception:
        logger.exception("Document graph query failed for %s", doc_id)
        raise HTTPException(status_code=500, detail="That document's graph could not be read.")


@router.post("/highlight")
def highlight_graph(
    request: HighlightRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Extract the graph for one question, persist it, and return it."""
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Ask something first.")

    doc_id = request.doc_id
    started = time.perf_counter()

    # Served from cache unless the caller explicitly asks for a rebuild. Same
    # question, same picture - and no LLM call.
    if not request.refresh:
        cached = graph_store.cache_get(doc_id, query)
        if cached:
            cached["cached"] = True
            cached["elapsed_seconds"] = round(time.perf_counter() - started, 2)
            return cached

    passages = retrieval.retrieve(query, doc_id=doc_id, final_k=5, condense=False)
    if not passages:
        return {
            "nodes": [], "links": [], "cached": False,
            "saved": {"entities": 0, "relations": 0},
        }

    context = retrieval.format_context(passages)
    chunk_ids = [p.chunk_id for p in passages]

    try:
        result = extraction_chain.invoke({
            "query": query,
            "text": context,
            "format_instructions": parser.get_format_instructions(),
        })
    except Exception:
        logger.exception("Graph extraction failed")
        raise HTTPException(
            status_code=503,
            detail="The graph could not be extracted right now. Please try again shortly.",
        )

    raw_nodes = result.get("nodes") or []
    raw_edges = result.get("edges") or []

    # Persist before returning. This is the line whose absence meant the
    # knowledge graph never existed.
    saved = {"entities": 0, "relations": 0}
    if doc_id:
        try:
            saved = graph_store.save_graph(raw_nodes, raw_edges, doc_id, chunk_ids)
        except Exception as exc:
            logger.error("Graph persistence failed for %s: %s", doc_id, exc)

    nodes = [
        {"id": n.get("id"), "type": n.get("type") or "Concept"}
        for n in raw_nodes
        if isinstance(n, dict) and n.get("id")
    ]
    known = {n["id"] for n in nodes}
    links = [
        {
            "source": e.get("source"),
            "target": e.get("target"),
            "label": e.get("label") or "related_to",
        }
        for e in raw_edges
        if isinstance(e, dict) and e.get("source") in known and e.get("target") in known
    ]

    payload = {
        "nodes": nodes,
        "links": links,
        "chunk_ids": chunk_ids,
        "saved": saved,
        "cached": False,
        "elapsed_seconds": round(time.perf_counter() - started, 2),
    }
    graph_store.cache_put(doc_id, query, payload)
    return payload


@router.get("/entity/{entity_key}/expand")
def expand_entity(
    entity_key: str,
    doc_id: Optional[str] = None,
    limit: int = Query(20, ge=1, le=60),
    _: CurrentUser = Depends(get_current_user),
):
    """One entity's direct neighbours, for click-to-expand in the explorer."""
    cypher = """
        MATCH (e:Entity {key: $key})-[r:RELATED_TO]-(other:Entity)
        WHERE $doc_id IS NULL OR r.doc_id = $doc_id
        RETURN other.id AS neighbour, other.key AS neighbour_key,
               other.type AS neighbour_type,
               r.type AS label, coalesce(r.weight, 1) AS weight,
               startNode(r).id AS source, endNode(r).id AS target
        ORDER BY weight DESC
        LIMIT $limit
    """
    try:
        with neo4j_driver.session() as session:
            records = list(session.run(
                cypher,
                key=graph_store.normalise_key(entity_key),
                doc_id=doc_id,
                limit=limit,
            ))
    except Exception:
        logger.exception("Entity expansion failed for %s", entity_key)
        raise HTTPException(status_code=500, detail="That entity could not be expanded.")

    nodes = {}
    links = []
    for r in records:
        nodes[r["neighbour"]] = {
            "id": r["neighbour"],
            "key": r["neighbour_key"],
            "type": r["neighbour_type"] or "Concept",
        }
        links.append({"source": r["source"], "target": r["target"], "label": r["label"]})

    return {"nodes": list(nodes.values()), "links": links}


@router.get("/provenance")
def relationship_provenance(
    source: str,
    target: str,
    doc_id: Optional[str] = None,
    _: CurrentUser = Depends(get_current_user),
):
    """The passages a relationship was extracted from.

    Click an edge, read the sentence that produced it. For an LLM-extracted
    graph in a policy archive this is what makes the picture citable rather
    than merely suggestive.
    """
    source_key = graph_store.normalise_key(source)
    target_key = graph_store.normalise_key(target)

    try:
        with neo4j_driver.session() as session:
            record = session.run(
                """
                MATCH (s:Entity {key: $source_key})-[r:RELATED_TO]-(t:Entity {key: $target_key})
                WHERE $doc_id IS NULL OR r.doc_id = $doc_id
                RETURN r.chunk_ids AS chunk_ids, r.type AS label, r.doc_id AS doc_id
                LIMIT 1
                """,
                source_key=source_key, target_key=target_key, doc_id=doc_id,
            ).single()

            if not record:
                raise HTTPException(status_code=404, detail="That relationship was not found.")

            chunk_ids = record["chunk_ids"] or []
            passages = []
            if chunk_ids:
                passages = [
                    {
                        "chunk_id": c["id"],
                        "text": c["text"],
                        "page": c["page"],
                        "source": c["source"],
                    }
                    for c in session.run(
                        """
                        MATCH (c:Chunk) WHERE c.id IN $chunk_ids
                        RETURN c.id AS id, c.text AS text, c.page AS page,
                               c.source AS source, c.index AS index
                        ORDER BY c.index ASC
                        LIMIT 5
                        """,
                        chunk_ids=chunk_ids,
                    )
                ]
            label = record["label"]
            record_doc_id = record["doc_id"]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Provenance lookup failed")
        raise HTTPException(status_code=500, detail="The source passages could not be read.")

    return {
        "source": source,
        "target": target,
        "label": label,
        "doc_id": record_doc_id,
        "passages": passages,
    }
