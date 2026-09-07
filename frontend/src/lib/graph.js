/**
 * Graph layout and colour.
 *
 * Why this replaces the dagre call it came from:
 *
 * The extraction reliably produces a star topology - a few hubs, each pointing
 * at several leaf attributes. Dagre with rankdir "TB" puts every leaf on one
 * rank, so width grows linearly with node count while height stays at two
 * ranks. With the old constants (nodesep 100, node widths up to 350px), twelve
 * leaves produced a graph about 5,080 x 300px inside a 1,072 x 610px canvas.
 * fitView then had to scale to 0.21, which rendered 14px labels at under 3px
 * and left 90% of the canvas empty.
 *
 * The fix is to stop laying a star graph out as a tree. Any level wider than
 * MAX_PER_ROW wraps into a grid, so the same twelve leaves occupy roughly
 * 900 x 440px - an aspect ratio of 2.0 against the canvas's 1.76, which fits
 * at full size with the labels readable.
 */

// Fixed node geometry. Narrow nodes with two-line wrap beat wide nodes with
// truncation: they read better and they keep the whole graph smaller.
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 58;

const COLUMN_GAP = 34;
const ROW_GAP = 30;
// Generous, because this is the band every edge and every edge label has to
// cross. The old 88px left roughly 30px of clear space between two rows of
// nodes, which four parallel labels then had to share - so they overlapped.
const LEVEL_GAP = 130;
const MAX_PER_ROW = 4;

// A node whose label wraps to a second line is taller than NODE_HEIGHT. Laying
// every row out on a fixed pitch therefore let tall nodes grow into the row
// beneath them. Row height is now measured from the tallest node in the row.
const CHARS_PER_LINE = 22;
const LINE_HEIGHT = 17;
const NODE_CHROME = 30; // type label + vertical padding

function estimateNodeHeight(label = '') {
  const lines = Math.min(Math.ceil(String(label).length / CHARS_PER_LINE) || 1, 2);
  return Math.max(NODE_HEIGHT, NODE_CHROME + lines * LINE_HEIGHT);
}

/**
 * Entity palette, keyed to the vocabulary the extraction prompt emits.
 * Muted rather than saturated: a dozen bright nodes on one canvas is noise.
 * Each hue stays legible on both the light and the dark canvas.
 */
export const ENTITY_COLORS = {
  Scheme: '#0f766e',
  Provision: '#4f46e5',
  Organisation: '#0369a1',
  Person: '#7c3aed',
  Beneficiary: '#b45309',
  Benefit: '#15803d',
  Requirement: '#be123c',
  Amount: '#a16207',
  Date: '#0e7490',
  Location: '#c2410c',
  Concept: '#475569',
};

export const DEFAULT_ENTITY_COLOR = ENTITY_COLORS.Concept;

export function entityColor(type) {
  return ENTITY_COLORS[type] || DEFAULT_ENTITY_COLOR;
}

/** Types actually present, so the legend describes this graph rather than the idea of a graph. */
export function legendFor(nodes) {
  const counts = new Map();
  nodes.forEach((n) => {
    const type = n.data?.entityType || 'Concept';
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count, color: entityColor(type) }));
}

/**
 * Layered layout with row wrapping, crossing reduction and measured row heights.
 *
 * Three changes over the first version, each fixing one cause of the overlap
 * that could still appear on a rebuilt graph:
 *
 * 1. **Longest-path layering, not breadth-first.** BFS assigns a node the
 *    depth of the *first* parent that reaches it. If "Article 46" is reached
 *    from a root at depth 1 and also from a depth-1 sibling, BFS still puts it
 *    at depth 1 - beside its own parent - so the edge between them ran
 *    sideways straight through the row. Longest-path layering places every
 *    node strictly below every one of its parents, so no edge is ever
 *    horizontal and none can pass through a node box on its own level.
 *
 * 2. **Barycentre ordering.** Within a level, nodes are reordered towards the
 *    average position of their neighbours on the level above, swept forwards
 *    and backwards a few times. This is the standard Sugiyama heuristic and it
 *    is what stops four edges fanning across each other - in the reported
 *    screenshot, four "contains provision" edges crossing and stacking their
 *    labels in the same 30px band.
 *
 * 3. **Measured row heights.** A two-line label makes a node taller than
 *    NODE_HEIGHT; a fixed row pitch let it grow into the row below.
 *
 * Returns nodes with `position` and `height` set, plus the overall bounds.
 */
