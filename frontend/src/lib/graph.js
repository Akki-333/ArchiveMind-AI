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

const COLUMN_GAP = 30;
const ROW_GAP = 24;
const LEVEL_GAP = 88;
const MAX_PER_ROW = 4;

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
 * Layered layout with row wrapping.
 *
 * Returns nodes with `position` set plus the overall bounds, so the caller can
 * decide whether the graph fits without shrinking the text.
 */
export function layoutGraph(nodes, edges) {
  if (!nodes.length) return { nodes: [], width: 0, height: 0 };

  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map();
  const inDegree = new Map();
  nodes.forEach((n) => {
    children.set(n.id, []);
    inDegree.set(n.id, 0);
  });
  edges.forEach((e) => {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) return;
    children.get(e.source).push(e.target);
    inDegree.set(e.target, inDegree.get(e.target) + 1);
  });

  // Roots are nodes nothing points at. A fully cyclic graph has none, so fall
  // back to the most connected node rather than returning an empty layout.
  let roots = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  if (!roots.length) {
    const busiest = [...nodes].sort(
      (a, b) => (children.get(b.id)?.length || 0) - (children.get(a.id)?.length || 0),
    )[0];
    roots = [busiest.id];
  }

  // Breadth-first depth assignment.
  const depth = new Map();
  const queue = [];
  roots.forEach((id) => {
    depth.set(id, 0);
    queue.push(id);
  });
  while (queue.length) {
    const id = queue.shift();
    const d = depth.get(id);
    for (const child of children.get(id) || []) {
      if (!depth.has(child)) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }
  // Anything unreachable sits on its own final level rather than at the origin.
  const maxDepth = depth.size ? Math.max(...depth.values()) : 0;
  nodes.forEach((n) => {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
  });

  // Group by level, keeping siblings adjacent so edges stay short.
  const levels = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.id);
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d).push(n.id);
  });

  const orderedDepths = [...levels.keys()].sort((a, b) => a - b);

  // First pass: how wide does the widest level get?
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

  // Second pass: place, centring every row inside the widest level.
  const positions = new Map();
  let y = 0;
  plan.forEach(({ rows }, levelIndex) => {
    rows.forEach((row) => {
      const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
      const startX = (widest - rowWidth) / 2;
      row.forEach((id, columnIndex) => {
        positions.set(id, {
          x: startX + columnIndex * (NODE_WIDTH + COLUMN_GAP),
          y,
        });
      });
      y += NODE_HEIGHT + ROW_GAP;
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

  const edges = rawLinks
    .filter((l) => l && seen.has(l.source) && seen.has(l.target))
    .map((l, i) => ({
      id: `e-${l.source}-${l.target}-${i}`,
      source: l.source,
      target: l.target,
      label: l.label || 'related to',
      data: { weight: l.weight || 1 },
    }));

  const laid = layoutGraph(nodes, edges);
  return { nodes: laid.nodes, edges, width: laid.width, height: laid.height };
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
