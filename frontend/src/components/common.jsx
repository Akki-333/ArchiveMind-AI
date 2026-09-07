import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Check, ChevronDown, Copy, FileText, Plus, Settings, X, Moon, Sun,
  Quote, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react';
import { fetchHealth } from '../api';
import { getDocumentDomain, DOMAIN_LIST } from '../lib/graph';

// --- Navigation --------------------------------------------------------------
export const SidebarLink = ({ to, icon: Icon, children }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
        isActive
          ? 'bg-sky-50 text-sky-600 border border-sky-200 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 border border-transparent'
      }`}
    >
      <Icon size={20} className={isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400'} />
      <span className="font-medium text-sm tracking-wide">{children}</span>
    </Link>
  );
};

// --- Small building blocks ---------------------------------------------------
export const Spinner = ({ size = 16, className = '' }) => (
  <Loader2 size={size} className={`animate-spin ${className}`} />
);

export const EmptyState = ({ icon: Icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10">
    {Icon && <Icon size={44} className="mb-4 text-slate-300 dark:text-slate-600" />}
    <p className="text-base font-semibold text-slate-600 dark:text-slate-300">{title}</p>
    {hint && <p className="text-sm mt-2 text-slate-400 dark:text-slate-500 max-w-sm">{hint}</p>}
  </div>
);

// --- System health -----------------------------------------------------------
/**
 * The old dashboard rendered three hardcoded green "Connected" strings that
 * were literals in a JSX array. They stayed green whether or not anything was
 * reachable, which is worse than showing nothing: a status panel that cannot
 * report a problem actively misleads during the incident it exists for.
 * This reads /health/db, which performs real round-trips.
 */
export const SystemHealth = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchHealth()
        .then((data) => !cancelled && setHealth(data))
        .catch(() => !cancelled && setHealth({ status: 'down', services: {}, unavailable: [] }))
        .finally(() => !cancelled && setLoading(false));
    load();
    const timer = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const services = [
    { key: 'pinecone', label: 'Vector Search' },
    { key: 'neo4j', label: 'Knowledge Graph' },
    { key: 'llm', label: 'Language Model' },
  ];

  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
        System Health
      </h3>
      <div className="flex flex-wrap gap-3">
        {services.map(({ key, label }) => {
          const service = health?.services?.[key];
          const up = service?.status === 'up';
          const unknown = loading || !service;
          return (
            <div
              key={key}
              className={`bg-white dark:bg-slate-800 px-4 py-3 rounded-xl border flex items-center gap-3 ${
                unknown
                  ? 'border-slate-200 dark:border-slate-700'
                  : up
                    ? 'border-emerald-200 dark:border-emerald-800'
                    : 'border-red-200 dark:border-red-800'
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  unknown ? 'bg-slate-300 animate-pulse' : up ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              <div>
                <p className="text-[10px] text-slate-400 font-semibold tracking-widest uppercase">
                  {label}
                </p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {unknown ? 'Checking' : up ? `Online · ${service.latency_ms}ms` : 'Unavailable'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {health?.unavailable?.length > 0 && (
        <p className="text-xs text-red-500 mt-3 flex items-center gap-1.5">
          <AlertTriangle size={13} />
          {health.unavailable.join(', ')} unreachable. Answers may fail until this clears.
        </p>
      )}
    </div>
  );
};

