"""Document ingestion: parse, chunk, embed, index, profile.

Three changes matter here beyond the obvious cleanup:

* The route is a plain `def`, not `async def`. Everything it does - PDF
  parsing, embedding, the Neo4j driver, the LLM call - is synchronous and
  slow. On the event loop that froze every other request in the process for
  the duration of an upload. As a sync route FastAPI runs it in a threadpool
  and concurrency is restored.
* Chunks are stored in Neo4j as well as Pinecone. That gives us lexical search,
  citation provenance, and a way to delete vectors by explicit ID rather than
  relying on metadata-filtered deletion that not every Pinecone tier supports.
* Page numbers survive chunking, so an answer can cite "p. 12" instead of
  gesturing vaguely at a filename.
"""
import io
import json
import logging
import time
import uuid
from typing import List, Tuple

import docx
import PyPDF2
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from langchain_core.documents import Document
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_pinecone import PineconeVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pptx import Presentation

import config
import graph_store
import ratelimit
from auth import CurrentUser, require_admin
from database import get_embeddings, index_name, neo4j_driver
from llm import fast_llm, smart_llm

logger = logging.getLogger("archivemind.ingestion")
router = APIRouter()

# --- Extraction chain --------------------------------------------------------
parser = JsonOutputParser()
extraction_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You extract a knowledge graph from government policy documents.\n"
     "Identify the entities the user's question is actually about - schemes, "
     "articles, clauses, organisations, eligibility criteria, benefits, "
     "obligations, amounts, dates - and how they relate.\n\n"
     "RULES:\n"
     "1. Only extract entities that appear explicitly in the provided text.\n"
     "2. Only extract what is relevant to the user's question.\n"
     "3. Entity names must be short noun phrases, at most six words. Never put "
     "a whole sentence in a node.\n"
     "4. Relationship labels must be two or three words in lower snake_case, "
     "for example 'provides_benefit' or 'requires'.\n"
     "5. Give every entity a `type` from: Scheme, Provision, Organisation, "
     "Person, Beneficiary, Benefit, Requirement, Amount, Date, Location, Concept.\n"
     "6. Prefer a connected graph: relate new entities back to the main subject "
     "rather than leaving isolated nodes.\n"
     "7. If the question is a greeting or the text has no relevant entities, "
     "return empty lists.\n\n"
     "Return ONLY valid JSON:\n"
     "{{\"nodes\": [{{\"id\": \"Entity Name\", \"type\": \"Category\"}}], "
     "\"edges\": [{{\"source\": \"A\", \"target\": \"B\", \"label\": \"relation\"}}]}}\n\n"
     "{format_instructions}"),
    ("human", "Question: {query}\n\nText:\n\n{text}"),
])
extraction_chain = extraction_prompt | smart_llm | parser

# --- Overview chain ----------------------------------------------------------
overview_parser = JsonOutputParser()
overview_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You profile a government policy document for a research archive.\n"
     "Return ONLY valid JSON with:\n"
     "  summary       - 2 to 3 sentences describing what this document does and "
     "who it affects. Concrete, no filler.\n"
     "  key_entities  - 5 to 10 specific names: schemes, bodies, provisions. "
     "Never generic words like 'document' or 'data'.\n"
     "  document_type - one of: Act, Rule, Scheme, Circular, Report, "
     "Guideline, Budget, Other.\n\n"
     "{format_instructions}"),
    ("human", "Document opening:\n\n{text}"),
])
overview_chain = overview_prompt | fast_llm | overview_parser


# --- Text extraction ---------------------------------------------------------
def _extract_pages(contents: bytes, ext: str) -> List[Tuple[int, str]]:
    """Return [(page_number, text)] so page numbers survive into citations."""
    pages: List[Tuple[int, str]] = []

    if ext == "pdf":
        reader = PyPDF2.PdfReader(io.BytesIO(contents))
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception as exc:
                logger.warning("Page %d could not be read: %s", number, exc)
                text = ""
            if text.strip():
                pages.append((number, text))

    elif ext == "docx":
        document = docx.Document(io.BytesIO(contents))
        paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
        for table in document.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    paragraphs.append(" | ".join(cells))
        if paragraphs:
            pages.append((1, "\n".join(paragraphs)))

    elif ext == "pptx":
        presentation = Presentation(io.BytesIO(contents))
        for number, slide in enumerate(presentation.slides, start=1):
            parts = [
                shape.text for shape in slide.shapes
                if hasattr(shape, "text") and shape.text.strip()
            ]
            if parts:
                pages.append((number, "\n".join(parts)))

    else:  # txt, md, csv
        text = contents.decode("utf-8", errors="ignore")
        if text.strip():
            pages.append((1, text))

    return pages