export function layoutGraph(nodes, edges) {
  if (!nodes.length) return { nodes: [], width: 0, height: 0 };

  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map();
  const parents = new Map();
  nodes.forEach((n) => {
    children.set(n.id, []);
    parents.set(n.id, []);
  });

  const realEdges = edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
  );
  realEdges.forEach((e) => {
    children.get(e.source).push(e.target);
    parents.get(e.target).push(e.source);
  });

  // --- 1. Longest-path layering -------------------------------------------
  // depth(n) = 1 + max(depth(parent)). Cycles are broken by the visiting set,
  // so a cyclic graph degrades to a sensible layering instead of hanging.
  const depth = new Map();
  const visiting = new Set();

  const resolveDepth = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // cycle: treat this arc as a back edge
    visiting.add(id);
    let best = 0;
    for (const parent of parents.get(id) || []) {
      best = Math.max(best, resolveDepth(parent) + 1);
    }
    visiting.delete(id);
    depth.set(id, best);
    return best;
  };
  nodes.forEach((n) => resolveDepth(n.id));

  // --- 2. Group into levels, then reduce crossings -------------------------
  const levels = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.id) || 0;
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d).push(n.id);
  });

  const orderedDepths = [...levels.keys()].sort((a, b) => a - b);
  const order = new Map(); // id -> index within its level
  orderedDepths.forEach((d) => {
    levels.get(d).forEach((id, i) => order.set(id, i));
  });

  const barycentre = (id, neighbourIds) => {
    const known = neighbourIds.filter((n) => order.has(n)).map((n) => order.get(n));
    // A node with no neighbours on the reference level keeps its place rather
    // than collapsing to zero and jumping to the far left.
    return known.length
      ? known.reduce((a, b) => a + b, 0) / known.length
      : order.get(id) ?? 0;
  };

  const sweep = (depths, neighboursOf) => {
    depths.forEach((d) => {
      const level = levels.get(d);
      const scored = level.map((id) => ({ id, key: barycentre(id, neighboursOf(id)) }));
      // Stable within equal barycentres, so siblings stay adjacent.
      scored.sort((a, b) => a.key - b.key || order.get(a.id) - order.get(b.id));
      const reordered = scored.map((s) => s.id);
      levels.set(d, reordered);
      reordered.forEach((id, i) => order.set(id, i));
    });
  };

  for (let pass = 0; pass < 4; pass += 1) {
    sweep(orderedDepths.slice(1), (id) => parents.get(id) || []);
    sweep([...orderedDepths].reverse().slice(1), (id) => children.get(id) || []);
  }

  // --- 3. Wrap wide levels into a grid and place ---------------------------
  const heights = new Map(nodes.map((n) => [n.id, estimateNodeHeight(n.data?.label || n.id)]));

  let widest = 0;
  const plan = orderedDepths.map((d) => {
    const levelIds = levels.get(d);
    const perRow = Math.min(MAX_PER_ROW, levelIds.length);
    const rows = [];
    for (let i = 0; i < levelIds.length; i += perRow) {
      rows.push(levelIds.slice(i, i + perRow));
    }
    widest = Math.max(widest, perRow * NODE_WIDTH + (perRow - 1) * COLUMN_GAP);
    return { rows };
  });

  const positions = new Map();
  let y = 0;
  plan.forEach(({ rows }, levelIndex) => {
    rows.forEach((row) => {
      const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
      const startX = (widest - rowWidth) / 2;
      const rowHeight = Math.max(...row.map((id) => heights.get(id) || NODE_HEIGHT));
      row.forEach((id, columnIndex) => {
        positions.set(id, { x: startX + columnIndex * (NODE_WIDTH + COLUMN_GAP), y });
      });
      y += rowHeight + ROW_GAP;
    });
    if (levelIndex < plan.length - 1) y += LEVEL_GAP - ROW_GAP;
  });

  return {
    nodes: nodes.map((n) => ({
      ...n,
      position: positions.get(n.id) || { x: 0, y: 0 },
      targetPosition: 'top',
      sourcePosition: 'bottom',
    })),
    depths: depth,
    width: widest,
    height: Math.max(0, y - ROW_GAP),
  };
}

/**
 * Convert an API payload into laid-out React Flow nodes and edges.
 * `entityType` is carried through - the backend has always sent it and the
 * old frontend dropped it on the floor.
 */
