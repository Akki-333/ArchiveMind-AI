/**
 * Pieces shared by both dashboards.
 *
 * Extracted so `AuthScreen` can stay eagerly loaded - it is needed before
 * anyone is signed in - while the dashboards themselves are code-split.
 *
 * Components only. `useDocumentJump` lives in lib/ because mixing a hook in
 * here trips react-refresh/only-export-components, and lint runs at
 * --max-warnings 0.
 */

// =============================================================================
// Shared pieces
// =============================================================================
export const StatTile = ({ label, value, sub, accent = 'text-slate-900 dark:text-white' }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
    <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold tracking-wider uppercase mb-2">
      {label}
    </p>
    <p className={`text-4xl font-bold tabular-nums ${accent}`}>{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
  </div>
);

/** A single glanceable number for how much of what people ask, the archive answers. */
export const CoverageRing = ({ value }) => {
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
