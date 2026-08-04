import os
from dotenv import load_dotenv
from neo4j import GraphDatabase
from pinecone import Pinecone, ServerlessSpec
from langchain_groq import ChatGroq
from langchain_community.embeddings import HuggingFaceEmbeddings

# Load environment variables
load_dotenv(dotenv_path="../.env")

# --- INITIALIZE PINECONE ---
pinecone_api_key = os.getenv("PINECONE_API_KEY")
index_name = os.getenv("PINECONE_INDEX_NAME", "archivemind-index")

pc = Pinecone(api_key=pinecone_api_key)

# We will use HuggingFace embeddings (384 dimensions) just like in the PoC
embeddings_model = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Check if index exists, though the user already created it manually
def get_pinecone_index():
    if index_name not in pc.list_indexes().names():
        raise Exception(f"Pinecone index '{index_name}' not found. Please create it in the dashboard.")
    return pc.Index(index_name)

# --- INITIALIZE NEO4J ---
neo4j_uri = os.getenv("NEO4J_URI")
neo4j_user = os.getenv("NEO4J_USERNAME", "neo4j")
neo4j_password = os.getenv("NEO4J_PASSWORD")

# Create a neo4j driver instance
neo4j_driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))

def test_neo4j_connection():
    try:
        neo4j_driver.verify_connectivity()
        return True
    except Exception as e:
        print(f"Neo4j Connection Error: {e}")
        return False

# --- INITIALIZE GROQ LLM ---
groq_api_key = os.getenv("GROQ_API_KEY")

llm = ChatGroq(
    temperature=0,
    model_name="llama-3.3-70b-versatile", 
    groq_api_key=groq_api_key
)

if __name__ == "__main__":
    # Quick test when running this file directly
    print("Testing Pinecone connection...")
    idx = get_pinecone_index()
    print(f"Pinecone connected! Stats: {idx.describe_index_stats()}")
    
    print("\nTesting Neo4j connection...")
    if test_neo4j_connection():
        print("Neo4j connected successfully!")
    else:
        print("Failed to connect to Neo4j.")
    
    print("\nTesting Groq initialization...")
    print(f"Groq LLM initialized with model: {llm.model_name}")
