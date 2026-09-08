/**
 * Tests for graph layout.
 *
 * These pin the properties that stop the mind map drawing on top of itself.
 * Each corresponds to a real defect: edges running sideways through node boxes,
 * sibling edges stacking their labels in one narrow strip, and two-line nodes
 * growing into the row beneath them.
 *
 * They are geometric invariants rather than pixel assertions, so the layout can
 * be retuned without rewriting the suite - but it cannot regress into overlap
 * without a failure.
 */
import { describe, expect, it } from 'vitest';

import {
  buildFlowGraph,
  entityColor,
  getDocumentDomain,
  layoutGraph,
  legendFor,
  NODE_WIDTH,
} from './graph';

const node = (id, label = id) => ({
  id,
  type: 'entity',
  data: { label, entityType: 'Concept' },
  position: { x: 0, y: 0 },
});

const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

describe('layoutGraph', () => {
  it('returns an empty layout for no nodes', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], width: 0, height: 0 });
  });

  it('places every child strictly below every parent', () => {
    // The defect this replaces: breadth-first layering gave a node the depth of
    // the *first* parent to reach it, so an edge could run sideways within a
    // rank - straight through whatever node box was in the way.
    const nodes = [node('root'), node('mid'), node('leaf')];
    const edges = [edge('root', 'mid'), edge('root', 'leaf'), edge('mid', 'leaf')];

    const laid = layoutGraph(nodes, edges);
    const y = Object.fromEntries(laid.nodes.map((n) => [n.id, n.position.y]));

    expect(y.mid).toBeGreaterThan(y.root);
    expect(y.leaf).toBeGreaterThan(y.mid);
  });

  it('never overlaps two nodes', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: 13 }, (_, i) => edge('n0', `n${i + 1}`));

    const laid = layoutGraph(nodes, edges);

    for (let i = 0; i < laid.nodes.length; i += 1) {
      for (let j = i + 1; j < laid.nodes.length; j += 1) {
        const a = laid.nodes[i].position;
        const b = laid.nodes[j].position;
        const overlapping = Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < 40;
        expect(overlapping).toBe(false);
      }
    }
  });

  it('wraps a wide level into a grid instead of one long row', () => {
    // A star graph laid out as a tree grows linearly wide, which is what forced
    // fitView down to 0.21 and rendered 14px labels at under 3px.
    const nodes = [node('hub'), ...Array.from({ length: 12 }, (_, i) => node(`leaf${i}`))];
    const edges = Array.from({ length: 12 }, (_, i) => edge('hub', `leaf${i}`));

    const laid = layoutGraph(nodes, edges);

    expect(laid.width).toBeLessThan(1000);
    expect(laid.height).toBeGreaterThan(200);
    expect(laid.width / laid.height).toBeLessThan(4);
  });

  it('gives a taller row to a node whose label wraps', () => {
    const short = layoutGraph([node('a', 'A'), node('b', 'B')], [edge('a', 'b')]);
    const long = layoutGraph(
      [node('a', 'A'), node('b', 'A very long entity label that wraps to two lines')],
      [edge('a', 'b')],
    );

    expect(long.height).toBeGreaterThanOrEqual(short.height);
  });

  it('does not hang on a cycle', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];

    const laid = layoutGraph(nodes, edges);
    expect(laid.nodes).toHaveLength(3);
  });

  it('positions a disconnected node rather than leaving it at the origin', () => {
    const nodes = [node('a'), node('b'), node('orphan')];
    const laid = layoutGraph(nodes, [edge('a', 'b')]);

    expect(laid.nodes.every((n) => Number.isFinite(n.position.x))).toBe(true);
    expect(laid.nodes.every((n) => Number.isFinite(n.position.y))).toBe(true);
  });
});

