import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown, FileText, History, MessageCircle, MessageSquare, Pencil,
  Plus, Send, Trash2, AlertTriangle, X,
} from 'lucide-react';

import {
  createSession, deleteSession, editMessage, errorMessage, fetchHistory,
  fetchSessions, renameSession, sendMessage,
} from '../api';
import { ChatMessage, NewChatModal, EmptyState, Spinner } from '../components/common';

/** Buckets for the session list. A flat list of thirty titles is a haystack. */
function groupSessions(sessions) {
  const now = Date.now();
  const day = 86_400_000;
  const buckets = [
    { label: 'Today', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Earlier', items: [] },
  ];
  sessions.forEach((session) => {
    const age = now - (session.created_at || now);
    if (age < day) buckets[0].items.push(session);
    else if (age < 7 * day) buckets[1].items.push(session);
    else buckets[2].items.push(session);
  });
  return buckets.filter((b) => b.items.length);
}

/**
 * The document briefing above the conversation.
 *
 * It used to be gated on `messages.length === 0`, so it vanished the moment you
 * asked anything - and never appeared at all if you opened a conversation that
 * already had history, which is most of the time. The summary is context for
 * the whole conversation, not a greeting for an empty one, so it is now always
 * mounted: open by default on a fresh conversation, collapsed to a single line
 * once there is history, and re-openable at any point.
 */
const DocumentBrief = ({ doc, expanded, onToggle }) => {
  const entities = useMemo(() => {
    if (!doc?.key_entities) return [];
    try {
      const parsed = JSON.parse(doc.key_entities);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [doc]);

  if (!doc) {
    // The conversation names a document the archive no longer lists. Say so
    // rather than silently rendering nothing.
    return (
      <div className="mb-5 px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 shrink-0">
        <FileText size={14} className="shrink-0" />
        No document is attached to this conversation. Start a new one to pick a document.
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-2xl bg-sky-50/70 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 overflow-hidden shrink-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-sky-100/50 dark:hover:bg-sky-900/30 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <FileText size={16} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-sm font-bold text-sky-800 dark:text-sky-300 truncate">
            About {doc.filename}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {doc.pages && (
            <span className="text-[11px] text-sky-700/70 dark:text-sky-400/70 hidden sm:inline tabular-nums">
              {doc.pages} pages · {doc.chunk_count} passages
            </span>
          )}
          <ChevronDown
            size={16}
            className={`text-sky-600 dark:text-sky-400 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed mb-3">
            {doc.summary || 'No summary was generated for this document.'}
          </p>
          {entities.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entities.map((entity, i) => (
                <span
                  key={i}
                  className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs px-2.5 py-1 rounded-md"
                >
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ChatScreen = ({
  sessions, setSessions, currentSessionId, setCurrentSessionId,
  messages, setMessages, documents, darkMode,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [briefOpen, setBriefOpen] = useState(true);

  const editInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageRefs = useRef({});
  const initialQuerySent = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const selectedDoc = documents.find((d) => d.id === currentSession?.doc_id);
  const grouped = useMemo(() => groupSessions(sessions), [sessions]);
  const isEmpty = messages.length === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) editInputRef.current.focus();
  }, [editingSessionId]);

  // Open the briefing on a fresh conversation, fold it away once there is
  // history. Either way it stays on screen and one click away.
  useEffect(() => {
    setBriefOpen(isEmpty);
  }, [currentSessionId, isEmpty]);

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

    const wasEmpty = isEmpty;
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
      // Re-read the transcript so the new messages carry their server ids,
      // which is what makes them editable.
      fetchHistory(activeSessionId).then(setMessages).catch(() => {});
      // The first message renames the session server-side, so refresh the list.
      if (wasEmpty) fetchSessions().then(setSessions).catch(() => {});
    } catch (err) {
      setError(errorMessage(err, 'That answer could not be generated.'));
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    }
    setLoading(false);
  };

  /**
   * Rewrite a question and regenerate. Everything from that message onward is
   * replaced, which is why the optimistic update truncates rather than appends.
   */
  const handleEditMessage = async (message, nextText) => {
    if (!currentSessionId || loading) return;
    const index = messages.findIndex((m) => m.id === message.id);
    const before = index >= 0 ? messages.slice(0, index) : messages;

    setMessages([...before, { ...message, content: nextText, edited: true }]);
    setLoading(true);
    setError('');

    try {
      await editMessage(message.id, nextText, currentSessionId);
      setMessages(await fetchHistory(currentSessionId));
    } catch (err) {
      setError(errorMessage(err, 'That question could not be regenerated.'));
      // Put the transcript back the way the server still has it.
      fetchHistory(currentSessionId).then(setMessages).catch(() => {});
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

  const renderSession = (session) => (
    <div
      key={session.id}
      onClick={() => editingSessionId !== session.id && setCurrentSessionId(session.id)}
      className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
        currentSessionId === session.id
          ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-700 text-sky-700 dark:text-sky-300'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-transparent hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      <div className="flex items-center gap-2.5 overflow-hidden flex-1 min-w-0">
        <MessageCircle
          size={15}
          className={`shrink-0 ${
            currentSessionId === session.id ? 'text-sky-500' : 'text-slate-400'
          }`}
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
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate leading-tight">{session.title}</p>
            {session.message_count > 0 && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                {Math.ceil(session.message_count / 2)} question
                {session.message_count > 2 ? 's' : ''}
              </p>
            )}
          </div>
        )}
      </div>

      {!editingSessionId && (
        <div
          className={`flex items-center gap-0.5 transition-opacity shrink-0 ${
            currentSessionId === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
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
            <Pencil size={13} />
          </button>
          <button
            onClick={(e) => handleDeleteChat(session.id, e)}
            className="text-slate-400 hover:text-red-500 p-1 rounded-md"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );

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
            className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white py-2.5 rounded-xl font-medium text-sm transition-all shadow-sm"
          >
            <Plus size={17} /> New conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {sessions.length === 0 ? (
            <p className="text-center p-4 text-sm text-slate-400">No conversations yet.</p>
          ) : (
            grouped.map((bucket) => (
              <div key={bucket.label} className="mb-4 last:mb-0">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest px-3 mb-1.5">
                  {bucket.label}
                </p>
                <div className="space-y-0.5">{bucket.items.map(renderSession)}</div>
              </div>
            ))
          )}
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
          {currentSessionId && (
            <DocumentBrief
              doc={selectedDoc}
              expanded={briefOpen}
              onToggle={() => setBriefOpen((v) => !v)}
            />
          )}

          {isEmpty && (
            <EmptyState
              icon={MessageSquare}
              title={
                documents.length === 0
                  ? 'The archive is empty'
                  : selectedDoc
                    ? `Ask anything about ${selectedDoc.filename}`
                    : 'Ask about a policy document'
              }
              hint={
                documents.length === 0
                  ? 'An administrator needs to ingest a document before you can ask questions.'
                  : 'Every answer cites the passages it came from. Ask for a workflow diagram or a comparison table and you will get one.'
              }
            />
          )}

          {messages.map((m, i) => (
            <ChatMessage
              key={m.id || i}
              message={m}
              darkMode={darkMode}
              busy={loading}
              onEdit={handleEditMessage}
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
            placeholder="Ask a question, or ask for a workflow diagram or a comparison table"
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

        {/*
          Prompt history.

          The old trigger was a 10px grey bar (bg-slate-300 / dark:bg-slate-600)
          floating with no label, which disappeared against the panel in light
          mode and against the page in dark mode - a control nobody could find
          in either theme. It is now a labelled, sky-coloured tab with a count,
          which reads as a control in both.
        */}
        {userMessages.length > 0 && (
          <div className="absolute top-1/2 -translate-y-1/2 right-0 z-20 flex items-center">
            {showPromptHistory ? (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-l-2xl shadow-xl w-72 overflow-hidden animate-fade-in">
                <div className="flex items-center justify-between p-3.5 border-b border-slate-100 dark:border-slate-700">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <History size={13} /> Your questions
                  </p>
                  <button
                    onClick={() => setShowPromptHistory(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="p-2 space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                  {userMessages.map((m, i) => (
                    <button
                      key={m.id || i}
                      onClick={() => {
                        messageRefs.current[m.originalIndex]?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'center',
                        });
                        setShowPromptHistory(false);
                      }}
                      className="w-full text-left p-2.5 rounded-lg text-xs text-slate-600 dark:text-slate-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:text-sky-700 dark:hover:text-sky-300 transition-colors flex gap-2"
                    >
                      <span className="text-slate-300 dark:text-slate-600 font-bold tabular-nums shrink-0">
                        {i + 1}
                      </span>
                      <span className="line-clamp-2 leading-snug">{m.content}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowPromptHistory(true)}
                title="Your questions in this conversation"
                className="flex flex-col items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 border-r-0 text-sky-600 dark:text-sky-400 shadow-md rounded-l-xl py-3 px-2 hover:bg-sky-50 dark:hover:bg-slate-700 transition-colors"
              >
                <History size={16} />
                <span className="text-[10px] font-bold tabular-nums">{userMessages.length}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatScreen;
