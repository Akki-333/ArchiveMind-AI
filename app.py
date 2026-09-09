import os
import sys

# ZeroGPU initialization: must be performed before heavy framework imports
try:
    import spaces
    if hasattr(spaces, "zero") and hasattr(spaces.zero, "startup"):
        spaces.zero.startup()


    @spaces.GPU(duration=1)
    def zero_gpu_anchor():
        return True
except Exception:
    def zero_gpu_anchor():
        return True

# Ensure backend directory is in sys.path
backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "backend"))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

import gradio as gr
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError


import auth
import config
import graph_api
import ingestion
import querying
import schema
from main import (
    health as main_health,
    health_db as main_health_db,
    health_config as main_health_config,
    http_exception_handler,
    validation_exception_handler,
    unhandled_exception_handler,
)

# Run schema migrations
try:
    schema.apply_schema()
except Exception as e:
    print(f"Startup schema note: {e}")

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
        gpu_btn = gr.Button("Check", visible=False)
        gpu_btn.click(fn=zero_gpu_anchor, outputs=None)

# Configure CORS middleware
cors_middleware = Middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

def start_server():
    port = int(os.getenv("PORT", 7860))
    demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        strict_cors=False,
        app_kwargs={"middleware": [cors_middleware]},
    )

    # Attach all FastAPI routers directly to the active server app (both root and /gradio_api)
    for pfx in ["", "/gradio_api"]:
        demo.app.include_router(auth.router, prefix=f"{pfx}/api/auth", tags=["auth"])
        demo.app.include_router(ingestion.router, prefix=f"{pfx}/api", tags=["ingestion"])
        demo.app.include_router(querying.router, prefix=f"{pfx}/api", tags=["querying"])
        demo.app.include_router(graph_api.router, prefix=f"{pfx}/api/graph", tags=["graph"])

        tag = pfx.replace("/", "_") or "_root"
        demo.app.add_api_route(f"{pfx}/health", main_health, methods=["GET"], name=f"health{tag}")
        demo.app.add_api_route(f"{pfx}/health/db", main_health_db, methods=["GET"], name=f"health_db{tag}")
        demo.app.add_api_route(f"{pfx}/health/config", main_health_config, methods=["GET"], name=f"health_config{tag}")
        demo.app.add_api_route(f"{pfx}/api/status", main_health, methods=["GET"], name=f"status{tag}")

    # Exception handlers
    demo.app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    demo.app.add_exception_handler(RequestValidationError, validation_exception_handler)
    demo.app.add_exception_handler(Exception, unhandled_exception_handler)

    demo.block_thread()

if __name__ == "__main__":
    start_server()



