import { useState } from 'react';
import { Clock, FileText, UploadCloud } from 'lucide-react';

import { errorMessage, uploadDocument } from '../api';
import { Spinner } from '../components/common';

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