# Policy documents have real structure. Splitting on it keeps clauses intact
# instead of cutting a sentence in half at an arbitrary character count.
_SPLITTER = RecursiveCharacterTextSplitter(
    chunk_size=config.CHUNK_SIZE,
    chunk_overlap=config.CHUNK_OVERLAP,
    separators=[
        "\n\nCHAPTER ", "\n\nChapter ",
        "\n\nPART ", "\n\nPart ",
        "\n\nSECTION ", "\n\nSection ",
        "\n\nARTICLE ", "\n\nArticle ",
        "\n\nClause ", "\n\nSchedule ",
        "\n\n", "\n", ". ", " ", "",
    ],
    length_function=len,
)


def _chunk_pages(pages: List[Tuple[int, str]], doc_id: str, filename: str) -> List[dict]:
    """Chunk within each page so every chunk keeps a real page number."""
    chunks: List[dict] = []
    index = 0
    for page_number, page_text in pages:
        for piece in _SPLITTER.split_text(page_text):
            cleaned = piece.strip()
            if len(cleaned) < 40:  # headers, page numbers, stray fragments
                continue
            chunks.append({
                "id": f"{doc_id}:{index}",
                "text": cleaned,
                "page": page_number,
                "index": index,
                "source": filename,
                "doc_id": doc_id,
            })
            index += 1
    return chunks


# --- Persistence -------------------------------------------------------------
def _store_chunks_in_neo4j(chunks: List[dict], doc_id: str) -> None:
    """Chunks live in Neo4j too: lexical search, provenance, reliable delete."""
    with neo4j_driver.session() as session:
        for start in range(0, len(chunks), 100):
            batch = chunks[start:start + 100]
            session.run(
                """
                MATCH (d:Document {id: $doc_id})
                UNWIND $chunks AS row
                MERGE (c:Chunk {id: row.id})
                SET c.text = row.text, c.page = row.page, c.index = row.index,
                    c.source = row.source, c.doc_id = row.doc_id
                MERGE (c)-[:PART_OF]->(d)
                """,
                doc_id=doc_id, chunks=batch,
            )


def save_to_neo4j(nodes, edges, doc_id, chunk_ids=None):
    """Kept for backwards compatibility; delegates to the graph store."""
    return graph_store.save_graph(nodes, edges, doc_id, chunk_ids)


# --- Route -------------------------------------------------------------------
def _read_capped(upload: UploadFile, limit: int) -> bytes:
    """Read at most `limit` bytes, refusing anything larger.

    The previous version did `file.file.read()` and *then* compared the length
    against the cap - so a 2 GB body was fully materialised in memory before
    being rejected, and the size limit protected the index while leaving RAM
    wide open. Reading in bounded chunks and stopping one byte past the limit
    means an oversized upload costs the limit, not the payload.
    """
    chunks = []
    total = 0
    while True:
        chunk = upload.file.read(1_048_576)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"That file is larger than the {config.MAX_UPLOAD_MB} MB limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/upload")