// --- Markdown rendering ------------------------------------------------------
export const CodeBlock = ({ inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const codeString = String(children).replace(/\n$/, '');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return (
      <code
        className="bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded text-sm font-mono border border-sky-200 dark:border-sky-800"
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-6 rounded-lg overflow-hidden bg-[#0a0f1c] border border-slate-700/60 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#05080f] border-b border-slate-800">
        <span className="text-xs text-slate-500 font-mono uppercase tracking-wider">
          {match ? match[1] : 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors bg-slate-800/50 hover:bg-slate-700 px-2.5 py-1 rounded-md"
        >
          {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="p-4 overflow-x-auto text-sm text-slate-300 font-mono leading-relaxed custom-scrollbar">
        <code className={className} {...props}>{children}</code>
      </div>
    </div>
  );
};

// --- Citations ---------------------------------------------------------------
/**
 * A policy answer that cannot be traced to a clause is one no official can act
 * on. Every grounded answer now carries the passages it came from.
 */
export const Citations = ({ citations }) => {
  const [open, setOpen] = useState(null);
  if (!citations?.length) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 not-prose">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Quote size={11} /> Sources
      </p>
      <div className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <button
            key={citation.n}
            onClick={() => setOpen(open === citation.n ? null : citation.n)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors font-medium ${
              open === citation.n
                ? 'bg-sky-500 text-white border-sky-500'
                : 'bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-sky-300'
            }`}
            title={`Relevance ${citation.score}`}
          >
            [{citation.n}] {citation.label}
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed italic">
            {citations.find((c) => c.n === open)?.preview}
          </p>
        </div>
      )}
    </div>
  );
};

// --- Chat message ------------------------------------------------------------
export const ChatMessage = ({ message, msgRef }) => {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={msgRef} className={`mb-6 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative px-4 py-3 rounded-2xl max-w-[82%] leading-relaxed ${
          isUser
            ? 'bg-sky-500 text-white rounded-tr-sm shadow-md break-words whitespace-pre-wrap'
            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm prose prose-slate dark:prose-invert prose-sm max-w-none break-words min-w-0 prose-chat'
        }`}
      >
        {isUser ? (
          message.content
        ) : (
          <>
            <ReactMarkdown components={{ code: CodeBlock }}>{message.content}</ReactMarkdown>
            <Citations citations={message.citations} />
            {message.grounded === false && (
              <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 not-prose">
                <AlertTriangle size={12} /> No supporting passage was found for this question.
              </p>
            )}
          </>
        )}
        <button
          onClick={handleCopy}
          className={`absolute -bottom-3 ${isUser ? 'right-2' : 'left-2'} opacity-0 group-hover:opacity-100 transition-all bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-slate-400 hover:text-sky-500 p-1.5 rounded-lg`}
          title="Copy to clipboard"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
};

// --- Modals ------------------------------------------------------------------
export const NewChatModal = ({ documents, onClose, onConfirm }) => {
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');

  const filteredDocs = selectedDomain
    ? documents.filter((doc) => getDocumentDomain(doc) === selectedDomain)
    : [];

  const domainsWithDocs = DOMAIN_LIST.filter((d) =>
    documents.some((doc) => getDocumentDomain(doc) === d.label),
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8 w-full max-w-lg mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Plus size={20} className="text-sky-500" /> Start a conversation
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 p-4 rounded-xl">
            The archive is empty. An administrator needs to ingest a document first.
          </p>
        ) : (
          <>
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                1. Choose a domain
              </label>
              <div className="relative">
                <select
                  value={selectedDomain}
                  onChange={(e) => {
                    setSelectedDomain(e.target.value);
                    setSelectedDocId('');
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 appearance-none cursor-pointer"
                >
                  <option value="">Select a policy area</option>
                  {domainsWithDocs.map((d) => (
                    <option key={d.label} value={d.label}>{d.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={18} />
              </div>
            </div>

            {selectedDomain && (
              <div className="mb-6">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  2. Choose a document
                </label>
                <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center gap-3 ${
                        selectedDocId === doc.id
                          ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-600 text-sky-700 dark:text-sky-300'
                          : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 hover:border-sky-200 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <FileText size={16} className={selectedDocId === doc.id ? 'text-sky-500' : 'text-slate-400'} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{doc.filename}</p>
                        {doc.summary && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{doc.summary}</p>
                        )}
                      </div>
                      {selectedDocId === doc.id && <Check size={16} className="text-sky-500 ml-auto shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex gap-3 mt-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(documents.find((d) => d.id === selectedDocId) || null)}
            disabled={!selectedDocId}
            className="flex-1 py-3 rounded-xl bg-sky-500 text-white font-semibold hover:bg-sky-600 shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
};

export const SettingsPanel = ({ darkMode, setDarkMode, onClose, username, role }) => (
  <div
    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center"
    onClick={onClose}
  >
    <div
      className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-8 w-full max-w-sm mx-4 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Settings size={20} className="text-sky-500" /> Settings
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-4">
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-sky-300 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            {darkMode ? <Moon size={20} className="text-sky-400" /> : <Sun size={20} className="text-amber-400" />}
            <div>
              <p className="font-semibold text-slate-900 dark:text-white text-sm">Appearance</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {darkMode ? 'Dark' : 'Light'} — tap to switch
              </p>
            </div>
          </div>
          <span
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
              darkMode ? 'bg-sky-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                darkMode ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </span>
        </button>

        <div className="p-4 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">Signed in as</p>
          <p className="font-semibold text-slate-900 dark:text-white text-sm">{username}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-emerald-500" />
            {role === 'admin'
              ? 'Administrator — can ingest and remove documents'
              : 'Reader — can explore and ask questions'}
          </p>
        </div>
      </div>
    </div>
  </div>
);
