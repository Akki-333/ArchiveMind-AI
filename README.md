---
title: ArchiveMind AI
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: gradio
app_file: app.py
pinned: false
---

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Pinecone-Vector_DB-5A29E4?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Neo4j-Graph_DB-008CC1?style=for-the-badge&logo=neo4j&logoColor=white" />
  <img src="https://img.shields.io/badge/Groq-LLM_Inference-FF6F00?style=for-the-badge" />
</p>

# ArchiveMind AI

**Ask a government policy document a question and get an answer you can check.**

ArchiveMind is a hybrid **GraphRAG** system for policy archives. It combines
dense vector search, exact-term lexical search, and a knowledge graph that grows
as people use it — and every factual claim in an answer carries a citation back
to the passage it came from.

That last part is the point. A policy assistant whose answers cannot be traced
to a clause is one no official can act on.

---

## What makes it different

Most "chat with your PDF" tools retrieve a few chunks and hope. ArchiveMind does
four things they do not:

**It cites everything.** Answers carry numbered citations with the document,
page, and the passage text. Click one and read the source.

**It says when it does not know.** If retrieval finds nothing above the
relevance floor, you get an honest "the archive does not cover this" plus a
suggestion of what would — never plausible-sounding filler assembled from
adjacent material.

**Its graph is real and it grows.** Entities extracted while answering are
merged into Neo4j on a normalised key, so "Article 5", "article 5" and "Art. 5"
become one node. Every relationship records the chunks it came from, so you can
click an edge and read the sentence that produced it. Ask more questions and the
map fills in.

**It compares documents.** Pick two or three overlapping schemes and get a
structured diff: where they agree, where they conflict, and what one covers that
the others do not.

---

## Features

| Feature | What it does |
|---|---|
| **Hybrid retrieval** | Dense vectors, Neo4j full-text, reciprocal rank fusion, MMR diversity, and a relevance floor — five stages, tuned so a small free embedding model still answers well. |
| **Grounded answers with citations** | Numbered `[1]`-style citations resolving to document, page and passage text. |
| **Honest abstention** | Below the relevance threshold the assistant says so rather than improvising. |
| **Knowledge graph that accumulates** | Query-time extraction, persisted and merged with entity resolution. Cached, so the same question renders the same picture without a second LLM call. |
| **Graph provenance** | Every relationship stores its source chunks. Click an edge, read the sentence. |
| **Mind map explorer** | Grid-wrapping layout, type-coloured nodes, live legend, entity filter, hover focus, click-to-expand, PNG export, per-question and whole-document views. |
| **Document comparison** | Structured agree / differ / gaps analysis across two or three documents, fully cited. |
| **Unanswered-questions backlog** | Every question is logged. Ones the archive could not answer surface on the admin dashboard as an ingestion to-do list. |
| **Real system health** | `/health/db` performs actual round-trips to Neo4j, Pinecone and the LLM, with latency. The dashboard badges read from it. |
| **Provider failover** | Groq primary, with Gemini, Cerebras and OpenRouter behind it. A rate limit or a retired model id does not take the app down. |
| **Server-enforced roles** | Administrators ingest and remove; readers explore and ask. The client never chooses its own role. |
| **Multi-format ingestion** | PDF, DOCX, PPTX, TXT, MD, CSV — split on document structure, with page numbers preserved into citations. |

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                        React frontend (Vite + Tailwind)                  │
│                                                                          │
│  Dashboard        Semantic Chat       Mind Map          Compare          │
│  health, gaps,    citations,          grid layout,      structured       │
│  analytics        abstention          provenance        diff             │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │ HTTPS (JWT bearer)
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          FastAPI backend                                 │
│                                                                          │
│  config ────── env validation, fail-fast on missing secrets              │
│  auth ──────── JWT, bcrypt, throttling, server-side role model           │
│  ingestion ─── parse -> page-aware chunk -> embed -> index -> profile    │
│  retrieval ─── condense -> expand -> dense + lexical -> fuse -> MMR      │
│  graph_store ─ normalise -> persist -> neighbourhood -> cache            │
│  querying ──── chat, sessions, comparison, stats, analytics              │
│  graph_api ─── extraction, document map, expansion, provenance           │
└───────────┬──────────────────────┬───────────────────┬───────────────────┘
            ▼                      ▼                   ▼
   ┌────────────────┐   ┌────────────────────┐   ┌──────────────────┐
   │    Pinecone    │   │       Neo4j        │   │   LLM chain      │
   │                │   │                    │   │                  │
   │ 384-dim dense  │   │ Users, Documents   │   │ Groq             │
   │ vectors,       │   │ Sessions, Messages │   │  -> Gemini       │
   │ cosine,        │   │ Chunks (lexical)   │   │  -> Cerebras     │
   │ doc_id filter  │   │ Entities + edges   │   │  -> OpenRouter   │
   │                │   │ QueryLog, Cache    │   │                  │
   └────────────────┘   └────────────────────┘   └──────────────────┘

   Embeddings: all-MiniLM-L6-v2, in-process. No quota, no vendor, free forever.
