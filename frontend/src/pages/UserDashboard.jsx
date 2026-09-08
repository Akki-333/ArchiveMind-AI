import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, MessageSquare, Network, Tag } from 'lucide-react';

import { fetchRecommendations } from '../api';
import { EmptyState, Spinner } from '../components/common';
import { useDocumentJump } from '../lib/useDocumentJump';

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
