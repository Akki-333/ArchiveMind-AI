<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/LangChain-🦜-green?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Pinecone-Vector_DB-5A29E4?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Neo4j-Graph_DB-008CC1?style=for-the-badge&logo=neo4j&logoColor=white" />
  <img src="https://img.shields.io/badge/Groq-LLM_Inference-FF6F00?style=for-the-badge" />
</p>

# ArchiveMind AI 🧠

**ArchiveMind AI** is a production-grade, hybrid **GraphRAG** (Graph-enhanced Retrieval-Augmented Generation) system for ingesting, understanding, and intelligently querying complex documents. It combines a **Pinecone Vector Database** for semantic search with a **Neo4j Knowledge Graph** for entity-relationship reasoning — delivering context-aware, hallucination-resistant answers through **Groq-powered LLM inference**.

Unlike simple "chat with PDF" tools, ArchiveMind extracts structured knowledge from unstructured documents, builds a queryable knowledge graph, and uses both retrieval paths to ground the LLM's responses in real data.

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Hybrid RAG Pipeline** | Dual-retrieval architecture combining Pinecone (vector similarity) + Neo4j (graph relationships) for context-rich, grounded answers. |
| **Multi-Format Document Ingestion** | Upload `.pdf`, `.docx`, `.pptx`, `.txt`, `.csv`, and `.md` files. Text is extracted, chunked, embedded, and indexed automatically. |
| **LLM-Powered Knowledge Graph Extraction** | Uses Groq's Llama 3.3 70B to extract entities (concepts, organizations, schemes, metrics) and relationships from document chunks, stored in Neo4j. |
| **Lazy Graph Extraction** | Graph entities are extracted at **query time** (not upload time) — scoped to the user's question for relevance and to avoid LLM rate limits. |
| **Interactive Mind Map Visualizer** | Click any past query to dynamically generate and render its Knowledge Graph using React Flow with Dagre auto-layout. |
| **Role-Based Access Control** | Separate **Admin** (ingest/delete documents) and **User** (explore/query) roles with JWT authentication and bcrypt password hashing. |
| **AI Recommendations Hub** | Analyzes a user's past chat sessions to suggest personalized topics they should explore next. |
| **Multi-Session Chat** | Full session management — create, rename, delete chat sessions. Conversations are persisted in Neo4j with 8-message sliding context window. |
| **Document-Scoped Queries** | Filter queries to a specific document, or search across all uploaded documents globally. |
| **Auto-Generated Document Profiles** | On upload, an AI-generated summary + key entities are extracted from the first 2 chunks and displayed in the chat UI. |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER (React Frontend)                          │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  Auth Screen │  │ Admin Dashboard  │  │ User "Public Knowledge      │ │
│  │  (Login/     │  │ (Upload, Delete, │  │  Portal" Dashboard          │ │
│  │   Register)  │  │  Stats, Health)  │  │ (Search, Impact Checker,    │ │
│  └─────────────┘  └─────────────────┘  │  AI Recommendations)        │ │
│                                         └─────────────────────────────┘ │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │     Semantic Chat Screen     │  │     Mind Map Explorer (Graph)    │ │
│  │ • Session sidebar            │  │ • Query history sidebar          │ │
│  │ • Document selector          │  │ • React Flow + Dagre layout      │ │
│  │ • Document overview card     │  │ • Dynamic entity extraction      │ │
│  │ • Markdown + code rendering  │  │ • Animated edges + labels        │ │
│  └──────────────────────────────┘  └──────────────────────────────────┘ │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ HTTP (axios)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend (Python)                           │
│                                                                         │
│  main.py ─── Registers routers, CORS, health checks                    │
│  ├── auth.py ─── JWT auth, bcrypt hashing, role-based registration     │
│  ├── ingestion.py ─── Multi-format parsing, chunking, embedding,       │
│  │                     Pinecone indexing, Neo4j document nodes,        │
│  │                     AI overview profile generation                   │
│  ├── querying.py ─── Chat sessions CRUD, RAG query pipeline,          │
│  │                    conversation history, document deletion,          │
│  │                    AI recommendations engine                         │
│  ├── graph_api.py ─── Knowledge graph data, per-doc graph,            │
│  │                     query-scoped entity extraction + highlight       │
│  └── database.py ─── Pinecone, Neo4j, Groq, HuggingFace init          │
└────────────┬──────────────────┬──────────────────┬──────────────────────┘
             │                  │                  │
             ▼                  ▼                  ▼
     ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
     │   Pinecone   │  │   Neo4j      │  │   Groq API       │
     │ Vector Store │  │ AuraDB       │  │ (Llama 3.3 70B)  │
     │              │  │              │  │                   │
     │ • 384-dim    │  │ • Users      │  │ • Chat generation │
     │   embeddings │  │ • Documents  │  │ • Entity          │
     │ • Cosine     │  │ • Entities   │  │   extraction      │
     │   similarity │  │ • Sessions   │  │ • Overview        │
     │ • doc_id     │  │ • Messages   │  │   profiles        │
     │   filtering  │  │ • Relations  │  │ • Recommendations │
     └──────────────┘  └──────────────┘  └──────────────────┘
