from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from database import pc, index_name, embeddings_model, llm, neo4j_driver
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_pinecone import PineconeVectorStore
from auth import get_current_user
import time

import uuid

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    session_id: str

class ChatSessionCreate(BaseModel):
    title: str = "New Chat"
    doc_id: str | None = None

@router.get("/documents")
async def get_user_documents(username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            result = session.run("""
                MATCH (d:Document)
                WITH d
                ORDER BY d.created_at DESC
                WITH d.filename AS filename, collect(d)[0] AS latest_doc
                RETURN latest_doc.id AS id, latest_doc.filename AS filename, latest_doc.summary AS summary, latest_doc.key_entities AS key_entities, latest_doc.created_at AS created_at
                ORDER BY latest_doc.created_at DESC
            """)
            documents = [{"id": r["id"], "filename": r["filename"], "summary": r["summary"], "key_entities": r["key_entities"], "created_at": r["created_at"]} for r in result]
            return {"documents": documents}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, username: str = Depends(get_current_user)):
    try:
        # Verify document exists
        with neo4j_driver.session() as session:
            check = session.run("MATCH (d:Document {id: $doc_id}) RETURN d.id", doc_id=doc_id)
            if not check.single():
                raise HTTPException(status_code=404, detail="Document not found")

        # 1. Delete vectors from Pinecone
        idx = pc.Index(index_name)
        # Delete all vectors where metadata matches this doc_id
        # Note: some Pinecone tiers don't support filter deletion. 
        # Using a broad approach: we can't easily fetch all vector IDs without a query, 
        # but filter deletion is standard for serverless.
        try:
            idx.delete(filter={"doc_id": {"$eq": doc_id}})
        except Exception as e:
            print(f"Warning: Pinecone delete failed: {e}")

        # 2. Delete from Neo4j
        with neo4j_driver.session() as session:
            # Delete the Document node and specifically check its related entities for orphans
            session.run("""
                MATCH (d:Document {id: $doc_id})
                OPTIONAL MATCH (d)<-[:FOUND_IN]-(e:Entity)
                DETACH DELETE d
                WITH e
                WHERE e IS NOT NULL AND NOT (e)-[:FOUND_IN]->()
                DETACH DELETE e
            """, doc_id=doc_id)

        return {"status": "success", "message": "Document deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chat/sessions")