```

---

## How retrieval works

The embedding model is deliberately small and free. That costs recall, so the
quality is bought back in the pipeline rather than in the model:

1. **Condense** — a follow-up like *"what about the second one?"* is rewritten
   into a standalone query using the conversation history. Without this the
   embedding carries no relationship to the actual subject.
2. **Expand** — a few paraphrases in different registers. Small embedders miss
   on vocabulary mismatch; asking three ways recovers most of those misses.
3. **Dense** — Pinecone vector search per variant.
4. **Lexical** — Neo4j full-text over stored chunks, catching scheme names,
   section numbers and acronyms that a 384-dimensional vector smooths away.
5. **Fuse** — reciprocal rank fusion across every result list (rank-based,
   because a cosine score and a Lucene score are not comparable), then MMR to
   drop near-duplicates, then a relevance floor against the real query.

Every stage is configurable in `.env`, and the whole thing runs on free tiers.

---

## Quick start

### Prerequisites

- Python 3.11+, Node 18+
- A **Pinecone** index: 384 dimensions, cosine metric
- A **Neo4j AuraDB** instance (the free tier is enough)
- At least one LLM key: Groq, Google AI Studio, Cerebras or OpenRouter

### Setup

```bash
git clone https://github.com/Akki-333/ArchiveMind-AI.git
cd ArchiveMind-AI

```

Create a `.env` file in the repository root with at least these:

```ini
PINECONE_API_KEY=your-pinecone-key
PINECONE_INDEX_NAME=archivemind-index

NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-neo4j-password

# At least one of GROQ_API_KEY, GOOGLE_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY
GROQ_API_KEY=your-groq-key

# Required in production. Left unset in development, a key is generated once and
# cached in .jwt_secret.dev (gitignored) so sign-ins survive a restart.
# Generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"
JWT_SECRET=

# Optional. Lets a government official claim administrator access at sign-up.
ADMIN_ACCESS_CODE=
```

Every variable is listed in [Configuration](#configuration) below.

```bash

```bash
# Backend
cd backend
python -m venv ../venv && source ../venv/bin/activate   # Windows: ..\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

```bash
# Frontend, in a second terminal
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. **The first account you create becomes the
administrator** — sign up, then ingest a document.

Check everything is wired up at <http://localhost:8000/health/db>, which does
real round-trips and reports latency per service.

### Docker

```bash
docker build -t archivemind .
docker run -p 7860:7860 --env-file .env archivemind
```

The embedding model is baked in at build time so the port binds immediately
instead of timing out behind a 90 MB download.

---

## Roles

Roles are decided by the server, never by the client.

| | Reader | Administrator |
|---|:---:|:---:|
| Browse and search the archive | yes | yes |
| Ask questions, see citations | yes | yes |
| Explore the knowledge graph | yes | yes |
| Compare documents | yes | yes |
| Ingest documents | no | yes |
| Remove documents | no | yes |
| Analytics and unanswered questions | no | yes |
| Change other people's roles | no | yes |

Administrators come from one of two places:

- `ADMIN_USERNAMES` in `.env` (comma separated), or
- the bootstrap rule — the first account created on an empty database.

Existing administrators can promote others under **People**. The role in the JWT
is a hint; every request re-reads it from the database, so a demotion takes
effect immediately rather than when a token happens to expire.

---

## Configuration

Everything lives in `.env` at the repository root. Only the keys under **Stores**
and one LLM key are required; every other variable has a working default.

