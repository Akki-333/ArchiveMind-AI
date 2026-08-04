from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from dotenv import load_dotenv

# Load environment variables FIRST before importing other local modules
load_dotenv(dotenv_path="../.env")

import ingestion
import querying
import graph_api
import auth

app = FastAPI(title="ArchiveMind AI API")

# Allow the React frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "ArchiveMind AI Backend is Running!"}

# Register the ingestion routes
app.include_router(ingestion.router, prefix="/api", tags=["ingestion"])

# Register the querying (chat) routes
app.include_router(querying.router, prefix="/api", tags=["querying"])

# Register the graph visualization routes
app.include_router(graph_api.router, prefix="/api/graph", tags=["graph"])

# Register the auth routes
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

@app.get("/health/db")
def check_db_connections():
    """Endpoint to verify if the API keys in .env are loaded correctly."""
    pinecone_key = os.getenv("PINECONE_API_KEY")
    neo4j_uri = os.getenv("NEO4J_URI")
    
    return {
        "pinecone_configured": bool(pinecone_key and pinecone_key != "your_pinecone_api_key_here"),
        "neo4j_configured": bool(neo4j_uri and neo4j_uri != "neo4j+s://your_uri_here.databases.neo4j.io")
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