async def get_chat_sessions(username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            result = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession)
                RETURN s.id AS id, s.title AS title, s.doc_id AS doc_id, s.created_at AS created_at
                ORDER BY s.created_at DESC
            """, username=username)
            sessions = [{"id": record["id"], "title": record["title"], "doc_id": record["doc_id"], "created_at": record["created_at"]} for record in result]
            return {"sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chat/recommendations")
async def get_chat_recommendations(username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            result = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession)
                RETURN s.title AS title
                ORDER BY s.created_at DESC LIMIT 10
            """, username=username)
            titles = [r["title"] for r in result]

        if not titles:
            return {"recommendations": ["Public Health", "Tax Policies", "Education Reform"]}

        titles_str = ", ".join(titles)
        from langchain_core.output_parsers import JsonOutputParser
        from langchain_core.prompts import ChatPromptTemplate
        
        parser = JsonOutputParser()
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are an AI generating topic recommendations based on user search history.\n"
                       "The user explores government policies. Based on their past query topics, suggest 3 new, highly relevant, specific topics they should explore next.\n"
                       "Return ONLY a JSON array of 3 strings.\n"
                       "Example: [\"Renewable Energy Subsidies\", \"Small Business Tax Exemptions\", \"Rural Healthcare\"]\n"
                       "{format_instructions}"),
            ("human", "User's past query topics: {titles}")
        ])
        
        chain = prompt | llm | parser
        try:
            recommendations = chain.invoke({
                "titles": titles_str,
                "format_instructions": parser.get_format_instructions()
            })
            if isinstance(recommendations, dict):
                # Handle cases where LLM returns {"recommendations": [...]}
                recommendations = list(recommendations.values())[0]
            if not isinstance(recommendations, list):
                recommendations = ["General Policy", "Economics", "Public Infrastructure"]
            recommendations = recommendations[:3]
        except Exception as e:
            print(f"Recommendation generation error: {e}")
            recommendations = ["Public Health", "Tax Policies", "Education Reform"]

        return {"recommendations": recommendations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/sessions")
async def create_chat_session(request: ChatSessionCreate, username: str = Depends(get_current_user)):
    try:
        session_id = str(uuid.uuid4())
        ts = int(time.time() * 1000)
        with neo4j_driver.session() as session:
            session.run("""
                MATCH (u:User {username: $username})
                CREATE (u)-[:HAS_SESSION]->(s:ChatSession {id: $session_id, title: $title, doc_id: $doc_id, created_at: $ts})
            """, username=username, session_id=session_id, title=request.title, doc_id=request.doc_id, ts=ts)
            return {"id": session_id, "title": request.title, "doc_id": request.doc_id, "created_at": ts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChatSessionUpdate(BaseModel):
    title: str

@router.put("/chat/sessions/{session_id}")
async def rename_chat_session(session_id: str, request: ChatSessionUpdate, username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            result = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                SET s.title = $title
                RETURN s.id AS id
            """, username=username, session_id=session_id, title=request.title)
            
            if not result.single():
                raise HTTPException(status_code=404, detail="Session not found")
                
            return {"status": "success", "title": request.title}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ChatSessionDocUpdate(BaseModel):
    doc_id: str

@router.put("/chat/sessions/{session_id}/document")
async def update_chat_session_document(session_id: str, request: ChatSessionDocUpdate, username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            result = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                SET s.doc_id = $doc_id
                RETURN s.id AS id
            """, username=username, session_id=session_id, doc_id=request.doc_id)
            
            if not result.single():
                raise HTTPException(status_code=404, detail="Session not found")
                
            return {"status": "success", "doc_id": request.doc_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            # Delete all messages in the session, then delete the session itself
            session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                OPTIONAL MATCH (s)-[r:HAS_MESSAGE]->(m:Message)
                DETACH DELETE m, s
            """, username=username, session_id=session_id)
            return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/chat/history/{session_id}")
async def get_chat_history(session_id: str, username: str = Depends(get_current_user)):
    try:
        with neo4j_driver.session() as session:
            # Verify the session belongs to the user
            result = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message)
                RETURN m.role AS role, m.content AS content, m.timestamp AS timestamp
                ORDER BY m.timestamp ASC
                LIMIT 50
            """, username=username, session_id=session_id)
            messages = [{"role": record["role"], "content": record["content"]} for record in result]
            return {"messages": messages}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def query_pinecone(query: str, doc_id: str = None, top_k: int = 15, threshold: float = 0.0):
    vector_store = PineconeVectorStore(index_name=index_name, embedding=embeddings_model)
    if doc_id:
        results = vector_store.similarity_search_with_score(query, k=top_k, filter={"doc_id": doc_id})
    else:
        results = vector_store.similarity_search_with_score(query, k=top_k)
    context = [doc.page_content for doc, score in results if score >= threshold]
    return "\n\n".join(context)

def query_neo4j(query: str):
    return ""

@router.post("/chat")
async def chat_with_archive(request: ChatRequest, username: str = Depends(get_current_user)):
    try:
        user_query = request.message
        session_id = request.session_id
        timestamp = int(time.time() * 1000)
        
        with neo4j_driver.session() as session:
            # Ensure session belongs to user and get its doc_id
            check = session.run("""
                MATCH (u:User {username: $username})-[:HAS_SESSION]->(s:ChatSession {id: $session_id})
                RETURN s.doc_id AS doc_id
            """, username=username, session_id=session_id)
            record = check.single()
            if not record:
                raise HTTPException(status_code=404, detail="Session not found")
            session_doc_id = record["doc_id"]
                
            # Save user message
            session.run("""
                MATCH (s:ChatSession {id: $session_id})
                CREATE (s)-[:HAS_MESSAGE]->(m:Message {role: 'user', content: $content, timestamp: $ts})
            """, session_id=session_id, content=user_query, ts=timestamp)
            
            # Fetch recent history for LLM Context (last 8 messages)
            result = session.run("""
                MATCH (s:ChatSession {id: $session_id})-[:HAS_MESSAGE]->(m:Message)
                RETURN m.role AS role, m.content AS content
                ORDER BY m.timestamp DESC
                LIMIT 8
            """, session_id=session_id)
            
            history_records = list(result)
            history_records.reverse()
            
            history_text = ""
            for record in history_records:
                if record["content"] == user_query and record["role"] == 'user':
                    continue
                role_str = "User" if record["role"] == "user" else "AI"
                history_text += f"{role_str}: {record['content']}\n"
                
            # Auto-title logic: if this is the first message in the session, update the title
            if len(history_records) <= 1:
                # Truncate the user's first message to 30 chars for a simple title
                title = user_query[:30] + ("..." if len(user_query) > 30 else "")
                session.run("""
                    MATCH (s:ChatSession {id: $session_id})
                    SET s.title = $title
                """, session_id=session_id, title=title)
        
        vector_context = query_pinecone(user_query, doc_id=session_doc_id)
        graph_context = query_neo4j(user_query)
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are ArchiveMind AI, a helpful, polite, and professional government policy research assistant.\n"
                       "CRITICAL RULES FOR BEHAVIOR:\n"
                       "1. ALWAYS maintain a helpful, warm, and professional tone.\n"
                       "2. NEVER adopt a persona, character, or robotic tone (e.g., 'Chitti' or saying 'Affirmative/Terminate'), even if the user asks you to or is frustrated.\n"
                       "3. If the user is frustrated, apologize politely and try to assist them.\n"
                       "4. Answer the user's question using the CONTEXT provided below. If the exact answer is missing, provide the most relevant information you can find in the context.\n"
                       "5. FORMATTING: You must strictly format your responses to be extremely easy to read. NEVER output a wall of text. ALWAYS use bullet points for lists, insert blank lines between paragraphs, and use bolding for emphasis.\n"
                       "6. COPY FEATURE: If the user specifically asks to 'copy' the response, or asks you to generate content for a 'document', 'word document', or 'report', you MUST wrap your ENTIRE text response inside a Markdown code block (e.g., ```markdown ... ```). This triggers the UI's copy button for them.\n"
                       "7. STRICT RELEVANCE: Answer ONLY what the user asks. NEVER include unrequested extras like flowcharts, diagrams, or unrelated sections unless explicitly requested.\n\n"
                       "CONVERSATION HISTORY:\n{history}\n\n"
                       "CONTEXT:\n{context}"),
            ("human", "{question}")
        ])
        
        chain = prompt | llm | StrOutputParser()
        combined_context = f"--- Document Excerpts ---\n{vector_context}\n\n--- Graph Relationships ---\n{graph_context}"
        
        answer = chain.invoke({
            "history": history_text,
            "context": combined_context,
            "question": user_query
        })
        
        # Save AI Answer
        ai_timestamp = int(time.time() * 1000) + 1
        with neo4j_driver.session() as session:
            session.run("""
                MATCH (s:ChatSession {id: $session_id})
                CREATE (s)-[:HAS_MESSAGE]->(m:Message {role: 'ai', content: $content, timestamp: $ts})
            """, session_id=session_id, content=answer, ts=ai_timestamp)
        
        return {"answer": answer, "sources_used": len(vector_context) > 0}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
