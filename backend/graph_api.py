from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import neo4j_driver
from querying import query_pinecone
from ingestion import extraction_chain, parser
from auth import get_current_user

router = APIRouter()

@router.get("/data")
def get_graph_data():
    try:
        with neo4j_driver.session() as session:
            # Fetch all nodes
            nodes_result = session.run("MATCH (n:Entity) RETURN n.id AS id, n.type AS group LIMIT 100")
            nodes = [{"id": record["id"], "group": record["group"]} for record in nodes_result]
            
            # Fetch all relationships (edges)
            edges_result = session.run("MATCH (n:Entity)-[r]->(m:Entity) RETURN n.id AS source, m.id AS target, r.type AS label LIMIT 200")
            links = [{"source": record["source"], "target": record["target"], "label": record["label"]} for record in edges_result]
            
            return {"nodes": nodes, "links": links}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/document/{doc_id}")
def get_document_graph(doc_id: str):
    try:
        with neo4j_driver.session() as session:
            nodes_result = session.run("""
                MATCH (n:Entity)-[:FOUND_IN]->(d:Document {id: $doc_id}) 
                RETURN n.id AS id, n.type AS group LIMIT 300
            """, doc_id=doc_id)
            nodes = [{"id": record["id"], "group": record["group"]} for record in nodes_result]
            
            edges_result = session.run("""
                MATCH (n:Entity)-[:FOUND_IN]->(d:Document {id: $doc_id})
                MATCH (m:Entity)-[:FOUND_IN]->(d)
                MATCH (n)-[r:RELATED_TO]->(m)
                RETURN n.id AS source, m.id AS target, r.type AS label LIMIT 500
            """, doc_id=doc_id)
            links = [{"source": record["source"], "target": record["target"], "label": record["label"]} for record in edges_result]
            
            return {"nodes": nodes, "links": links}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class HighlightRequest(BaseModel):
    query: str
    doc_id: str | None = None

@router.post("/highlight")
async def highlight_graph(request: HighlightRequest, username: str = Depends(get_current_user)):
    try:
        user_query = request.query
        doc_id = request.doc_id
        
        # 1. Get exact context from Pinecone related to query
        vector_context = query_pinecone(user_query, doc_id=doc_id, top_k=3, threshold=0.05)
        
        if not vector_context:
            return {"nodes": [], "edges": []}
            
        # 2. Extract graph specifically from that context
        result = extraction_chain.invoke({
            "query": user_query,
            "text": vector_context,
            "format_instructions": parser.get_format_instructions()
        })
        
        nodes = result.get("nodes", [])
        edges = result.get("edges", [])
        
        # Format links for the frontend
        # (Frontend expects 'source' and 'target')
        formatted_links = []
        for edge in edges:
            formatted_links.append({
                "source": edge.get("source"),
                "target": edge.get("target"),
                "label": edge.get("label", "related_to")
            })
            
        return {"nodes": nodes, "links": formatted_links}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
