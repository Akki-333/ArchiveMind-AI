import os
import sys

# Ensure backend directory is in sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

# ZeroGPU anchor: satisfies Hugging Face ZeroGPU runtime check during startup
try:
    import spaces

    @spaces.GPU
    def zero_gpu_anchor():
        return True

    zero_gpu_anchor()
except Exception:
    pass

import gradio as gr
from fastapi.middleware.cors import CORSMiddleware
from main import app as fastapi_app

# Create a clean status dashboard for the Hugging Face Space
with gr.Blocks(title="ArchiveMind AI - API Server") as demo:
    gr.Markdown("# 🧠 ArchiveMind AI — Backend API")
    gr.Markdown(
        "**GraphRAG Cloud Backend is Running.**\n\n"
        "This Hugging Face Space hosts the high-performance FastAPI backend for ArchiveMind AI.\n\n"
        "All REST endpoints (`/api/chat`, `/api/upload`, `/health`, etc.) are actively serving requests."
    )
    with gr.Row():
        status_box = gr.Textbox(
            value="Operational • Pinecone Vector DB • Neo4j AuraDB • Groq LLM",
            label="System Status",
            interactive=False,
        )

# Mount all FastAPI routes into demo.app
demo.app.include_router(fastapi_app.router)

# Add CORS to demo.app
cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
demo.app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if cors_origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    demo.launch()
