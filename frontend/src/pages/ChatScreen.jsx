import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  FileText, MessageCircle, MessageSquare, Pencil, Plus, Send,
  Trash2, AlertTriangle,
} from 'lucide-react';

import {
  createSession, deleteSession, errorMessage, fetchSessions,
  renameSession, sendMessage,
} from '../api';
import { ChatMessage, NewChatModal, EmptyState, Spinner } from '../components/common';

const ChatScreen = ({
  sessions, setSessions, currentSessionId, setCurrentSessionId,
  messages, setMessages, documents,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showPromptHistory, setShowPromptHistory] = useState(false);

  const editInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageRefs = useRef({});
  const initialQuerySent = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const selectedDoc = documents.find((d) => d.id === currentSession?.doc_id);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) editInputRef.current.focus();
  }, [editingSessionId]);

  const handleNewChatConfirm = async (doc) => {
    setShowNewChatModal(false);
    if (!doc) return;
    try {
      const session = await createSession(doc.filename, doc.id);
      setSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'That conversation could not be created.'));
    }
  };

  const handleDeleteChat = async (id, event) => {
    event.stopPropagation();
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      setError(errorMessage(err, 'That conversation could not be deleted.'));
    }
  };

  const handleRenameSubmit = async (id, event) => {
    event?.stopPropagation();
    if (!editTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      await renameSession(id, editTitle.trim());
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: editTitle.trim() } : s)));
    } catch (err) {
      setError(errorMessage(err, 'That conversation could not be renamed.'));
    }
    setEditingSessionId(null);
  };

  const performSend = async (queryText) => {
    const text = queryText.trim();
    if (!text || loading) return;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      if (!documents.length) {
        setError('The archive is empty. An administrator needs to ingest a document first.');
        return;
      }
      try {
        const doc = documents[0];
        const session = await createSession(doc.filename, doc.id);
        setSessions((prev) => [session, ...prev]);
        activeSessionId = session.id;
        setCurrentSessionId(session.id);
      } catch (err) {
        setError(errorMessage(err, 'That conversation could not be started.'));
        return;
      }
    }

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const data = await sendMessage(text, activeSessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: data.answer,
          citations: data.citations,
          grounded: data.grounded,
        },
      ]);
      // The first message renames the session server-side, so refresh the list.
      if (messages.length === 0) {
        fetchSessions().then(setSessions).catch(() => {});
      }
    } catch (err) {
      setError(errorMessage(err, 'That answer could not be generated.'));
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (location.state?.initialQuery && !initialQuerySent.current) {
      initialQuerySent.current = true;
      const query = location.state.initialQuery;
      navigate(location.pathname, { replace: true, state: {} });
      performSend(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const userMessages = messages
    .map((m, i) => ({ ...m, originalIndex: i }))
    .filter((m) => m.role === 'user');

  return (
    <div className="h-full flex animate-fade-in relative">
      {showNewChatModal && (
        <NewChatModal
          documents={documents}
          onClose={() => setShowNewChatModal(false)}
          onConfirm={handleNewChatConfirm}
        />
      )}

      {/* Sessions */}
      <div className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="w-full flex items-center justify-center gap-2 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 dark:hover:bg-sky-900/50 border border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-300 py-2.5 rounded-xl font-medium transition-all"
          >
            <Plus size={18} /> New conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {sessions.length === 0 && (
            <p className="text-center p-4 text-sm text-slate-400">No conversations yet.</p>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => editingSessionId !== session.id && setCurrentSessionId(session.id)}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border ${
                currentSessionId === session.id
                  ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-700 text-sky-600 dark:text-sky-300'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-transparent hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden flex-1">
                <MessageCircle
                  size={16}
                  className={`shrink-0 ${currentSessionId === session.id ? 'text-sky-500' : 'text-slate-400'}`}
                />
                {editingSessionId === session.id ? (
                  <input
                    ref={editInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={(e) => handleRenameSubmit(session.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameSubmit(session.id, e);
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm rounded px-2 py-1 outline-none ring-1 ring-sky-500 min-w-0"
                  />
                ) : (
                  <span className="text-sm font-medium truncate">{session.title}</span>
                )}
              </div>

              {!editingSessionId && (
                <div
                  className={`flex items-center gap-1 transition-opacity ${
                    currentSessionId === session.id
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSessionId(session.id);
                      setEditTitle(session.title);
                    }}
                    className="text-slate-400 hover:text-sky-500 p-1 rounded-md"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => handleDeleteChat(session.id, e)}
                    className="text-slate-400 hover:text-red-500 p-1 rounded-md"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 p-6 flex flex-col max-w-4xl mx-auto w-full relative min-w-0">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 min-w-0">
            <MessageSquare className="text-sky-500 shrink-0" />
            <span className="truncate">Semantic Chat</span>
          </h2>
          {selectedDoc && (
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full truncate max-w-xs">
              {selectedDoc.filename}
            </span>
          )}
        </div>

        <div className="flex-1 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto overflow-x-hidden mb-4 flex flex-col custom-scrollbar">
          {selectedDoc && messages.length === 0 && (
            <div className="mb-6 p-5 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-2xl">
              <h3 className="text-base font-bold text-sky-700 dark:text-sky-300 mb-2 flex items-center gap-2">
                <FileText size={18} /> About this document
              </h3>
              <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed mb-3">
                {selectedDoc.summary || 'No summary was generated for this document.'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  try {
                    return JSON.parse(selectedDoc.key_entities || '[]');
                  } catch {
                    return [];
                  }
                })().map((entity, i) => (
                  <span
                    key={i}
                    className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs px-2.5 py-1 rounded-md"
                  >
                    {entity}
                  </span>
                ))}
              </div>
              {selectedDoc.pages && (
                <p className="text-xs text-slate-400 mt-3">
                  {selectedDoc.pages} pages · {selectedDoc.chunk_count} indexed passages
                </p>
              )}
            </div>
          )}

          {messages.length === 0 && !selectedDoc && (
            <EmptyState
              icon={MessageSquare}
              title={documents.length === 0 ? 'The archive is empty' : 'Ask about a policy document'}
              hint={
                documents.length === 0
                  ? 'An administrator needs to ingest a document before you can ask questions.'
                  : 'Start a conversation from the sidebar, then ask anything. Every answer cites the passages it came from.'
              }
            />
          )}

          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              message={m}
              msgRef={(el) => {
                messageRefs.current[i] = el;
              }}
            />
          ))}

          {loading && (
            <div className="text-sky-500 font-medium flex items-center gap-2 bg-white dark:bg-slate-700 w-fit px-4 py-3 rounded-2xl rounded-tl-sm border border-slate-200 dark:border-slate-600 shadow-sm">
              <Spinner size={14} />
              <span className="text-sm">Searching the archive</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="mb-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            performSend(input);
          }}
          className="flex gap-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                performSend(input);
              }
            }}
            placeholder="Ask a question about this document"
            rows="1"
            className="flex-1 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl px-5 py-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 shadow-sm resize-none overflow-hidden"
            style={{ minHeight: '56px' }}
            onInput={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
              e.target.style.overflowY = e.target.scrollHeight > 150 ? 'auto' : 'hidden';
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-sky-500 text-white px-6 rounded-xl font-semibold hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-md flex items-center gap-2"
          >
            <Send size={17} /> Send
          </button>
        </form>

        {/* Prompt history */}
        {userMessages.length > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 right-0 flex items-center"
            onMouseEnter={() => setShowPromptHistory(true)}
            onMouseLeave={() => setShowPromptHistory(false)}
          >
            <div
              className={`w-2.5 h-32 bg-slate-300 dark:bg-slate-600 rounded-l-full cursor-pointer transition-all duration-300 ${
                showPromptHistory ? 'opacity-0' : 'opacity-80 hover:opacity-100'
              }`}
            />
            <div
              className={`absolute right-0 top-1/2 -translate-y-1/2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-l-2xl shadow-xl transition-all duration-300 overflow-hidden ${
                showPromptHistory ? 'w-64 opacity-100' : 'w-0 opacity-0 pointer-events-none'
              }`}
            >
              <div className="p-4 border-b border-slate-100 dark:border-slate-700">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageCircle size={12} /> Your questions
                </p>
              </div>
              <div className="p-2 space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                {userMessages.map((m, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      messageRefs.current[m.originalIndex]?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                      setShowPromptHistory(false);
                    }}
                    className="w-full text-left p-2.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-600 transition-colors truncate"
                  >
                    {m.content}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatScreen;
