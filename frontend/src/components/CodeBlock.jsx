/**
 * A fenced code block with a copy button.
 *
 * Lives in its own module because both `common.jsx` and `Answer.jsx` need it,
 * and `common.jsx` imports `Answer.jsx`. Leaving it in `common.jsx` made that
 * a cycle; extracting the leaf makes the dependency one-directional.
 */
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

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
        className="bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 px-1.5 py-0.5 rounded text-[0.85em] font-mono border border-sky-200 dark:border-sky-800"
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="not-prose relative group my-5 rounded-xl overflow-hidden bg-[#0a0f1c] border border-slate-700/60 shadow-lg">
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
        <code className={className} {...props}>
          {children}
        </code>
      </div>
    </div>
  );
};

export default CodeBlock;