```

---

## 🛠️ Technology Stack

### Backend
| Technology | Purpose |
|---|---|
| **Python 3.11+** | Backend runtime |
| **FastAPI** | Async REST API framework |
| **LangChain** | LLM orchestration, prompt chains, output parsers |
| **LangChain-Groq** | Groq LLM integration (Llama 3.3 70B Versatile) |
| **LangChain-Pinecone** | Vector store integration |
| **HuggingFace Embeddings** | `all-MiniLM-L6-v2` model (384-dim sentence embeddings) |
| **Pinecone** | Managed vector database for semantic search |
| **Neo4j AuraDB** | Cloud graph database for entity-relationship storage |
| **PyPDF2 / python-docx / python-pptx** | Multi-format document text extraction |
| **bcrypt + PyJWT** | Password hashing and JWT token authentication |

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **Vite** | Dev server and build tool |
| **TailwindCSS** | Utility-first CSS styling |
| **React Flow (@xyflow/react)** | Interactive knowledge graph visualization |
| **Dagre** | Automatic graph layout algorithm |
| **React Markdown** | Rendering LLM responses with formatting |
| **Lucide React** | Icon library |
| **Axios** | HTTP client for API communication |
| **React Router v7** | Client-side routing |

---

## 🔧 Design Decisions & Engineering Tradeoffs

### 1. Lazy Graph Extraction (Query-Time vs Upload-Time)
**Problem:** The original design extracted entities from every chunk at upload time, causing 40+ LLM calls per document, hitting Groq's rate limits and making uploads take minutes.

**Solution:** Graph extraction was deferred to **query time**. When a user asks a question, the system retrieves relevant chunks from Pinecone first, then extracts entities only from those chunks. This reduced upload-time LLM calls from ~40 to 1 (for the overview profile), and the resulting graph is more relevant because it's scoped to the user's actual question.

### 2. Deterministic Auto-Titling
Chat session titles are generated by truncating the user's first message to 30 characters — not by calling the LLM. This saves an API call, eliminates latency, and never fails.

### 3. Conversation Context Window
The chat pipeline feeds the last 8 messages from Neo4j into the LLM prompt as conversation history, providing multi-turn context without exceeding token limits.

### 4. Score-Based Retrieval Filtering
The `query_pinecone()` function uses `similarity_search_with_score` and applies a configurable similarity threshold (`threshold` parameter) to filter out low-relevance chunks before they reach the LLM.

### 5. Document Deletion Cascade
When a document is deleted, the system cascades across both databases — deleting vectors from Pinecone (via metadata filter) and cleaning up orphaned Entity nodes from Neo4j.

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new user (with role: `admin` or `user`) |
| `POST` | `/api/auth/login` | Login and receive JWT token |

### Document Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload and process a document (PDF, DOCX, PPTX, TXT, CSV, MD) |
| `GET` | `/api/documents` | List all uploaded documents with summaries and key entities |
| `DELETE` | `/api/documents/{doc_id}` | Delete a document from Pinecone + Neo4j |

### Chat & Sessions
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Send a message and receive a RAG-powered response |
| `GET` | `/api/chat/sessions` | List all chat sessions for the authenticated user |
| `POST` | `/api/chat/sessions` | Create a new chat session |
| `PUT` | `/api/chat/sessions/{id}` | Rename a chat session |
| `PUT` | `/api/chat/sessions/{id}/document` | Attach a document to a session |
| `DELETE` | `/api/chat/sessions/{id}` | Delete a chat session and its messages |
| `GET` | `/api/chat/history/{id}` | Retrieve message history for a session |
| `GET` | `/api/chat/recommendations` | Get AI-generated topic recommendations |

### Knowledge Graph
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/graph/data` | Fetch all entities and relationships |
| `GET` | `/api/graph/document/{doc_id}` | Fetch graph data for a specific document |
| `POST` | `/api/graph/highlight` | Extract and return entities for a specific query (on-the-fly) |

