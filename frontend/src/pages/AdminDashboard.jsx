import { useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart3, CheckCircle2, Clock, FileText, MessageSquare,
  Network, Sparkles, Tag, Trash2,
} from 'lucide-react';

import {
  deleteDocument, errorMessage, fetchAnalytics, fetchCoverage, fetchStats,
} from '../api';
import { Spinner, SystemHealth } from '../components/common';
import { CoverageRing, StatTile } from './dashboardParts';
import { useDocumentJump } from '../lib/useDocumentJump';

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
