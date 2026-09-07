import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Clock, FileText, Key, MessageSquare, Network,
  Tag, Trash2, UploadCloud, User, AlertTriangle, Sparkles, BarChart3,
  GitCompare, CheckCircle2, Users, ShieldCheck, Building2,
} from 'lucide-react';

import {
  compareDocuments, createSession, deleteDocument, errorMessage,
  fetchAnalytics, fetchCoverage, fetchRecommendations, fetchStats,
  fetchUsers, login, register, saveSession, updateUserRole, uploadDocument,
} from '../api';
import { Citations, EmptyState, Spinner, SystemHealth } from '../components/common';
import { Answer } from '../components/Answer';
import logoImg from '../assets/logo.jpg';

// =============================================================================
// Auth
// =============================================================================
/**
 * The role selector is gone.
 *
 * It used to offer "Government Official (Admin)" as a dropdown, and the server
 * honoured whatever the client sent - so anyone could become an administrator
 * of a government policy archive by picking an option. Roles are now decided
 * entirely server-side: named in ADMIN_USERNAMES, or granted to the first
 * account created on an empty database.
 */
const ACCOUNT_TYPES = [
  { key: 'citizen', label: 'Citizen', hint: 'Read and question the public archive' },
  { key: 'researcher', label: 'Researcher', hint: 'Analyse and compare policy documents' },
  { key: 'official', label: 'Government official', hint: 'Manage the archive with an access code' },
];

