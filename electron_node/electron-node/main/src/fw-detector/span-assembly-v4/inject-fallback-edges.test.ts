import { describe, expect, it } from '@jest/globals';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { injectFallbackEdges } from './inject-fallback-edges';

function fakeCandidate(partial: Partial<WindowCandidate> & { candidateId: string }): WindowCandidate {
  return {
    windowId: 'w:0:1',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 1,
    rawStart: 0,
    rawEnd: 1,
    windowPinyinKey: 'ce',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    replacement: '测',
    source: 'domain_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...partial,
  };
}

function fakeLexicalEdge(input: {
  edgeId: string;
  syllableStart: number;
  syllableEnd: number;
  candidates?: WindowCandidate[];
  recallEvidence?: Partial<LexicalEdge['recallEvidence']>;
}): LexicalEdge {
  return {
    edgeId: input.edgeId,
    syllableStart: input.syllableStart,
    syllableEnd: input.syllableEnd,
    edgeKind: 'lexical',
    sourceWindowId: 'src',
    candidates: input.candidates ?? [fakeCandidate({ candidateId: `${input.edgeId}:c0` })],
    recallEvidence: {
      hasExact: false,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
      ...input.recallEvidence,
    },
  };
}

describe('injectFallbackEdges', () => {
  it('no fallback when lexical graph already reaches N', () => {
    const syllableCount = 3;
    const lexicalEdges: LexicalEdge[] = [fakeLexicalEdge({ edgeId: '0:3', syllableStart: 0, syllableEnd: 3 })];
    const out = injectFallbackEdges({ syllableCount, lexicalEdges });
    expect(out.fallbackInjectionCount).toBe(0);
    expect(out.fallbackInjectionRanges).toEqual([]);
    expect(out.edges).toHaveLength(lexicalEdges.length);
    expect(out.edges.every((e) => e.edgeKind === 'lexical')).toBe(true);
  });

  it('injects fallback only at start boundary when only 1..N lexical exists', () => {
    // N=2: lexical edge only 1->2, so we need fallback 0->1.
    const syllableCount = 2;
    const lexicalEdges: LexicalEdge[] = [fakeLexicalEdge({ edgeId: '1:2', syllableStart: 1, syllableEnd: 2 })];
    const out = injectFallbackEdges({ syllableCount, lexicalEdges });
    const fallbacks = out.edges.filter((e) => e.edgeKind === 'fallback');
    expect(out.fallbackInjectionCount).toBe(1);
    expect(fallbacks.map((e) => `${e.syllableStart}:${e.syllableEnd}`)).toEqual(['0:1']);
    expect(out.fallbackInjectionRanges).toEqual([{ start: 0, end: 1 }]);
    expect(fallbacks[0]!.candidates).toHaveLength(0);
  });

  it('injects fallback only for the minimal middle gap', () => {
    // N=3: lexical edges 0->1 and 2->3, missing 1->2.
    const syllableCount = 3;
    const lexicalEdges: LexicalEdge[] = [
      fakeLexicalEdge({ edgeId: '0:1', syllableStart: 0, syllableEnd: 1 }),
      fakeLexicalEdge({ edgeId: '2:3', syllableStart: 2, syllableEnd: 3 }),
    ];
    const out = injectFallbackEdges({ syllableCount, lexicalEdges });
    const fallbacks = out.edges.filter((e) => e.edgeKind === 'fallback');
    expect(out.fallbackInjectionCount).toBe(1);
    expect(fallbacks.map((e) => `${e.syllableStart}:${e.syllableEnd}`)).toEqual(['1:2']);
    expect(out.fallbackInjectionRanges).toEqual([{ start: 1, end: 2 }]);
  });

  it('injects fallback for a consecutive 3-boundary gap', () => {
    // N=5: lexical edges only 0->1 and 4->5, so need fallback at 1,2,3.
    const syllableCount = 5;
    const lexicalEdges: LexicalEdge[] = [
      fakeLexicalEdge({ edgeId: '0:1', syllableStart: 0, syllableEnd: 1 }),
      fakeLexicalEdge({ edgeId: '4:5', syllableStart: 4, syllableEnd: 5 }),
    ];
    const out = injectFallbackEdges({ syllableCount, lexicalEdges });
    const fallbacks = out.edges.filter((e) => e.edgeKind === 'fallback');
    expect(out.fallbackInjectionCount).toBe(3);
    expect(fallbacks.map((e) => `${e.syllableStart}:${e.syllableEnd}`)).toEqual(['1:2', '2:3', '3:4']);
    expect(out.fallbackInjectionRanges).toEqual([{ start: 1, end: 4 }]);
    expect(fallbacks[0]!.candidates).toHaveLength(0);
    // All injected fallback edges share the same empty candidates array reference.
    expect(fallbacks[0]!.candidates).toBe(fallbacks[1]!.candidates);
    expect(fallbacks[1]!.candidates).toBe(fallbacks[2]!.candidates);
  });
});
