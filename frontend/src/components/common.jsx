import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Check, ChevronDown, Copy, FileText, Plus, Settings, X, Moon, Sun,
  Quote, AlertTriangle, CheckCircle2, Loader2, Pencil, Sparkles,
  User, Mail, Building2, BadgeCheck, KeyRound, ShieldCheck,
} from 'lucide-react';
import { fetchHealth, fetchIdentity, updatePassword, updateProfile, errorMessage } from '../api';
import { getDocumentDomain, DOMAIN_LIST } from '../lib/graph';
import { CodeBlock } from './CodeBlock';
import { Answer } from './Answer';

export { CodeBlock };

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

// --- Citations ---------------------------------------------------------------
/**
 * A policy answer that cannot be traced to a clause is one no official can act
 * on. Every grounded answer carries the passages it came from.
 *
 * `openN` is optional and makes the panel controllable, so clicking an inline
 * citation chip inside the answer opens the matching source beneath it.
 */
export const Citations = ({ citations, openN, onOpenChange }) => {
  const [internalOpen, setInternalOpen] = useState(null);
  const controlled = openN !== undefined;
  const open = controlled ? openN : internalOpen;
  const setOpen = controlled ? onOpenChange : setInternalOpen;

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
            className={`text-xs pl-1.5 pr-2.5 py-1 rounded-lg border transition-colors font-medium flex items-center gap-1.5 ${
              open === citation.n
                ? 'bg-sky-500 text-white border-sky-500'
                : 'bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-sky-300'
            }`}
            title={`Relevance ${citation.score}`}
          >
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold shrink-0 ${
                open === citation.n
                  ? 'bg-white/25 text-white'
                  : 'bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300'
              }`}
            >
              {citation.n}
            </span>
            <span className="truncate max-w-[220px]">{citation.label}</span>
          </button>
        ))}
      </div>
      {open != null && (
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
/**
 * `onEdit` turns on the pencil, to the left of the copy button, on your own
 * messages. Editing rewrites the question and regenerates from that point, so
 * the transcript never claims the assistant answered something you did not ask.
 */
export const ChatMessage = ({ message, msgRef, onEdit, darkMode, busy }) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [openCitation, setOpenCitation] = useState(null);
  const isUser = message.role === 'user';
  const canEdit = isUser && typeof onEdit === 'function' && Boolean(message.id);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const submitEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== message.content) onEdit(message, next);
  };

  if (editing) {
    return (
      <div ref={msgRef} className="mb-6 flex justify-end">
        <div className="w-full max-w-[82%] rounded-2xl rounded-tr-sm border border-sky-300 dark:border-sky-600 bg-white dark:bg-slate-800 shadow-md p-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Edit your question
          </p>
          <textarea
            value={draft}
            autoFocus
            rows={Math.min(Math.max(draft.split('\n').length, 2), 8)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitEdit();
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-sky-500 resize-none"
          />
          <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
            <p className="text-[11px] text-slate-400">The answer below will be replaced.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                disabled={!draft.trim() || draft.trim() === message.content}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save and regenerate
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={msgRef} className={`mb-7 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`group relative px-4 py-3 rounded-2xl max-w-[82%] ${
          isUser
            ? 'bg-sky-500 text-white rounded-tr-sm shadow-md break-words whitespace-pre-wrap leading-relaxed'
            : 'bg-white dark:bg-slate-800 rounded-tl-sm border border-slate-200 dark:border-slate-700 shadow-sm break-words min-w-0'
        }`}
      >
        {isUser ? (
          <>
            {message.content}
            {message.edited && (
              <span className="block text-[10px] text-sky-100/80 mt-1">edited</span>
            )}
          </>
        ) : (
          <>
            <Answer
              content={message.content}
              citations={message.citations}
              darkMode={darkMode}
              onCitationSelect={setOpenCitation}
            />
            <Citations
              citations={message.citations}
              openN={openCitation}
              onOpenChange={setOpenCitation}
            />
            {message.grounded === false && (
              <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Sparkles size={12} /> Narrow this down with a scheme name, section number
                or date from the document for a sourced answer.
              </p>
            )}
          </>
        )}

        <div
          className={`absolute -bottom-3.5 ${
            isUser ? 'right-2' : 'left-2'
          } flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all`}
        >
          {canEdit && (
            <button
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              disabled={busy}
              className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-slate-400 hover:text-sky-500 disabled:opacity-40 p-1.5 rounded-lg"
              title="Edit this question and regenerate"
            >
              <Pencil size={12} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 shadow-sm text-slate-400 hover:text-sky-500 p-1.5 rounded-lg"
            title="Copy to clipboard"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
        </div>
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

// --- Settings ----------------------------------------------------------------
const Field = ({ icon: Icon, label, value, onChange, placeholder, type = 'text', ...rest }) => (
  <label className="block">
    <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
      {label}
    </span>
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl py-2.5 ${
          Icon ? 'pl-9' : 'pl-3'
        } pr-3 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400`}
        {...rest}
      />
    </div>
  </label>
);

const ROLE_BLURB = {
  admin: 'Administrator — can ingest and remove documents',
  user: 'Reader — can explore and ask questions',
};

/**
 * Settings, with an editable profile.
 *
 * Note what is read-only here: username, role and account type. Those are
 * identity and privilege. A self-service form that could change them would
 * hand the client exactly the decision the whole role model exists to keep on
 * the server. Everything a person legitimately owns about themselves — their
 * name, contact, department, job title and password — is editable.
 */
export const SettingsPanel = ({
  darkMode, setDarkMode, onClose, username, role, onProfileSaved,
}) => {
  const [tab, setTab] = useState('general');
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({
    full_name: '', email: '', organisation: '', designation: '',
  });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchIdentity()
      .then((data) => {
        setProfile(data);
        setForm({
          full_name: data.full_name || '',
          email: data.email || '',
          organisation: data.organisation || '',
          designation: data.designation || '',
        });
      })
      .catch(() => setProfile(null));
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      const updated = await updateProfile(form);
      setProfile(updated);
      setStatus({ kind: 'success', text: 'Your profile has been saved.' });
      onProfileSaved?.(updated);
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err, 'Your profile could not be saved.') });
    }
    setSaving(false);
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await updatePassword(passwords);
      setPasswords({ current_password: '', new_password: '' });
      setStatus({ kind: 'success', text: 'Your password has been updated.' });
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err, 'Your password could not be changed.') });
    }
    setSaving(false);
  };

  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'profile', label: 'Profile' },
    { key: 'security', label: 'Security' },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md animate-fade-in max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings size={20} className="text-sky-500" /> Settings
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6">
          <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-900/60 rounded-xl">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setStatus(null);
                }}
                className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
                  tab === t.key
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {status && (
          <div
            className={`mx-6 mt-4 px-3.5 py-2.5 rounded-xl text-xs font-medium border ${
              status.kind === 'error'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800'
                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
            }`}
          >
            {status.text}
          </div>
        )}

        <div className="p-6 overflow-y-auto custom-scrollbar space-y-4">
          {tab === 'general' && (
            <>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/60 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-sky-300 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  {darkMode ? (
                    <Moon size={20} className="text-sky-400" />
                  ) : (
                    <Sun size={20} className="text-amber-400" />
                  )}
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white text-sm">
                      Appearance
                    </p>
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
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">
                  Signed in as
                </p>
                <p className="font-semibold text-slate-900 dark:text-white text-sm">
                  {profile?.full_name || username}
                  {profile?.full_name && (
                    <span className="text-slate-400 font-normal ml-1.5">@{username}</span>
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-500" />
                  {ROLE_BLURB[role] || ROLE_BLURB.user}
                </p>
                {profile?.requested_role === 'admin' && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-start gap-1.5">
                    <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                    Official access requested — waiting for an administrator to approve it.
                  </p>
                )}
                {/*
                  Telling people their questions are recorded is not optional
                  politeness. This is a government service, the log is shown to
                  administrators, and someone asking what benefits they qualify
                  for deserves to know that before they type it.
                */}
                <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                  Questions you ask are recorded so administrators can see which
                  documents the archive is missing. They are deleted automatically
                  after the retention period, and the coverage reports group them
                  by topic rather than showing them next to your name.
                </p>
                {profile && (
                  <div className="flex gap-4 mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      <strong className="text-slate-900 dark:text-white">
                        {profile.conversations}
                      </strong>{' '}
                      conversations
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      <strong className="text-slate-900 dark:text-white">
                        {profile.documents}
                      </strong>{' '}
                      documents added
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'profile' && (
            <form onSubmit={saveProfile} className="space-y-4">
              <Field
                icon={User}
                label="Full name"
                value={form.full_name}
                onChange={(v) => setForm({ ...form, full_name: v })}
                placeholder="Your name"
                maxLength={120}
              />
              <Field
                icon={Mail}
                label="Email"
                type="email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="you@example.gov.in"
                maxLength={160}
              />
              <Field
                icon={Building2}
                label="Department or organisation"
                value={form.organisation}
                onChange={(v) => setForm({ ...form, organisation: v })}
                placeholder="Ministry, department or institution"
                maxLength={160}
              />
              <Field
                icon={BadgeCheck}
                label="Designation"
                value={form.designation}
                onChange={(v) => setForm({ ...form, designation: v })}
                placeholder="Your role or title"
                maxLength={120}
              />
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your username and access level are set by an administrator and cannot be
                changed here.
              </p>
              <button
                type="submit"
                disabled={saving}
                className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size={15} /> : <Check size={15} />} Save profile
              </button>
            </form>
          )}

          {tab === 'security' && (
            <form onSubmit={savePassword} className="space-y-4">
              <Field
                icon={KeyRound}
                label="Current password"
                type="password"
                value={passwords.current_password}
                onChange={(v) => setPasswords({ ...passwords, current_password: v })}
                placeholder="Your current password"
                autoComplete="current-password"
                required
              />
              <Field
                icon={KeyRound}
                label="New password"
                type="password"
                value={passwords.new_password}
                onChange={(v) => setPasswords({ ...passwords, new_password: v })}
                placeholder="At least 8 characters, letters and numbers"
                autoComplete="new-password"
                required
              />
              <button
                type="submit"
                disabled={saving || !passwords.current_password || !passwords.new_password}
                className="w-full bg-slate-900 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size={15} /> : <ShieldCheck size={15} />} Update password
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