export const AuthScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState({
    full_name: '',
    email: '',
    account_type: 'citizen',
    organisation: '',
    designation: '',
    access_code: '',
  });

  const isOfficial = details.account_type === 'official';
  const setDetail = (key, value) => setDetails((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = isLogin
        ? await login(username, password)
        : await register(username, password, details);
      saveSession(data);
      // A downgraded official is told plainly rather than silently handed a
      // reader account they believe is an administrator one.
      if (data.pending_admin_request) window.alert(data.message);
      onLogin(data.username, data.role);
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Please try again.'));
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-sky-50 via-white to-sky-50/30 min-h-screen flex items-center justify-center font-sans p-4">
      <div
        className={`w-full ${
          isLogin ? 'max-w-md' : 'max-w-lg'
        } p-8 bg-white rounded-2xl shadow-xl border border-slate-200 animate-fade-in max-h-[92vh] overflow-y-auto custom-scrollbar`}
      >
        <div className="text-center mb-8">
          <img
            src={logoImg}
            alt="ArchiveMind AI"
            className="w-20 h-20 mx-auto mb-4 rounded-2xl shadow-sm border border-slate-200 object-cover"
          />
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            ArchiveMind <span className="text-sky-500">AI</span>
          </h1>
          <p className="text-slate-600 mt-2 text-sm">
            {isLogin ? 'Sign in to explore the policy archive.' : 'Create an account to begin.'}
          </p>
        </div>

        {error && (
          <div className="p-4 rounded-xl text-sm font-medium mb-6 text-center border bg-red-50 text-red-600 border-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/*
            Who are you? Asked at sign-up so citizens, researchers and officials
            are distinguishable from the first screen. Note that this chooses a
            *profile*, not a permission: picking "Government official" without a
            valid access code creates a reader account with a pending request.
            The server decides the role either way - see backend/auth.py.
          */}
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                I am signing up as
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ACCOUNT_TYPES.map((type) => (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => setDetail('account_type', type.key)}
                    title={type.hint}
                    className={`px-2 py-2.5 rounded-xl border text-[11px] font-semibold transition-all leading-tight ${
                      details.account_type === type.key
                        ? 'bg-sky-50 border-sky-400 text-sky-700 ring-1 ring-sky-400'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-sky-200'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                {ACCOUNT_TYPES.find((t) => t.key === details.account_type)?.hint}
              </p>
            </div>
          )}

          {!isLogin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Full name
                </label>
                <input
                  type="text"
                  value={details.full_name}
                  onChange={(e) => setDetail('full_name', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Your name"
                  maxLength={120}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={details.email}
                  onChange={(e) => setDetail('email', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="you@example.com"
                  maxLength={160}
                  required
                />
              </div>
            </div>
          )}

          {!isLogin && (details.account_type !== 'citizen') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {isOfficial ? 'Department' : 'Institution'}
                </label>
                <input
                  type="text"
                  value={details.organisation}
                  onChange={(e) => setDetail('organisation', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder={isOfficial ? 'Ministry or department' : 'University or organisation'}
                  maxLength={160}
                  required={isOfficial}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Designation
                </label>
                <input
                  type="text"
                  value={details.designation}
                  onChange={(e) => setDetail('designation', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Your role or title"
                  maxLength={120}
                />
              </div>
            </div>
          )}

          {!isLogin && isOfficial && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Official access code
              </label>
              <div className="relative">
                <ShieldCheck
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  size={18}
                />
                <input
                  type="password"
                  value={details.access_code}
                  onChange={(e) => setDetail('access_code', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400 text-sm"
                  placeholder="Issued by your administrator"
                  maxLength={128}
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                Optional. Without it you can still sign up — your account is created as a
                reader and an administrator can approve official access afterwards.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Username
            </label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400"
                placeholder="Your username"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Password
            </label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 placeholder-slate-400"
                placeholder={isLogin ? 'Your password' : 'At least 8 characters, letters and numbers'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3.5 rounded-xl font-bold tracking-wide disabled:opacity-50 transition-colors shadow-md flex items-center justify-center gap-2 group"
          >
            {loading ? <Spinner size={18} /> : isLogin ? 'Sign in' : 'Create account'}
            {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
          </button>
        </form>

        <p className="mt-8 text-center text-slate-600 text-sm">
          {isLogin ? 'New here?' : 'Already have an account?'}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-sky-600 hover:text-sky-700 font-semibold ml-2"
          >
            {isLogin ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

// =============================================================================
// Shared pieces
// =============================================================================
const StatTile = ({ label, value, sub, accent = 'text-slate-900 dark:text-white' }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold tracking-wider uppercase mb-2">
      {label}
    </p>
    <p className={`text-4xl font-bold tabular-nums ${accent}`}>{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
  </div>
);

/** A single glanceable number for how much of what people ask, the archive answers. */
const CoverageRing = ({ value }) => {
  const pct = value == null ? null : Math.round(value * 100);
  const circumference = 2 * Math.PI * 26;
  const filled = pct == null ? 0 : (pct / 100) * circumference;
  const tone = pct == null ? '#cbd5e1' : pct >= 80 ? '#10b981' : pct >= 55 ? '#0ea5e9' : '#f59e0b';

  return (
    <div className="relative w-[68px] h-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="w-full h-full -rotate-90">
        <circle cx="34" cy="34" r="26" fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-slate-700" />
        <circle
          cx="34"
          cy="34"
          r="26"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={tone}
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums leading-none">
          {pct == null ? '—' : `${pct}%`}
        </span>
        <span className="text-[8px] text-slate-400 uppercase tracking-wider mt-0.5">covered</span>
      </div>
    </div>
  );
};

const useDocumentJump = (sessions, setSessions, setCurrentSessionId) => {
  const navigate = useNavigate();
  return async (doc, targetPath) => {
    const existing = sessions.find((s) => s.doc_id === doc.id);
    if (existing) {
      setCurrentSessionId(existing.id);
    } else {
      try {
        const session = await createSession(doc.filename, doc.id);
        setSessions((prev) => [session, ...prev]);
        setCurrentSessionId(session.id);
      } catch {
        // Navigation still makes sense even if the session could not be made.
      }
    }
    navigate(targetPath);
  };
};

// =============================================================================
// Reader dashboard
// =============================================================================
export const UserDashboard = ({
  username, documents, sessions, setSessions, setCurrentSessionId,
}) => {
  const navigate = useNavigate();
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const jump = useDocumentJump(sessions, setSessions, setCurrentSessionId);

  useEffect(() => {
    fetchRecommendations()
      .then(setRecommendations)
      .catch(() => setRecommendations([]))
      .finally(() => setLoadingRecs(false));
  }, []);

  return (
    <div className="p-8 animate-fade-in max-w-5xl mx-auto pb-20">
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
          Welcome back, <span className="text-sky-500">{username}</span>
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 text-lg">
          Explore the policy archive. Every answer cites the passages it came from.
        </p>
      </div>

      {(loadingRecs || recommendations.length > 0) && (
        <div className="mb-12">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
            <Tag className="text-purple-500" size={20} /> Worth exploring
          </h2>
          {loadingRecs ? (
            <div className="text-slate-400 flex items-center gap-2">
              <Spinner size={14} /> Reading the archive
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {recommendations.map((topic, i) => (
                <button
                  key={i}
                  onClick={() =>
                    navigate('/chat', {
                      state: { initialQuery: `What do these documents say about ${topic}?` },
                    })
                  }
                  className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-600 transition-all text-left shadow-sm hover:shadow-md group relative"
                >
                  <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-purple-500 transition-colors mb-1 pr-6">
                    {topic}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ask what the archive says about this
                  </p>
                  <ArrowRight
                    size={16}
                    className="absolute right-5 top-5 text-slate-400 group-hover:text-purple-500 group-hover:translate-x-1 transition-all"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
        <FileText className="text-sky-500" size={20} /> Policy directory
      </h2>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="The archive is empty"
          hint="An administrator needs to ingest a document before you can explore it."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 hover:border-sky-300 dark:hover:border-sky-600 transition-all shadow-sm hover:shadow-md flex flex-col"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{doc.filename}</h3>
                {doc.document_type && doc.document_type !== 'Other' && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0">
                    {doc.document_type}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 flex-1 leading-relaxed">
                {doc.summary || 'No summary is available for this document.'}
              </p>
              {doc.pages && (
                <p className="text-xs text-slate-400 mb-4">
                  {doc.pages} pages · {doc.chunk_count} indexed passages
                </p>
              )}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => jump(doc, '/chat')}
                  className="flex-1 bg-sky-50 dark:bg-sky-900/30 hover:bg-sky-100 text-sky-600 dark:text-sky-300 py-2.5 rounded-xl font-medium text-sm flex justify-center items-center gap-2 border border-sky-200 dark:border-sky-700"
                >
                  <MessageSquare size={16} /> Ask
                </button>
                <button
                  onClick={() => jump(doc, '/graph')}
                  className="flex-1 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 text-purple-600 dark:text-purple-300 py-2.5 rounded-xl font-medium text-sm flex justify-center items-center gap-2 border border-purple-200 dark:border-purple-700"
                >
                  <Network size={16} /> Map
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Admin dashboard
// =============================================================================
export const Dashboard = ({
  username, documents, sessions, setSessions, setCurrentSessionId, refreshDocuments,
}) => {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const jump = useDocumentJump(sessions, setSessions, setCurrentSessionId);

  useEffect(() => {
    Promise.allSettled([fetchStats(), fetchAnalytics(), fetchCoverage()])
      .then(([s, a, c]) => {
        if (s.status === 'fulfilled') setStats(s.value);
        if (a.status === 'fulfilled') setAnalytics(a.value);
        if (c.status === 'fulfilled') setCoverage(c.value);
      })
      .finally(() => setLoading(false));
  }, [documents]);

  const handleDelete = async (doc) => {
    if (!window.confirm(`Remove "${doc.filename}" from the archive? This cannot be undone.`)) return;
    try {
      const result = await deleteDocument(doc.id);
      if (result.warnings?.length) setError(result.warnings.join(' '));
      refreshDocuments();
    } catch (err) {
      setError(errorMessage(err, 'That document could not be removed.'));
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-7xl mx-auto pb-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
          Welcome back, <span className="text-sky-500">{username}</span>
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2 text-lg">
          Archive health, coverage, and what people cannot find.
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm flex items-start gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
        <StatTile
          label="Documents"
          value={documents.length}
          sub={`${stats?.total_chunks ?? 0} indexed passages`}
        />
        <StatTile
          label="Graph entities"
          value={loading ? '--' : stats?.total_entities ?? 0}
          sub={`${stats?.total_relations ?? 0} relationships`}
          accent="text-emerald-500"
        />
        <StatTile
          label="Questions asked"
          value={loading ? '--' : analytics?.total_queries ?? 0}
          sub={`${analytics?.last_24h ?? 0} in the last 24h`}
        />
        <StatTile
          label="Questions answered"
          value={loading ? '--' : analytics?.answered ?? 0}
          sub={
            analytics?.answer_rate != null
              ? `${Math.round(analytics.answer_rate * 100)}% of everything asked`
              : 'from your documents'
          }
          accent="text-sky-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/*
          Archive coverage.

          This panel used to be titled "What the archive could not answer" and
          rendered every failure in amber. The data is genuinely valuable - it
          is the ingestion backlog - but framed as a list of losses it reads as
          something broken, and a dashboard that opens on a red column trains
          people not to look at it. Same data, shown as demand: what the archive
          already answers well, and what people are asking for next.
        */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles size={17} className="text-sky-500" /> Archive coverage
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {coverage?.answered
                  ? `${coverage.answered} questions answered from your documents${
                      coverage.answered_this_week
                        ? ` · ${coverage.answered_this_week} this week`
                        : ''
                    }.`
                  : 'Answers appear here as people start asking questions.'}
              </p>
            </div>
            <CoverageRing value={coverage?.coverage_score} />
          </div>

          {loading ? (
            <Spinner size={20} className="text-sky-500" />
          ) : !coverage?.requested_topics?.length ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={18} /> Every question so far found supporting passages.
              </div>
              {coverage?.well_covered?.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {coverage.well_covered.map((d) => (
                    <span
                      key={d.filename}
                      className="text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-lg"
                    >
                      {d.filename} <span className="opacity-60">· {d.answered} answers</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                Most requested next
              </p>
              <div className="space-y-2">
                {coverage.requested_topics.map((topic, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 p-3 rounded-xl bg-sky-50/60 dark:bg-sky-900/10 border border-sky-100 dark:border-sky-900/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug truncate">
                        {topic.topic}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        asked {topic.asks} time{topic.asks === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-800 border border-sky-200 dark:border-sky-800 px-2 py-1 rounded-md shrink-0">
                      add a document
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                Each of these is a citizen telling you which document to add next.
              </p>
            </>
          )}
        </div>

        {/* Top concepts, now from the real graph */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
            <Tag size={17} className="text-sky-500" /> Most connected concepts
          </h3>
          {loading ? (
            <Spinner size={20} className="text-sky-500" />
          ) : !stats?.top_entities?.length ? (
            <p className="text-sm text-slate-400">
              Ask questions in Semantic Chat. Each answer builds the graph.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.top_entities.map((e, i) => (
                <span
                  key={i}
                  className="bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 border border-sky-200 dark:border-sky-700 px-2.5 py-1 rounded-lg text-xs font-medium"
                  title={e.type}
                >
                  {e.name} <span className="opacity-50">x{e.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-8">
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
          <Clock size={17} className="text-sky-500" /> Archive contents
        </h3>
        {documents.length === 0 ? (
          <p className="text-sm text-slate-400 py-6">Nothing ingested yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 p-4 rounded-xl flex justify-between items-center gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="bg-sky-50 dark:bg-sky-900/30 text-sky-500 p-2 rounded-lg border border-sky-100 dark:border-sky-800 shrink-0">
                    <FileText size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-slate-900 dark:text-white font-medium truncate">
                      {doc.filename}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(doc.created_at).toLocaleDateString()} · {doc.pages || '?'} pages ·{' '}
                      {doc.chunk_count || 0} passages · by {doc.uploaded_by}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => jump(doc, '/chat')}
                    className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-lg"
                    title="Ask about this document"
                  >
                    <MessageSquare size={17} />
                  </button>
                  <button
                    onClick={() => jump(doc, '/graph')}
                    className="p-2 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-lg"
                    title="Open its knowledge graph"
                  >
                    <Network size={17} />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg ml-1"
                    title="Remove from the archive"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {analytics?.top_documents?.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-8">
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
            <BarChart3 size={17} className="text-sky-500" /> Most consulted
          </h3>
          <div className="space-y-3">
            {analytics.top_documents.map((d) => {
              const max = analytics.top_documents[0].queries || 1;
              return (
                <div key={d.doc_id} className="flex items-center gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-300 w-56 truncate shrink-0">
                    {d.filename || 'Removed document'}
                  </span>
                  <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-500 rounded-full"
                      style={{ width: `${Math.round((d.queries / max) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 tabular-nums w-8 text-right">
                    {d.queries}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <SystemHealth />
    </div>
  );
};

// =============================================================================
// Upload
// =============================================================================
export const UploadScreen = ({ documents, onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setProgress(0);
    setStatus({ kind: 'info', text: 'Uploading and indexing. Large documents take a minute.' });
    try {
      const result = await uploadDocument(file, setProgress);
      setStatus({ kind: 'success', text: result.message });
      setFile(null);
      onUploadSuccess();
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err, 'That document could not be ingested.') });
    }
    setLoading(false);
  };

  return (
    <div className="p-8 animate-fade-in max-w-4xl mx-auto mt-6 pb-16">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
          <UploadCloud className="text-sky-500" /> Ingest a document
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6 leading-relaxed text-sm">
          PDF, DOCX, PPTX, TXT, MD or CSV, up to 25 MB. Text is split on document structure,
          embedded locally, and indexed for both semantic and exact-term search.
        </p>

        <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-10 text-center bg-slate-50/50 dark:bg-slate-700/30 hover:border-sky-400 transition-all">
          <input
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.csv,.md"
            onChange={(e) => setFile(e.target.files[0])}
            className="mb-6 block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-sky-50 file:text-sky-600 hover:file:bg-sky-100 cursor-pointer"
          />
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="bg-sky-500 text-white px-8 py-3 rounded-xl font-semibold hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md inline-flex items-center gap-2"
          >
            {loading ? <Spinner size={17} /> : <UploadCloud size={17} />}
            {loading ? 'Indexing' : 'Add to archive'}
          </button>

          {loading && progress > 0 && progress < 100 && (
            <div className="mt-5 max-w-xs mx-auto">
              <div className="h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-slate-400 mt-2">{progress}% uploaded</p>
            </div>
          )}
        </div>

        {status && (
          <div
            className={`mt-5 p-4 rounded-xl font-medium text-sm border ${
              status.kind === 'error'
                ? 'bg-red-50 text-red-600 border-red-200'
                : status.kind === 'success'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                  : 'bg-sky-50 text-sky-600 border-sky-200'
            }`}
          >
            {status.text}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-5 flex items-center gap-2">
          <Clock className="text-sky-500" size={19} /> In the archive
        </h3>
        {documents.length === 0 ? (
          <p className="text-slate-400 text-sm">Nothing ingested yet.</p>
        ) : (
          <div className="space-y-2">
            {documents.slice(0, 8).map((doc) => (
              <div
                key={doc.id}
                className="bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 p-4 rounded-xl flex items-center gap-3"
              >
                <FileText size={18} className="text-sky-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-slate-900 dark:text-white font-medium text-sm truncate">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(doc.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Compare
// =============================================================================
/**
 * The capability this architecture makes possible that a plain chat-with-PDF
 * tool cannot do. Overlapping government schemes are exactly the case it serves.
 */
export const CompareScreen = ({ documents, darkMode }) => {
  const [selected, setSelected] = useState([]);
  const [focus, setFocus] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev,
    );

  const run = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      setResult(await compareDocuments(selected, focus));
    } catch (err) {
      setError(errorMessage(err, 'The comparison could not be generated.'));
    }
    setLoading(false);
  };

  return (
    <div className="p-8 animate-fade-in max-w-5xl mx-auto pb-16">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
        <GitCompare className="text-sky-500" /> Compare documents
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-8">
        Pick two or three documents and see where they agree, differ, and leave gaps.
      </p>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 mb-6 shadow-sm">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Documents ({selected.length} of 3)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-5">
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => toggle(doc.id)}
              className={`p-3 rounded-xl border text-left text-sm transition-all flex items-center gap-2 ${
                selected.includes(doc.id)
                  ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-600 text-sky-700 dark:text-sky-300'
                  : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-200'
              }`}
            >
              <FileText size={15} className="shrink-0" />
              <span className="truncate">{doc.filename}</span>
            </button>
          ))}
        </div>

        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Focus (optional)
        </p>
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="eligibility criteria and benefit amounts"
          className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl py-3 px-4 focus:outline-none focus:border-sky-500 text-sm mb-5"
        />

        <button
          onClick={run}
          disabled={selected.length < 2 || loading}
          className="bg-sky-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed shadow-md inline-flex items-center gap-2"
        >
          {loading ? <Spinner size={16} /> : <GitCompare size={16} />}
          {loading ? 'Comparing' : 'Compare'}
        </button>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-8 shadow-sm">
          {/*
            Rendered through Answer, not raw ReactMarkdown. That is the fix for
            the side-by-side table arriving as one long line of pipe characters:
            CommonMark has no tables, so without remark-gfm every row was parsed
            as ordinary prose and reflowed.
          */}
          <Answer content={result.comparison} citations={result.citations} darkMode={darkMode} />
          <Citations citations={result.citations} />
        </div>
      )}
    </div>
  );
};

// =============================================================================
// User management
// =============================================================================
export const UsersScreen = ({ currentUsername }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () =>
    fetchUsers()
      .then(setUsers)
      .catch((err) => setError(errorMessage(err, 'The user list could not be loaded.')))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (username, role) => {
    setError('');
    try {
      await updateUserRole(username, role);
      load();
    } catch (err) {
      setError(errorMessage(err, 'That role could not be changed.'));
    }
  };

  return (
    <div className="p-8 animate-fade-in max-w-3xl mx-auto pb-16">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
        <Users className="text-sky-500" /> People
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-8">
        Administrators can ingest and remove documents. Readers can explore and ask questions.
        Roles are granted here, never chosen at sign-up.
      </p>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8">
            <Spinner size={20} className="text-sky-500" />
          </div>
        ) : (
          users.map((user) => (
            <div
              key={user.username}
              className="flex items-center justify-between gap-4 p-4 border-b border-slate-100 dark:border-slate-700 last:border-b-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-300 flex items-center justify-center font-bold uppercase text-sm shrink-0">
                  {(user.full_name || user.username).charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white text-sm truncate">
                    {user.full_name || user.username}
                    {user.full_name && (
                      <span className="text-xs text-slate-400 font-normal ml-1.5">
                        @{user.username}
                      </span>
                    )}
                    {user.username === currentUsername && (
                      <span className="text-xs text-slate-400 font-normal ml-2">you</span>
                    )}
                    {/*
                      The pending badge is the whole reason the sign-up form can
                      offer "Government official" safely: the request is recorded
                      and surfaced here for a human decision, never auto-granted.
                    */}
                    {user.requested_role === 'admin' && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                        <ShieldCheck size={10} /> requested official access
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 truncate flex items-center gap-1.5">
                    {user.organisation && (
                      <>
                        <Building2 size={11} className="shrink-0" />
                        <span className="truncate">
                          {user.designation ? `${user.designation}, ` : ''}
                          {user.organisation}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                      </>
                    )}
                    <span className="shrink-0">{user.documents} documents ingested</span>
                  </p>
                </div>
              </div>
              <select
                value={user.role}
                onChange={(e) => changeRole(user.username, e.target.value)}
                disabled={user.username === currentUsername}
                className="text-xs bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg py-2 px-3 focus:outline-none focus:border-sky-500 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <option value="user">Reader</option>
                <option value="admin">Administrator</option>
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
