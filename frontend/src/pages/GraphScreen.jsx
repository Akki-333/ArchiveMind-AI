import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType,
  Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useReactFlow,
  useStore,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import {
  Download, FileText, MessageSquare, Network, RefreshCw, Search,
  Layers, Crosshair, X, Quote, Database,
} from 'lucide-react';

import { buildFlowGraph, entityColor, legendFor, NODE_WIDTH, NODE_HEIGHT } from '../lib/graph';
import {
  errorMessage, expandEntity, fetchDocumentGraph, fetchHistory,
  fetchProvenance, highlightGraph,
} from '../api';
import { EmptyState, Spinner } from '../components/common';

// Below this zoom, edge labels are unreadable and become visual noise.
const EDGE_LABEL_MIN_ZOOM = 0.62;

// Never let fitView shrink text below legibility. Panning is a better trade
// than a graph rendered at 3px, which is what the old unbounded fitView did.
const FIT_VIEW_OPTIONS = { padding: 0.18, minZoom: 0.55, maxZoom: 1.15 };

// --- Node --------------------------------------------------------------------
/**
 * Labels wrap onto two lines instead of truncating. `truncate` used to amputate
 * exactly the long descriptive entities that carry the meaning, and wide nodes
 * made the whole graph wider, which made fitView shrink it further.
 */
const EntityNode = ({ data, selected }) => {
  const colour = entityColor(data.entityType);

  return (
    <div
      className={`relative rounded-xl border-2 bg-white dark:bg-slate-800 shadow-sm transition-all duration-200 ${
        selected ? 'ring-2 ring-offset-2 ring-sky-400 dark:ring-offset-slate-900' : ''
      }`}
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        borderColor: colour,
        opacity: data.dimmed ? 0.22 : 1,
      }}
      title={`${data.label} · ${data.entityType}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: colour, width: 7, height: 7, border: 'none' }}
      />
      <div className="px-3 py-2">
        <span
          className="block text-[9px] font-semibold uppercase tracking-widest mb-0.5"
          style={{ color: colour }}
        >
          {data.entityType}
        </span>
        <span className="block text-[13px] font-semibold leading-snug text-slate-800 dark:text-slate-100 line-clamp-2">
          {data.label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: colour, width: 7, height: 7, border: 'none' }}
      />
    </div>
  );
};

const nodeTypes = { entity: EntityNode };

// --- Edge --------------------------------------------------------------------
// Height of one staggered label row. Multiplied by the edge's `labelOffset`
// (computed in lib/graph.js) to spread the labels of every edge crossing the
// same band onto separate lines.
const LABEL_ROW = 21;

/**
 * The fix for labels printing on top of each other.
 *
 * React Flow's built-in edge label sits at the midpoint of the path. Every edge
 * from one level to the next has its midpoint at nearly the same y, so sibling
 * edges stacked four labels inside one narrow strip and the text became an
 * unreadable smear. This renders the label itself, displaced vertically by the
 * slot the layout assigned it, so parallel relationships read as parallel lines
 * of text. It also draws the label opaque with a border, so where a label does
 * sit over an edge the edge passes behind it rather than through it.
 */
const RelationEdge = ({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  label, data, style, markerEnd,
}) => {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 14,
  });

  const offset = (data?.labelOffset || 0) * LABEL_ROW;
  const dimmed = data?.dimmed;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {data?.showLabel && label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + offset}px)`,
              padding: '2px 7px',
              borderRadius: 5,
              fontSize: 10.5,
              fontWeight: 500,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              opacity: dimmed ? 0.12 : 1,
              background: data.labelBg,
              color: data.labelColor,
              border: `1px solid ${data.labelBorder}`,
            }}
          >
            {String(label).replace(/_/g, ' ')}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const edgeTypes = { relation: RelationEdge };

// --- Zoom-aware edge labels --------------------------------------------------
const ZoomWatcher = ({ onZoomChange }) => {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    onZoomChange(zoom);
  }, [zoom, onZoomChange]);
  return null;
};

