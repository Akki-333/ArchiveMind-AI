import { useState } from 'react';
import { FileText, GitCompare } from 'lucide-react';

import { compareDocuments, errorMessage } from '../api';
import { Citations, Spinner } from '../components/common';
import { Answer } from '../components/Answer';

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