export function buildFlowGraph(rawNodes = [], rawLinks = []) {
  const seen = new Set();
  const nodes = [];
  rawNodes.forEach((n) => {
    const id = typeof n === 'string' ? n : n && n.id;
    if (!id || seen.has(id)) return;
    seen.add(id);
    nodes.push({
      id,
      type: 'entity',
      data: {
        label: id,
        entityType: (typeof n === 'object' && n.type) || 'Concept',
        mentions: (typeof n === 'object' && n.mentions) || 1,
        entityKey: (typeof n === 'object' && n.key) || null,
      },
      position: { x: 0, y: 0 },
    });
  });

  // De-duplicate: the same relationship arriving twice drew two identical
  // edges and two identical labels exactly on top of each other, which read as
  // a smeared, bolder label rather than as a duplicate.
  const edgeSeen = new Set();
  const edges = [];
  rawLinks
    .filter((l) => l && seen.has(l.source) && seen.has(l.target) && l.source !== l.target)
    .forEach((l, i) => {
      const label = l.label || 'related to';
      const key = `${l.source}->${l.target}:${label}`;
      if (edgeSeen.has(key)) return;
      edgeSeen.add(key);
      edges.push({
        id: `e-${l.source}-${l.target}-${i}`,
        source: l.source,
        target: l.target,
        label,
        data: { weight: l.weight || 1 },
      });
    });

  const laid = layoutGraph(nodes, edges);

  // Stagger the labels of edges that run through the same horizontal band.
  //
  // React Flow puts an edge label at the midpoint of its path. Every edge
  // crossing from level N to level N+1 has its midpoint at nearly the same y,
  // so four sibling edges produced four labels stacked in one 30px strip -
  // exactly the "contains provision" pile-up in the reported screenshot. Each
  // edge gets a slot index here; the renderer converts it to a vertical offset,
  // so the labels sit on separate lines instead of on top of one another.
  const bandCounts = new Map();
  const positioned = edges.map((edge) => {
    const from = laid.depths?.get(edge.source) ?? 0;
    const to = laid.depths?.get(edge.target) ?? 0;
    const band = `${from}->${to}`;
    const slot = bandCounts.get(band) || 0;
    bandCounts.set(band, slot + 1);
    return { ...edge, data: { ...edge.data, labelSlot: slot, span: Math.abs(to - from) } };
  });

  // Centre each band's slots around zero so the fan is symmetric.
  const withOffsets = positioned.map((edge) => {
    const from = laid.depths?.get(edge.source) ?? 0;
    const to = laid.depths?.get(edge.target) ?? 0;
    const total = bandCounts.get(`${from}->${to}`) || 1;
    return {
      ...edge,
      data: { ...edge.data, labelOffset: edge.data.labelSlot - (total - 1) / 2 },
    };
  });

  return {
    nodes: laid.nodes,
    edges: withOffsets,
    width: laid.width,
    height: laid.height,
  };
}

// --- Document domains --------------------------------------------------------
export const DOMAIN_LIST = [
  { label: 'Agriculture & Farming', keywords: ['agri', 'farm', 'crop', 'kisan', 'irrigation', 'soil', 'fertilizer', 'harvest', 'horticulture'] },
  { label: 'Education & Learning', keywords: ['edu', 'school', 'ncert', 'university', 'college', 'student', 'curriculum', 'learning', 'scholarship', 'literacy'] },
  { label: 'Budget & Finance', keywords: ['budget', 'finance', 'tax', 'fiscal', 'revenue', 'gst', 'economy', 'fund', 'expenditure', 'allocation'] },
  { label: 'Health & Medicine', keywords: ['health', 'medical', 'hospital', 'disease', 'ayushman', 'pharma', 'medicine', 'nutrition', 'vaccination'] },
  { label: 'Legal & Justice', keywords: ['legal', 'law', 'court', 'justice', 'act', 'rights', 'constitution', 'regulation', 'penalty', 'judiciary'] },
  { label: 'Environment & Climate', keywords: ['environment', 'climate', 'pollution', 'carbon', 'forest', 'energy', 'solar', 'green', 'ecology', 'biodiversity'] },
  { label: 'Infrastructure & Transport', keywords: ['infra', 'road', 'railway', 'highway', 'bridge', 'port', 'metro', 'transport', 'construction', 'airport'] },
  { label: 'Science & Technology', keywords: ['science', 'tech', 'digital', 'innovation', 'research', 'space', 'isro', 'satellite', 'cyber'] },
  { label: 'Rural Development', keywords: ['rural', 'village', 'panchayat', 'gram', 'mgnrega', 'swachh', 'sanitation', 'self help'] },
  { label: 'Defence & Security', keywords: ['defence', 'military', 'army', 'navy', 'air force', 'security', 'border', 'strategic', 'weapon'] },
  { label: 'Social Welfare', keywords: ['welfare', 'pension', 'scheme', 'beneficiary', 'subsidy', 'ration', 'bpl', 'empowerment', 'minorities'] },
  { label: 'Housing & Urban', keywords: ['housing', 'urban', 'city', 'municipality', 'smart city', 'pmay', 'slum', 'real estate', 'property'] },
  { label: 'Women & Child', keywords: ['women', 'child', 'maternal', 'beti', 'gender', 'anganwadi', 'adolescent'] },
  { label: 'Other / General', keywords: [] },
];

export function getDocumentDomain(doc) {
  const text = `${doc.filename || ''} ${doc.summary || ''}`.toLowerCase();
  for (const domain of DOMAIN_LIST.slice(0, -1)) {
    if (domain.keywords.some((kw) => text.includes(kw))) return domain.label;
  }
  return 'Other / General';
}
