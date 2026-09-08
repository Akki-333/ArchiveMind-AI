"""The shared archive: listing and removing documents.

Access model: every signed-in person can read every document - that is the
point of a citizen policy portal - and only administrators can add or remove
one.
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException

import graph_store
from auth import CurrentUser, get_current_user, require_admin
from database import index_name, neo4j_driver, pc

logger = logging.getLogger("archivemind.querying")
router = APIRouter()


@router.get("/documents")
def get_user_documents(user: CurrentUser = Depends(get_current_user)):
    """The shared archive. Readable by everyone signed in; writable by admins."""
    with neo4j_driver.session() as session:
        result = session.run(
            """
            MATCH (owner:User)-[:UPLOADED]->(d:Document)
            RETURN d.id AS id, d.filename AS filename, d.summary AS summary,
                   d.key_entities AS key_entities, d.created_at AS created_at,
                   d.document_type AS document_type, d.pages AS pages,
                   d.chunk_count AS chunk_count, owner.username AS uploaded_by
            ORDER BY d.created_at DESC
            """
        )
        documents = [
            {
                "id": r["id"],
                "filename": r["filename"],
                "summary": r["summary"],
                "key_entities": r["key_entities"],
                "created_at": r["created_at"],
                "document_type": r["document_type"] or "Other",
                "pages": r["pages"],
                "chunk_count": r["chunk_count"],
                "uploaded_by": r["uploaded_by"],
                "can_delete": user.is_admin,
            }
            for r in result
        ]
    return {"documents": documents}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, user: CurrentUser = Depends(require_admin)):
    """Remove a document from all three stores. Administrators only."""
    with neo4j_driver.session() as session:
        record = session.run(
            "MATCH (d:Document {id: $doc_id}) "
            "RETURN d.filename AS filename, d.vector_ids AS vector_ids",
            doc_id=doc_id,
        ).single()
        if not record:
            raise HTTPException(status_code=404, detail="That document was not found.")
        filename = record["filename"]
        vector_ids = record["vector_ids"] or []

    # 1. Vectors. Delete by explicit ID, which every Pinecone tier supports.
    # Metadata-filtered deletion is unavailable on some serverless tiers and
    # used to fail silently, leaving orphaned vectors behind.
    vectors_deleted = 0
    warnings: List[str] = []
    try:
        idx = pc.Index(index_name)
        if vector_ids:
            for start in range(0, len(vector_ids), 500):
                idx.delete(ids=vector_ids[start:start + 500])
            vectors_deleted = len(vector_ids)
        else:
            # Documents ingested before IDs were recorded: fall back to the
            # filter, and report honestly if it is unsupported.
            idx.delete(filter={"doc_id": {"$eq": doc_id}})
    except Exception as exc:
        logger.error("Pinecone deletion failed for %s: %s", doc_id, exc)
        warnings.append("Some search-index entries could not be removed and may still appear.")

    # 2. Graph entities and their relationships.
    try:
        graph_store.delete_document_graph(doc_id)
    except Exception as exc:
        logger.error("Graph deletion failed for %s: %s", doc_id, exc)
        warnings.append("Some knowledge-graph entities could not be removed.")

    # 3. Chunks and the document node.
    with neo4j_driver.session() as session:
        session.run("MATCH (c:Chunk {doc_id: $doc_id}) DETACH DELETE c", doc_id=doc_id)
        session.run("MATCH (d:Document {id: $doc_id}) DETACH DELETE d", doc_id=doc_id)

    logger.info("Document '%s' (%s) deleted by %s", filename, doc_id, user.username)
    return {
        "status": "success",
        "message": f"'{filename}' was removed from the archive.",
        "vectors_deleted": vectors_deleted,
        "warnings": warnings,
    }