/**
 * Re-frame the viewport whenever the graph is rebuilt.
 *
 * `fitView` as a prop only fits on first render. Rebuilding or expanding left
 * the old transform in place, so a larger graph spilled past the edges and
 * read as nodes piled on top of one another - the same symptom as a genuine
 * layout collision, from a different cause.
 */
const FitOnChange = ({ signature }) => {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!signature) return undefined;
    // Nodes need one paint to report their measured size before fitView can
    // compute real bounds.
    const timer = setTimeout(() => fitView(FIT_VIEW_OPTIONS), 60);
    return () => clearTimeout(timer);
  }, [signature, fitView]);
  return null;
};

// --- Canvas ------------------------------------------------------------------
const GraphCanvas = ({
  nodes, edges, darkMode, onNodeClick, onEdgeClick, onPaneClick, fitSignature,
}) => {
  const [zoom, setZoom] = useState(1);
  const showEdgeLabels = zoom >= EDGE_LABEL_MIN_ZOOM;

  // The canvas used to be hardcoded #1a1b1f regardless of theme, punching a
  // black hole into a white app. White nodes on near-black at small scale also
  // cause halation - glowing, fuzzy edges - which is a physical cause of eye
  // strain, not just an aesthetic mismatch.
  const canvasBg = darkMode ? '#0f172a' : '#f8fafc';
  const dotColour = darkMode ? '#1e293b' : '#dbe3ec';
  const edgeColour = darkMode ? '#64748b' : '#94a3b8';

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: 'relation',
        animated: false,
        style: {
          stroke: edge.data?.highlighted ? '#0ea5e9' : edgeColour,
          strokeWidth: edge.data?.highlighted ? 2.4 : 1.6,
          opacity: edge.data?.dimmed ? 0.15 : 1,
        },
        data: {
          ...edge.data,
          showLabel: showEdgeLabels,
          labelBg: darkMode ? '#1e293b' : '#ffffff',
          labelColor: darkMode ? '#cbd5e1' : '#475569',
          labelBorder: darkMode ? '#334155' : '#e2e8f0',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.data?.dimmed ? edgeColour : '#0ea5e9',
          width: 16,
          height: 16,
        },
      })),
    [edges, showEdgeLabels, darkMode, edgeColour],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.3}
      maxZoom={2.2}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      style={{ background: canvasBg }}
    >
      <ZoomWatcher onZoomChange={setZoom} />
      <FitOnChange signature={fitSignature} />
      <Background color={dotColour} gap={22} size={1.5} />
      <Controls
        className={darkMode ? '!bg-slate-800 !border-slate-700' : '!bg-white !border-slate-200'}
        showInteractive={false}
      />
    </ReactFlow>
  );
};

