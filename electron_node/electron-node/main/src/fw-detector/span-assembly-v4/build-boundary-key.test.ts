import { describe, expect, it } from '@jest/globals';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { buildBoundaryKey, derivePathId } from './build-boundary-key';

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
  kind?: LexicalEdge['edgeKind'];
  recallEvidence?: Partial<LexicalEdge['recallEvidence']>;
  candidates?: WindowCandidate[];
}): LexicalEdge {
  return {
    edgeId: input.edgeId,
    syllableStart: input.syllableStart,
    syllableEnd: input.syllableEnd,
    edgeKind: input.kind ?? 'lexical',
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

describe('buildBoundaryKey / derivePathId', () => {
  it('builds boundaryKey from contiguous edge sequence', () => {
    const e1 = fakeLexicalEdge({ edgeId: '0:2', syllableStart: 0, syllableEnd: 2 });
    const e2 = fakeLexicalEdge({ edgeId: '2:4', syllableStart: 2, syllableEnd: 4 });
    const key = buildBoundaryKey([e1, e2]);
    expect(key).toBe('0-2|2-4');
  });

  it('pathId is deterministic and stable across runs', () => {
    const e1 = fakeLexicalEdge({ edgeId: '0:1', syllableStart: 0, syllableEnd: 1, candidates: [] });
    const e2 = fakeLexicalEdge({ edgeId: '1:3', syllableStart: 1, syllableEnd: 3, candidates: [] });
    const key = buildBoundaryKey([e1, e2]);
    const a = derivePathId(key);
    const b = derivePathId(key);
    expect(a).toBe(b);
  });

  it('different boundaryKeys produce different pathId', () => {
    const a = buildBoundaryKey([
      fakeLexicalEdge({ edgeId: '0:1', syllableStart: 0, syllableEnd: 1, candidates: [] }),
      fakeLexicalEdge({ edgeId: '1:3', syllableStart: 1, syllableEnd: 3, candidates: [] }),
    ]);
    const b = buildBoundaryKey([
      fakeLexicalEdge({ edgeId: '0:2', syllableStart: 0, syllableEnd: 2, candidates: [] }),
      fakeLexicalEdge({ edgeId: '2:3', syllableStart: 2, syllableEnd: 3, candidates: [] }),
    ]);
    expect(a).not.toBe(b);
    expect(derivePathId(a)).not.toBe(derivePathId(b));
  });

  it('candidate ordering must not affect boundaryKey', () => {
    const c1 = fakeCandidate({ candidateId: 'c1', termId: 't1', windowId: 'w:0:1' });
    const c2 = fakeCandidate({ candidateId: 'c2', termId: 't2', windowId: 'w:0:1' });
    const e = fakeLexicalEdge({
      edgeId: '0:2',
      syllableStart: 0,
      syllableEnd: 2,
      candidates: [c1, c2],
    });
    const keyA = buildBoundaryKey([e]);
    e.candidates.reverse();
    const keyB = buildBoundaryKey([e]);
    expect(keyA).toBe(keyB);
  });

  it('throws on non-contiguous edges', () => {
    const e1 = fakeLexicalEdge({ edgeId: '0:2', syllableStart: 0, syllableEnd: 2, candidates: [] });
    const e2 = fakeLexicalEdge({ edgeId: '3:4', syllableStart: 3, syllableEnd: 4, candidates: [] });
    expect(() => buildBoundaryKey([e1, e2])).toThrow(/non-contiguous|prevEnd/);
  });
});

