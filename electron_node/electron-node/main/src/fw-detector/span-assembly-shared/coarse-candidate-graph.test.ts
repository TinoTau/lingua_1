import { describe, expect, it } from '@jest/globals';
import { mergeOverlappingEdges } from './coarse-candidate-graph';
import type { GraphEdge } from './types';

function edge(overrides: Partial<GraphEdge>): GraphEdge {
  return {
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    replacement: '蓝莓马芬',
    source: 'domain_term',
    score: 0.8,
    ngramKey: 'a|b',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...overrides,
  };
}

describe('coarse-candidate-graph merge', () => {
  it('Case 4: does not merge same replacement across different coarseSpanId', () => {
    const a = edge({
      coarseSpanId: 's6',
      syllableStart: 0,
      syllableEnd: 2,
      hitKind: 'parent_span_candidate',
    });
    const b = edge({
      coarseSpanId: 's7',
      syllableStart: 1,
      syllableEnd: 3,
      hitKind: 'parent_span_candidate',
    });
    const { edges, mergeCount } = mergeOverlappingEdges([a, b]);
    expect(mergeCount).toBe(0);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.coarseSpanId).sort()).toEqual(['s6', 's7']);
  });

  it('preserves coarseSpanId when merging same coarseSpanId edges', () => {
    const a = edge({
      coarseSpanId: 's7',
      syllableStart: 0,
      syllableEnd: 2,
      ngramKey: 'a|b',
    });
    const b = edge({
      coarseSpanId: 's7',
      syllableStart: 2,
      syllableEnd: 4,
      ngramKey: 'c|d',
    });
    const { edges, mergeCount } = mergeOverlappingEdges([a, b]);
    expect(mergeCount).toBe(1);
    expect(edges[0].coarseSpanId).toBe('s7');
    expect(edges[0].syllableEnd).toBe(4);
  });
});