### Health Check
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Backend status check |
| `GET` | `/health/db` | Verify Pinecone and Neo4j configuration |

---

## 📂 Project Structure

```
ArchiveMind-AI/
├── .env                    # API keys (never committed)
├── .gitignore
├── README.md
├── system_architecture.png
├── diagram.mmd             # Mermaid diagram source
│
├── backend/
│   ├── main.py             # FastAPI app, router registration, CORS
│   ├── database.py         # Pinecone, Neo4j, Groq, Embeddings init
│   ├── auth.py             # JWT auth, bcrypt, role-based access
│   ├── ingestion.py        # Document parsing, chunking, embedding pipeline
│   ├── querying.py         # RAG chat, session CRUD, recommendations
│   ├── graph_api.py        # Knowledge graph API + live entity extraction
│   ├── migrate_chats.py    # One-time migration script for legacy data
│   └── requirements.txt    # Python dependencies
│
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx        # React entry point
│       ├── App.jsx         # All screens: Auth, Dashboard, Chat, Graph
│       ├── App.css         # Custom animations and scrollbar styles
│       └── index.css       # Tailwind directives
```

---

## ⚙️ Local Setup

### Prerequisites
- **Python 3.11+** (3.12 recommended)
- **Node.js 18+** and **npm**
- A **Pinecone** account (free tier works) with an index created (384 dimensions, cosine metric)
- A **Neo4j AuraDB** instance (free tier works)
- A **Groq** API key (free tier works)

### 1. Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/ArchiveMind-AI.git
cd ArchiveMind-AI
```

### 2. Configure Environment Variables
Create a `.env` file in the project root:
```env
GROQ_API_KEY=your_groq_api_key

PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=archivemind-index

NEO4J_URI=neo4j+s://your_uri.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_neo4j_password
```

### 3. Backend Setup
```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS/Linux
# source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
The API will be live at `http://localhost:8000`. Verify at `http://localhost:8000/health/db`.

### 4. Frontend Setup
Open a **new terminal**:
```bash
cd frontend
npm install
npm run dev
```
The app will be live at `http://localhost:5173`.

---

## 🧠 How the RAG Pipeline Works

```
User Question
      │
      ├─── 1. Embed query using all-MiniLM-L6-v2 (384-dim)
      │
      ├─── 2. Search Pinecone for top-15 relevant chunks
      │        (filtered by doc_id if document-scoped)
      │        (filtered by similarity score threshold)
      │
      ├─── 3. Fetch conversation history from Neo4j (last 8 messages)
      │
      ├─── 4. Merge: Document Excerpts + Graph Relationships + History
      │
      └─── 5. Feed combined context to Groq (Llama 3.3 70B)
                     │
                     └─── Grounded answer returned to user
```

---

## 🗺️ Neo4j Graph Schema

```
(:User {username, password_hash, role})
  ─[:UPLOADED]──▶ (:Document {id, filename, summary, key_entities, created_at})
  ─[:HAS_SESSION]──▶ (:ChatSession {id, title, doc_id, created_at})
                        ─[:HAS_MESSAGE]──▶ (:Message {role, content, timestamp})

(:Entity {id, type})
  ─[:FOUND_IN]──▶ (:Document)
  ─[:RELATED_TO {type}]──▶ (:Entity)
```

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<p align="center">
  Built with ❤️ using LangChain, Pinecone, Neo4j, Groq, FastAPI, and React
</p>