def upload_document(
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_admin),
):
    """Ingest a document. Administrators only - this writes to a shared archive."""
    # Ingestion is the most expensive thing the app does: parsing, embedding
    # every chunk, and an LLM profiling call. Admin-only is an authorisation
    # control, not a cost control, so it also gets a rate limit.
    ratelimit.enforce(
        "upload",
        ratelimit.client_key(request, user.username),
        config.UPLOAD_RATE_LIMIT,
        config.UPLOAD_RATE_WINDOW,
        message="You are uploading too quickly.",
    )

    filename = (file.filename or "").strip()
    if not filename or "." not in filename:
        raise HTTPException(status_code=400, detail="The file needs a name with an extension.")

    ext = filename.rsplit(".", 1)[-1].lower()
    if ext not in config.ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(config.ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '.{ext}'. Allowed: {allowed}.",
        )

    # Reject on the declared length before reading a byte, when the client is
    # honest enough to send one. `_read_capped` handles the case where it lies.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > config.MAX_UPLOAD_BYTES * 1.05:
        raise HTTPException(
            status_code=413,
            detail=f"That upload is larger than the {config.MAX_UPLOAD_MB} MB limit.",
        )

    contents = _read_capped(file, config.MAX_UPLOAD_BYTES)
    if not contents:
        raise HTTPException(status_code=400, detail="That file is empty.")

    with neo4j_driver.session() as session:
        count = session.run(
            "MATCH (u:User {username: $username})-[:UPLOADED]->(d:Document) "
            "RETURN count(d) AS n",
            username=user.username,
        ).single()
        if count and count["n"] >= config.MAX_DOCUMENTS_PER_USER:
            raise HTTPException(
                status_code=400,
                detail=f"Upload limit reached ({config.MAX_DOCUMENTS_PER_USER} documents). "
                       f"Delete one to make room.",
            )

    doc_id = str(uuid.uuid4())
    started = time.perf_counter()

    try:
        pages = _extract_pages(contents, ext)
    except Exception:
        logger.exception("Parsing failed for %s", filename)
        raise HTTPException(
            status_code=400,
            detail=f"That {ext.upper()} could not be read. "
                   f"It may be scanned images or password protected.",
        )

    if not pages:
        raise HTTPException(
            status_code=400,
            detail="No readable text was found. Scanned PDFs need OCR before upload.",
        )

    chunks = _chunk_pages(pages, doc_id, filename)
    if not chunks:
        raise HTTPException(status_code=400, detail="The document had no substantial text to index.")

    # --- Vector index ---
    documents = [
        Document(
            page_content=c["text"],
            metadata={
                "source": filename,
                "doc_id": doc_id,
                "page": c["page"],
                "chunk_index": c["index"],
                "chunk_id": c["id"],
            },
        )
        for c in chunks
    ]
    vector_ids = [c["id"] for c in chunks]

    try:
        PineconeVectorStore.from_documents(
            documents,
            get_embeddings(),
            index_name=index_name,
            ids=vector_ids,  # explicit IDs make deletion reliable on every tier
        )
    except Exception:
        logger.exception("Pinecone indexing failed for %s", filename)
        raise HTTPException(
            status_code=502,
            detail="The search index rejected this document. Please try again.",
        )

    # --- Profile ---
    overview_text = "\n\n".join(c["text"] for c in chunks[:3])[:6000]
    summary, key_entities, doc_type = "Summary not available.", "[]", "Other"
    try:
        result = overview_chain.invoke({
            "text": overview_text,
            "format_instructions": overview_parser.get_format_instructions(),
        })
        summary = (result.get("summary") or summary).strip()
        key_entities = json.dumps(result.get("key_entities") or [])
        doc_type = (result.get("document_type") or "Other").strip()
    except Exception as exc:
        logger.warning("Overview generation failed for %s: %s", filename, exc)

    # --- Document node ---
    now = int(time.time() * 1000)
    with neo4j_driver.session() as session:
        session.run(
            """
            MATCH (u:User {username: $username})
            CREATE (u)-[:UPLOADED]->(d:Document {
                id: $doc_id, filename: $filename, summary: $summary,
                key_entities: $key_entities, document_type: $doc_type,
                created_at: $ts, pages: $pages, chunk_count: $chunk_count,
                vector_ids: $vector_ids, size_bytes: $size
            })
            """,
            username=user.username, doc_id=doc_id, filename=filename,
            summary=summary, key_entities=key_entities, doc_type=doc_type,
            ts=now, pages=len(pages), chunk_count=len(chunks),
            vector_ids=vector_ids, size=len(contents),
        )

    _store_chunks_in_neo4j(chunks, doc_id)

    elapsed = time.perf_counter() - started
    logger.info(
        "Ingested '%s' (%d pages, %d chunks) in %.1fs for %s",
        filename, len(pages), len(chunks), elapsed, user.username,
    )

    return {
        "status": "success",
        "message": f"'{filename}' indexed: {len(chunks)} passages across {len(pages)} pages.",
        "doc_id": doc_id,
        "chunks_embedded": len(chunks),
        "pages": len(pages),
        "document_type": doc_type,
        "summary": summary,
        "elapsed_seconds": round(elapsed, 1),
    }