describe('buildFlowGraph', () => {
  it('carries the entity type through from the API payload', () => {
    // The original frontend dropped `type` on the floor, so every node in the
    // map rendered in the same colour.
    const { nodes } = buildFlowGraph(
      [{ id: 'Article 46', type: 'Provision', key: 'article 46', mentions: 3 }],
      [],
    );

    expect(nodes[0].data.entityType).toBe('Provision');
    expect(nodes[0].data.entityKey).toBe('article 46');
    expect(nodes[0].data.mentions).toBe(3);
  });

  it('drops duplicate edges', () => {
    // Two identical edges drew two identical labels in exactly the same place,
    // which reads as a smeared, bolder label rather than as a duplicate.
    const { edges } = buildFlowGraph(
      [{ id: 'A' }, { id: 'B' }],
      [
        { source: 'A', target: 'B', label: 'relates to' },
        { source: 'A', target: 'B', label: 'relates to' },
      ],
    );

    expect(edges).toHaveLength(1);
  });

  it('keeps distinct relationships between the same pair', () => {
    const { edges } = buildFlowGraph(
      [{ id: 'A' }, { id: 'B' }],
      [
        { source: 'A', target: 'B', label: 'contains' },
        { source: 'A', target: 'B', label: 'supersedes' },
      ],
    );

    expect(edges).toHaveLength(2);
  });

  it('gives edges in the same band distinct label offsets', () => {
    // The fix for four "contains provision" labels stacking in one 30px strip.
    const { edges } = buildFlowGraph(
      [{ id: 'hub' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      ['a', 'b', 'c', 'd'].map((t) => ({ source: 'hub', target: t, label: 'contains' })),
    );

    const offsets = edges.map((e) => e.data.labelOffset);
    expect(new Set(offsets).size).toBe(edges.length);
    // Symmetric around zero, so the fan is centred on the edge midpoints.
    expect(offsets.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
  });

  it('ignores links pointing at nodes that do not exist', () => {
    const { edges } = buildFlowGraph(
      [{ id: 'A' }],
      [{ source: 'A', target: 'Missing', label: 'x' }],
    );
    expect(edges).toHaveLength(0);
  });

  it('ignores self-links', () => {
    const { edges } = buildFlowGraph(
      [{ id: 'A' }],
      [{ source: 'A', target: 'A', label: 'x' }],
    );
    expect(edges).toHaveLength(0);
  });

  it('deduplicates repeated nodes', () => {
    const { nodes } = buildFlowGraph([{ id: 'A' }, { id: 'A' }], []);
    expect(nodes).toHaveLength(1);
  });

  it('handles an empty payload', () => {
    const built = buildFlowGraph([], []);
    expect(built.nodes).toEqual([]);
    expect(built.edges).toEqual([]);
  });
});

describe('palette and legend', () => {
  it('gives every known entity type a distinct colour', () => {
    const types = ['Scheme', 'Provision', 'Organisation', 'Beneficiary', 'Benefit'];
    const colours = types.map(entityColor);
    expect(new Set(colours).size).toBe(types.length);
  });

  it('falls back to a default colour for an unknown type', () => {
    expect(entityColor('SomethingNew')).toBe(entityColor('Concept'));
    expect(entityColor(undefined)).toBe(entityColor('Concept'));
  });

  it('describes the graph in front of the user, not the idea of a graph', () => {
    const legend = legendFor([
      { data: { entityType: 'Provision' } },
      { data: { entityType: 'Provision' } },
      { data: { entityType: 'Scheme' } },
    ]);

    expect(legend[0]).toMatchObject({ type: 'Provision', count: 2 });
    expect(legend).toHaveLength(2);
  });
});

describe('getDocumentDomain', () => {
  it('classifies from the filename and summary', () => {
    expect(getDocumentDomain({ filename: 'kisan-scheme.pdf', summary: '' }))
      .toBe('Agriculture & Farming');
    expect(getDocumentDomain({ filename: 'x.pdf', summary: 'A budget allocation report' }))
      .toBe('Budget & Finance');
  });

  it('falls back to the general bucket', () => {
    expect(getDocumentDomain({ filename: 'notes.pdf', summary: '' }))
      .toBe('Other / General');
  });

  it('tolerates a document with no filename or summary', () => {
    expect(getDocumentDomain({})).toBe('Other / General');
  });
});