// --- Screen ------------------------------------------------------------------
const GraphScreenContent = ({ documents, sessions, currentSessionId, darkMode }) => {
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const initialDocId = currentSession?.doc_id || documents[0]?.id || '';

  const [graphDocId, setGraphDocId] = useState(initialDocId);
  const [mode, setMode] = useState('focus'); // 'focus' | 'map'
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeQuery, setActiveQuery] = useState(null);
  const [docQueries, setDocQueries] = useState([]);
  const [filter, setFilter] = useState('');
  const [hoveredType, setHoveredType] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [provenance, setProvenance] = useState(null);
  const [cached, setCached] = useState(false);
  const flowWrapper = useRef(null);

  const activeDoc = documents.find((d) => d.id === graphDocId);
  const legend = useMemo(() => legendFor(nodes), [nodes]);

  // Changes whenever the graph is genuinely different, which is the cue to
  // re-frame the viewport. Node count alone is not enough: expanding an entity
  // can swap nodes without changing the total.
  const fitSignature = useMemo(
    () => (nodes.length ? `${nodes.length}:${edges.length}:${nodes[0]?.id || ''}` : ''),
    [nodes, edges],
  );

  // --- Query history for the sidebar ---
  useEffect(() => {
    let cancelled = false;
    if (!graphDocId) {
      setDocQueries([]);
      return undefined;
    }
    const related = sessions.filter((s) => s.doc_id === graphDocId);
    if (!related.length) {
      setDocQueries([]);
      return undefined;
    }

    Promise.all(related.map((s) => fetchHistory(s.id).catch(() => [])))
      .then((histories) => {
        if (cancelled) return;
        const seen = new Set();
        const queries = [];
        histories.flat().forEach((m) => {
          if (m.role !== 'user') return;
          const key = m.content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            queries.push(m.content);
          }
        });
        setDocQueries(queries);
      })
      .catch(() => setDocQueries([]));

    return () => {
      cancelled = true;
    };
  }, [graphDocId, sessions]);

  const applyGraph = useCallback((rawNodes, rawLinks) => {
    const built = buildFlowGraph(rawNodes, rawLinks);
    setNodes(built.nodes);
    setEdges(built.edges);
  }, []);

  const resetGraph = () => {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setProvenance(null);
    setError('');
  };

  // --- Load the accumulated document map ---
  const loadDocumentMap = useCallback(
    async (docId) => {
      if (!docId) return;
      setLoading(true);
      resetGraph();
      setActiveQuery(null);
      try {
        const data = await fetchDocumentGraph(docId);
        applyGraph(data.nodes, data.links);
        setCached(false);
      } catch (err) {
        setError(errorMessage(err, 'That document map could not be loaded.'));
      }
      setLoading(false);
    },
    [applyGraph],
  );

  useEffect(() => {
    if (mode === 'map' && graphDocId) loadDocumentMap(graphDocId);
  }, [mode, graphDocId, loadDocumentMap]);

  // --- Load one question's focused graph ---
  const runQuery = async (queryText, refresh = false) => {
    if (activeQuery === queryText && !refresh) {
      setActiveQuery(null);
      resetGraph();
      return;
    }
    setActiveQuery(queryText);
    setLoading(true);
    resetGraph();
    try {
      const data = await highlightGraph(queryText, graphDocId, refresh);
      applyGraph(data.nodes, data.links);
      setCached(Boolean(data.cached));
      if (!data.nodes?.length) setError('No entities were extracted for this question.');
    } catch (err) {
      setError(errorMessage(err, 'The graph could not be built for this question.'));
    }
    setLoading(false);
  };

  const handleDocChange = (docId) => {
    setGraphDocId(docId);
    setActiveQuery(null);
    resetGraph();
    if (mode === 'map') loadDocumentMap(docId);
  };

  // --- Click to expand ---
  const handleNodeClick = async (_event, node) => {
    setSelectedNode(node.id);
    setProvenance(null);
    try {
      const data = await expandEntity(node.data.entityKey || node.id, graphDocId);
      if (!data.nodes?.length) return;
      const existingIds = new Set(nodes.map((n) => n.id));
      const mergedRaw = [
        ...nodes.map((n) => ({ id: n.id, type: n.data.entityType, key: n.data.entityKey })),
        ...data.nodes.filter((n) => !existingIds.has(n.id)),
      ];
      const mergedLinks = [
        ...edges.map((e) => ({ source: e.source, target: e.target, label: e.label })),
        ...data.links,
      ];
      applyGraph(mergedRaw, mergedLinks);
    } catch {
      // Expansion is additive; a failure just means nothing new appears.
    }
  };

  // --- Click an edge to read the passage it came from ---
  const handleEdgeClick = async (_event, edge) => {
    setProvenance({ loading: true, source: edge.source, target: edge.target });
    try {
      const data = await fetchProvenance(edge.source, edge.target, graphDocId);
      setProvenance({ ...data, loading: false });
    } catch (err) {
      setProvenance({
        loading: false,
        source: edge.source,
        target: edge.target,
        passages: [],
        error: errorMessage(err, 'No source passage is recorded for this relationship.'),
      });
    }
  };

  // --- Focus dimming and text filtering ---
  const neighbours = useMemo(() => {
    if (!selectedNode) return null;
    const set = new Set([selectedNode]);
    edges.forEach((e) => {
      if (e.source === selectedNode) set.add(e.target);
      if (e.target === selectedNode) set.add(e.source);
    });
    return set;
  }, [selectedNode, edges]);

  const displayNodes = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return nodes.map((n) => {
      const failsFilter = query && !n.data.label.toLowerCase().includes(query);
      const failsType = hoveredType && n.data.entityType !== hoveredType;
      const failsFocus = neighbours && !neighbours.has(n.id);
      return {
        ...n,
        selected: n.id === selectedNode,
        data: { ...n.data, dimmed: Boolean(failsFilter || failsType || failsFocus) },
      };
    });
  }, [nodes, filter, hoveredType, neighbours, selectedNode]);

  const displayEdges = useMemo(() => {
    const dimmedIds = new Set(displayNodes.filter((n) => n.data.dimmed).map((n) => n.id));
    return edges.map((e) => ({
      ...e,
      data: {
        ...e.data,
        dimmed: dimmedIds.has(e.source) || dimmedIds.has(e.target),
        highlighted: Boolean(selectedNode && (e.source === selectedNode || e.target === selectedNode)),
      },
    }));
  }, [edges, displayNodes, selectedNode]);

  const handleDownload = () => {
    const el = flowWrapper.current?.querySelector('.react-flow');
    if (!el) return;
    toPng(el, { backgroundColor: darkMode ? '#0f172a' : '#f8fafc', pixelRatio: 2 })
      .then((dataUrl) => {
        const link = document.createElement('a');
        link.download = `${activeDoc?.filename || 'knowledge-graph'}-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch(() => setError('The image could not be generated.'));
  };

  return (
    <div className="h-full flex animate-fade-in">
      {/* Sidebar */}
      <div className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-xs tracking-wider uppercase flex items-center gap-2 mb-3">
            <FileText size={14} className="text-sky-500" /> Document
          </h3>
          <select
            value={graphDocId || ''}
            onChange={(e) => handleDocChange(e.target.value)}
            className="w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg p-2.5 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            <option value="">Choose a document</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>{d.filename}</option>
            ))}
          </select>

          <div className="mt-3 flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {[
              { key: 'focus', label: 'By question', icon: Crosshair },
              { key: 'map', label: 'Whole map', icon: Layers },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] font-semibold py-1.5 rounded-md transition-colors ${
                  mode === key
                    ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'focus' ? (
          <>
            <div className="px-4 pt-4 pb-2">
              <h3 className="font-semibold text-slate-500 dark:text-slate-400 text-xs tracking-wider uppercase flex items-center gap-2">
                <MessageSquare size={14} className="text-sky-500" /> Questions asked
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5 custom-scrollbar">
              {!graphDocId ? (
                <p className="text-center p-4 text-xs text-slate-400">Choose a document first.</p>
              ) : docQueries.length === 0 ? (
                <p className="text-center p-4 text-xs text-slate-400">
                  No questions yet. Ask something in Semantic Chat and it will appear here.
                </p>
              ) : (
                docQueries.map((content, i) => (
                  <button
                    key={i}
                    onClick={() => runQuery(content)}
                    className={`w-full text-left p-3 rounded-xl transition-all text-xs leading-relaxed border ${
                      activeQuery === content
                        ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-700 text-sky-700 dark:text-sky-300 shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {content}
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 p-4 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            <p className="mb-3">
              Every question asked of this document adds to its map. The more the archive is used,
              the more complete this becomes.
            </p>
            {activeDoc && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <p className="font-semibold text-slate-700 dark:text-slate-200 mb-1">
                  {activeDoc.filename}
                </p>
                <p>{nodes.length} entities · {edges.length} relationships</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main */}
      <div className="flex-1 p-6 flex flex-col min-w-0">
        <div className="mb-4 flex flex-wrap justify-between items-start gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Network className="text-sky-500" /> Mind Map Explorer
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
              {activeDoc ? activeDoc.filename : 'Choose a document to explore its knowledge graph.'}
              {cached && <span className="ml-2 text-xs text-slate-400">· from cache</span>}
            </p>
          </div>

          <div className="flex gap-2 items-center">
            {nodes.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Find an entity"
                  className="w-44 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 focus:outline-none focus:border-sky-500 text-slate-700 dark:text-slate-200"
                />
              </div>
            )}
            {mode === 'focus' && activeQuery && (
              <button
                onClick={() => runQuery(activeQuery, true)}
                className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-xl text-sm font-medium hover:border-sky-300"
                title="Re-extract this graph"
              >
                <RefreshCw size={15} /> Rebuild
              </button>
            )}
            {nodes.length > 0 && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-md"
              >
                <Download size={15} /> PNG
              </button>
            )}
          </div>
        </div>

        {/* Legend built from the data, not from the idea of a graph */}
        {legend.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {legend.map(({ type, count, color }) => (
              <button
                key={type}
                onMouseEnter={() => setHoveredType(type)}
                onMouseLeave={() => setHoveredType(null)}
                className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300"
              >
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                {type}
                <span className="text-slate-400">{count}</span>
              </button>
            ))}
          </div>
        )}

        <div
          ref={flowWrapper}
          className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden relative bg-slate-50 dark:bg-slate-900"
        >
          {!activeDoc ? (
            <EmptyState
              icon={Database}
              title="No document selected"
              hint="Choose a document in the sidebar to explore how its concepts connect."
            />
          ) : loading ? (
            <div className="flex flex-col items-center justify-center h-full text-sky-500 gap-3">
              <Spinner size={28} />
              <p className="text-sm font-medium">
                {mode === 'map' ? 'Loading the document map' : 'Extracting entities'}
              </p>
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState
              icon={Network}
              title={mode === 'map' ? 'This map is still empty' : 'Pick a question'}
              hint={
                error
                || (mode === 'map'
                  ? 'Ask questions about this document in Semantic Chat. Each answer adds to the map.'
                  : 'Click a question in the sidebar to see the entities behind its answer.')
              }
            />
          ) : (
            <GraphCanvas
              nodes={displayNodes}
              edges={displayEdges}
              darkMode={darkMode}
              fitSignature={fitSignature}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={() => {
                setSelectedNode(null);
                setProvenance(null);
              }}
            />
          )}

          {/* Provenance: click an edge, read the sentence it came from */}
          {provenance && (
            <div className="absolute bottom-4 left-4 right-4 max-w-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Quote size={12} /> Source passage
                </p>
                <button onClick={() => setProvenance(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                <strong className="text-slate-700 dark:text-slate-200">{provenance.source}</strong>
                {' to '}
                <strong className="text-slate-700 dark:text-slate-200">{provenance.target}</strong>
              </p>
              {provenance.loading ? (
                <Spinner size={16} className="text-sky-500" />
              ) : provenance.passages?.length ? (
                <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-2">
                  {provenance.passages.map((p) => (
                    <div key={p.chunk_id} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      <span className="text-slate-400">
                        {p.source}{p.page ? `, p. ${p.page}` : ''}:{' '}
                      </span>
                      {p.text.slice(0, 320)}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {provenance.error || 'No source passage is recorded for this relationship.'}
                </p>
              )}
            </div>
          )}
        </div>

        {nodes.length > 0 && (
          <p className="mt-2 text-[11px] text-slate-400">
            Click a node to expand its connections · click an edge to read its source · click the
            canvas to clear
          </p>
        )}
      </div>
    </div>
  );
};

const GraphScreen = (props) => (
  <ReactFlowProvider>
    <GraphScreenContent {...props} />
  </ReactFlowProvider>
);

export default GraphScreen;
