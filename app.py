import os
import sys

# Ensure backend directory is in sys.path so modules resolve
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

import gradio as gr
from main import app as fastapi_app

# Create a clean status landing page for the Hugging Face Space
with gr.Blocks(title="ArchiveMind AI - API Server") as demo:
    gr.Markdown("# 🧠 ArchiveMind AI — Backend API")
    gr.Markdown(
        "**GraphRAG Cloud Backend is Running.**\n\n"
        "This Hugging Face Space hosts the high-memory (16 GB) FastAPI backend for ArchiveMind AI.\n\n"
        "All REST endpoints (`/api/chat`, `/api/upload`, `/health`, etc.) are actively serving requests."
    )
    with gr.Row():
        status_box = gr.Textbox(
            value="Operational • Pinecone Vector DB • Neo4j AuraDB • Groq LLM",
            label="System Status",
            interactive=False,
        )

# Mount Gradio onto the FastAPI app so both the UI and all REST endpoints work
app = gr.mount_gradio_app(fastapi_app, demo, path="/")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)
