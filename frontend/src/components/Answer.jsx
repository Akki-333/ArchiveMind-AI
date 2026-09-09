/**
 * Rendering for a generated answer.
 *
 * Three problems this exists to fix, all visible in the same response:
 *
 * 1. **Tables arrived as a wall of pipes.** `react-markdown` implements
 *    CommonMark, and CommonMark has no tables - they are a GitHub extension.
 *    Without `remark-gfm` every `| Attribute | Doc A |` row was parsed as
 *    ordinary paragraph text and reflowed into one long line. That is the
 *    "bad alignment with unnecessary lines" in the comparison screen: the
 *    model's output was correct, the renderer simply could not read it.
 *
 * 2. **Citations rendered as literal punctuation.** `[1]` sat in the prose as
 *    three ASCII characters, so a well-cited answer looked like it had numbers
 *    scattered through it. They are now superscript chips that point at the
 *    source list, which is what a citation is supposed to look like.
 *
 * 3. **Diagrams were impossible.** A request for a workflow could only ever
 *    come back as prose. Mermaid blocks now render as real diagrams, loaded on
 *    demand so the library stays out of the main bundle.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle } from 'lucide-react';

import { CodeBlock } from './CodeBlock';

// --- Mermaid -----------------------------------------------------------------
let mermaidPromise = null;

/** Load and configure mermaid once, on first use rather than on page load. */
function loadMermaid(darkMode) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        // Answers are model-generated, so the diagram source is untrusted
        // input. 'strict' disables the HTML labels and click handlers that
        // would otherwise let markup out of the diagram and into the page.
        securityLevel: 'strict',
        theme: darkMode ? 'dark' : 'neutral',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        flowchart: { curve: 'basis', htmlLabels: false, padding: 12 },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export const Mermaid = ({ code, darkMode }) => {
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    loadMermaid(darkMode)
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then(({ svg: rendered }) => !cancelled && setSvg(rendered))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [code, darkMode]);

  // A diagram that will not parse falls back to its source rather than to a
  // blank space, so the answer never silently loses content.
  if (failed) {
    return (
      <div className="not-prose my-5">
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-2">
          <AlertTriangle size={13} /> This diagram could not be drawn. Its source:
        </div>
        <pre className="text-xs bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto custom-scrollbar">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="not-prose my-5 h-28 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs text-slate-400">
        Drawing diagram
      </div>
    );
  }

  return (
    <div className="not-prose my-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4 overflow-x-auto custom-scrollbar">
      <div
        className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
};

// --- Inline citations --------------------------------------------------------
const CITATION_TOKEN = /(\[\d{1,2}\])/g;

const CitationChip = ({ n, citation, onSelect }) => (
  <sup
    onClick={() => onSelect?.(Number(n))}
    title={
      citation
        ? `${citation.label}${citation.preview ? ` — ${citation.preview.slice(0, 120)}…` : ''}`
        : `Source ${n}`
    }
    className={`inline-flex items-center justify-center align-super mx-[1px] min-w-[15px] h-[15px] px-1 rounded text-[9px] font-bold leading-none transition-colors bg-sky-100 text-sky-700 hover:bg-sky-500 hover:text-white dark:bg-sky-900/60 dark:text-sky-300 dark:hover:bg-sky-500 dark:hover:text-white ${
      onSelect ? 'cursor-pointer' : ''
    }`}
  >
    {n}
  </sup>
);

/**
 * Walk rendered children and swap `[1]` for a chip.
 *
 * This runs on the already-parsed tree rather than on the raw markdown, so a
 * `[1]` inside a code block or a link target is left exactly as written.
 */
function withCitations(children, citations, onSelect) {
  const byNumber = new Map((citations || []).map((c) => [String(c.n), c]));

  const transform = (child, key) => {
    if (typeof child === 'string') {
      const parts = child.split(CITATION_TOKEN);
      if (parts.length === 1) return child;
      return parts.map((part, i) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        if (!match) return part;
        const n = match[1];
        return (
          <CitationChip
            key={`${key}-c-${i}`}
            n={n}
            citation={byNumber.get(n)}
            onSelect={onSelect}
          />
        );
      });
    }
    return child;
  };

  if (Array.isArray(children)) return children.map(transform);
  return transform(children, 'x');
}

// --- Answer ------------------------------------------------------------------
export const Answer = ({ content, citations, darkMode, onCitationSelect }) => {
  const components = useMemo(() => {
    const inline = (tag, className) => {
      const Component = ({ children, ...props }) => {
        const Tag = tag;
        return (
          <Tag className={className} {...props}>
            {withCitations(children, citations, onCitationSelect)}
          </Tag>
        );
      };
      Component.displayName = `Md(${tag})`;
      return Component;
    };

    return {
      // A mermaid fence is a diagram, not source code.
      code: ({ inline: isInline, className, children, ...props }) => {
        const language = /language-(\w+)/.exec(className || '')?.[1];
        if (!isInline && language === 'mermaid') {
          return <Mermaid code={String(children).replace(/\n$/, '')} darkMode={darkMode} />;
        }
        return (
          <CodeBlock inline={isInline} className={className} {...props}>
            {children}
          </CodeBlock>
        );
      },

      p: inline('p', 'my-3 leading-[1.7] first:mt-0 last:mb-0'),
      li: inline('li', 'my-1 leading-[1.65]'),
      td: inline('td', 'px-3 py-2 align-top border-t border-slate-100 dark:border-slate-700'),

      h1: ({ children }) => (
        <h2 className="text-lg font-bold mt-6 mb-2 first:mt-0 text-slate-900 dark:text-white">
          {children}
        </h2>
      ),
      h2: ({ children }) => (
        <h2 className="text-base font-bold mt-6 mb-2 first:mt-0 text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700 pb-1.5">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-sm font-bold mt-5 mb-1.5 first:mt-0 text-slate-800 dark:text-slate-100">
          {children}
        </h3>
      ),

      ul: ({ children }) => (
        <ul className="my-3 space-y-1 list-disc pl-5 marker:text-sky-400">{children}</ul>
      ),
      ol: ({ children }) => (
        <ol className="my-3 space-y-1 list-decimal pl-5 marker:text-slate-400">{children}</ol>
      ),

      // A wide table scrolls inside its own box. Without this it either
      // overflowed the chat bubble or squeezed every column to nothing.
      table: ({ children }) => (
        <div className="not-prose my-4 overflow-x-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-[13px] border-collapse">{children}</table>
        </div>
      ),
      thead: ({ children }) => (
        <thead className="bg-slate-50 dark:bg-slate-900/60">{children}</thead>
      ),
      th: ({ children }) => (
        <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
          {children}
        </th>
      ),
      tr: ({ children }) => <tr className="align-top">{children}</tr>,

      blockquote: ({ children }) => (
        <blockquote className="my-4 border-l-[3px] border-sky-300 dark:border-sky-700 pl-4 text-slate-600 dark:text-slate-400 italic">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-5 border-slate-200 dark:border-slate-700" />,
      a: ({ children, href }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sky-600 dark:text-sky-400 underline underline-offset-2"
        >
          {children}
        </a>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
      ),
    };
  }, [citations, darkMode, onCitationSelect]);

  return (
    <div className="text-[14.5px] text-slate-700 dark:text-slate-200">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
};

export default Answer;