| Group | Notable keys |
|---|---|
| Security | `JWT_SECRET` (required in production), `JWT_EXPIRY_HOURS`, `ADMIN_USERNAMES`, `ADMIN_ACCESS_CODE`, `LOGIN_MAX_ATTEMPTS` |
| Stores | `PINECONE_API_KEY`, `PINECONE_INDEX_NAME`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` |
| LLM | `GROQ_API_KEY`, `GOOGLE_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, plus a `*_MODEL` for each |
| Retrieval | `RETRIEVAL_FINAL_K`, `RETRIEVAL_BROAD_K`, `RETRIEVAL_MIN_SCORE`, `RETRIEVAL_RELATIVE_FLOOR`, `ABSTAIN_THRESHOLD`, `MULTI_QUERY_ENABLED`, `LEXICAL_SEARCH_ENABLED` |
| Ingestion | `MAX_UPLOAD_MB`, `MAX_DOCUMENTS_PER_USER`, `CHUNK_SIZE`, `CHUNK_OVERLAP` |
| Graph | `GRAPH_CACHE_ENABLED`, `GRAPH_NEIGHBOURHOOD_HOPS`, `GRAPH_MAX_NODES` |
| Rate limits | `CHAT_RATE_LIMIT`/`_WINDOW`, `UPLOAD_RATE_*`, `GRAPH_RATE_*`, `COMPARE_RATE_*` — set any limit to `0` to disable it |
| Operations | `HEALTH_CACHE_SECONDS`, `QUERY_LOG_RETENTION_DAYS` |

**Model ids are configuration, not code.** Providers retire them periodically.
When that happens the fallback chain keeps the app answering, and the fix is an
env edit rather than a deploy.

---

## API

29 endpoints. Interactive docs at `/docs`.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register` | Role is ignored if sent |
| `POST` | `/api/auth/login` | Throttled |
| `GET` | `/api/auth/me` | Server-authoritative identity |
| `GET` | `/api/auth/users` | Admin |
| `PUT` | `/api/auth/users/{username}/role` | Admin |
| `POST` | `/api/upload` | Admin |
| `GET` | `/api/documents` | Shared archive |
| `DELETE` | `/api/documents/{id}` | Admin; removes vectors, chunks and graph |
| `POST` | `/api/documents/compare` | Structured comparison |
| `POST` | `/api/chat` | Returns `answer`, `citations`, `grounded` |
| `GET` | `/api/chat/sessions`, `/api/chat/history/{id}` | Private to the owner |
| `POST` | `/api/graph/highlight` | Extract, persist, cache |
| `GET` | `/api/graph/document/{id}` | Accumulated document map |
| `GET` | `/api/graph/entity/{key}/expand` | Click-to-expand |
| `GET` | `/api/graph/provenance` | Passages behind a relationship |
| `GET` | `/api/stats`, `/api/analytics/*` | Analytics are admin only |
| `GET` | `/health`, `/health/db`, `/health/config` | Liveness, dependencies, config |

---

## Tech stack

**Backend** — FastAPI, LangChain, Pinecone, Neo4j, sentence-transformers,
PyPDF2 / python-docx / python-pptx, bcrypt, PyJWT, NumPy

**Frontend** — React 18, Vite, TailwindCSS, React Flow (`@xyflow/react`),
React Markdown, Axios, React Router 7, Lucide

**Models** — `all-MiniLM-L6-v2` embeddings running in-process; chat and
extraction through the configured LLM chain

---

## Known limitations

Stated plainly, because a README that oversells is worse than one that does not.

- **No automated tests.** The largest gap. Start with the pure functions in
  `retrieval.py` and `graph_store.py`.
- **No streaming.** Answers arrive complete, so a long one means a visible wait.
- **Documents ingested before v2 have no `:Chunk` nodes**, so lexical search and
  graph provenance do not cover them. Re-ingest to backfill.
- **Login throttling is in-process**, which suits the single-worker deployment
  but would need Redis behind multiple workers.
- **Scanned PDFs need OCR first** — there is no OCR step in the pipeline.

---

## Project layout

```
ArchiveMind-AI/
├── backend/
│   ├── config.py        env validation, fail-fast
│   ├── llm.py           provider chain with failover
│   ├── database.py      Pinecone, Neo4j, embeddings, health
│   ├── schema.py        constraints and indexes, applied on boot
│   ├── auth.py          JWT, roles, throttling, profiles
│   ├── ratelimit.py     bounded sliding-window limiter
│   ├── retrieval.py     the five-stage pipeline
│   ├── graph_store.py   entity resolution, persistence, traversal
│   ├── ingestion.py     parse, chunk, embed, profile
│   ├── graph_api.py     graph endpoints
│   ├── querying.py      assembles the routers below
│   ├── routers/
│   │   ├── prompts.py   grounding rules, citation format, abstain path
│   │   ├── shared.py    request models and cross-router helpers
│   │   ├── documents.py the archive: list and remove
│   │   ├── sessions.py  conversations and transcripts
│   │   ├── chat.py      answering, buffered and streamed
│   │   ├── compare.py   structured comparison
│   │   └── analytics.py stats, recommendations, coverage
│   ├── tests/           pytest, no network access
│   └── main.py          app wiring, health, error handling
├── frontend/src/
│   ├── api.js           all HTTP, including the SSE chat stream
│   ├── lib/graph.js     layout, palette, crossing reduction (+ tests)
│   ├── components/      Answer, CodeBlock, shared UI
│   ├── pages/           one module per screen, lazily loaded
│   └── App.jsx          layout, routing, code splitting
├── .github/workflows/   CI: tests, lint, build, route contract
└── Dockerfile           container image for Hugging Face Spaces
```

---

## Tests

```bash
pip install -r backend/requirements-dev.txt
pytest backend/tests -q          # 114 tests

cd frontend && npm test          # 21 tests
```

Neither suite touches a network service. `backend/tests/conftest.py` sets
synthetic credentials before any module is imported, and `python-dotenv` does
not override variables that are already set, so the tests can never reach your
real Pinecone index or Neo4j instance.

The suites deliberately target the functions where a regression is *silent* —
the relevance floor, entity resolution, citation tidying, graph layout. Nothing
crashes when those break; answers and diagrams just quietly get worse.

CI additionally runs an import smoke test asserting that the core routes still
register and that `/health/db` and `/health/config` still require an
administrator.

---

## Deployment

The backend is a container; the frontend is static files. They deploy
separately and are joined by two environment variables.

### 1. Backend — Hugging Face Spaces

The `Dockerfile` already targets it: port 7860, and the embedding model is
pre-downloaded at build time so the platform's health check does not time out
waiting for a 90 MB download on the first request.

```bash
# Create a Space (SDK: Docker) at huggingface.co/new-space, then:
git remote add space https://huggingface.co/spaces/<you>/archivemind-ai
git push space main
```

In **Settings → Variables and secrets**, add these as *secrets*:

| Secret | Notes |
|---|---|
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `PINECONE_API_KEY` | |
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | AuraDB connection |
| `GROQ_API_KEY` | plus any other provider keys |
| `ADMIN_ACCESS_CODE` | optional; lets an official claim admin at sign-up |

and these as plain *variables*:

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `CORS_ORIGINS` | your frontend URL — set after step 2 |

`ENVIRONMENT=production` is not cosmetic. It makes `JWT_SECRET` mandatory, so
the app refuses to start on an ephemeral key rather than silently signing
everyone out on each restart, and it disables `/docs`, `/redoc` and
`/openapi.json`.

### 2. Frontend — Vercel

Import the repository and set **Root Directory** to `frontend`. `vercel.json`
supplies the build command, the output directory and the SPA rewrite that stops
`/chat` and `/graph` returning 404 on a refresh.

Add one environment variable:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<you>-archivemind-ai.hf.space` |

Vite inlines this at build time, so changing it needs a redeploy, not a restart.

### 3. Close the loop

The two services have to learn each other's URLs, and the order matters:

1. Deploy the backend, note its `*.hf.space` URL.
2. Deploy the frontend with `VITE_API_URL` pointing at it.
3. Go back and set `CORS_ORIGINS` on the Space to the Vercel URL, then restart.

Until step 3 the browser blocks every request, and the failure looks like a
network error rather than a configuration one.

### 4. Verify

```bash
curl https://<you>-archivemind-ai.hf.space/health      # {"status":"ok"} - public
```

Then sign in as an administrator and open **Dashboard → System Health**, which
performs real round-trips. For a one-off check that the LLM chain can actually
complete — the thing a configuration probe cannot tell you — call
`/health/db?deep=1` with an admin token. It is rate-limited and cached
deliberately: it bills a completion.

The first account created on an empty database becomes the administrator.

### Notes

- **Cold starts.** A free Space sleeps after inactivity; the first request
  afterwards pays the container start plus the model load. Subsequent requests
  are warm.
- **One worker.** The rate limiter and the login throttle are per-process,
  which is correct for the single-process `CMD` in the `Dockerfile`. Adding
  `--workers` silently breaks both — move the store to Redis first.
- **The YAML block at the top of this file** is the Space configuration. Remove
  it only if you deploy elsewhere.

---

## Licence

MIT
