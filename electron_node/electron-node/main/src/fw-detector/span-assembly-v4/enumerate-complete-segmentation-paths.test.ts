import { describe, expect, it } from '@jest/globals';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { enumerateCompleteSegmentationPaths } from './enumerate-complete-segmentation-paths';
import { derivePathId } from './build-boundary-key';

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

function edge(input: {
  start: number;
  end: number;
  kind?: LexicalEdge['edgeKind'];
  evidence?: Partial<LexicalEdge['recallEvidence']>;
  candidates?: WindowCandidate[];
}): LexicalEdge {
  const edgeId = `${input.start}:${input.end}`;
  return {
    edgeId: input.kind === 'fallback' ? `fallback:${edgeId}` : edgeId,
    syllableStart: input.start,
    syllableEnd: input.end,
    edgeKind: input.kind ?? 'lexical',
    sourceWindowId: input.kind === 'fallback' ? 'fallback_injection' : 'src',
    candidates: input.candidates ?? [
      fakeCandidate({
        candidateId: `${edgeId}:c0`,
        syllableStart: input.start,
        syllableEnd: input.end,
        windowId: edgeId,
      }),
    ],
    recallEvidence: {
      hasExact: false,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
      ...input.evidence,
    },
  };
}

describe('enumerateCompleteSegmentationPaths', () => {
  it('enumerates a unique complete path', () => {
    const edges = [edge({ start: 0, end: 2 }), edge({ start: 2, end: 4 })];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 4,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.completePathCountBeforePrune).toBe(1);
    expect(out.retainedCompletePathCount).toBe(1);
    expect(out.paths[0]!.boundaryKey).toBe('0-2|2-4');
    expect(out.paths[0]!.pathId).toBe(derivePathId('0-2|2-4'));
  });

  it('keeps multiple legal boundaryKeys without expanding by candidates', () => {
    const shared = [
      fakeCandidate({ candidateId: 'a', termId: 't1', windowId: '0:2' }),
      fakeCandidate({ candidateId: 'b', termId: 't2', windowId: '0:2' }),
    ];
    const edges = [
      edge({ start: 0, end: 2, candidates: shared, evidence: { hasExact: true } }),
      edge({ start: 0, end: 1, evidence: { hasExact: true } }),
      edge({ start: 1, end: 2, evidence: { hasExact: true } }),
    ];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 2,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.paths.map((p) => p.boundaryKey).sort()).toEqual(['0-1|1-2', '0-2']);
    expect(out.paths).toHaveLength(2);
  });

  it('is order-independent for shuffled edge inputs', () => {
    const edges = [
      edge({ start: 0, end: 2, evidence: { hasExact: true } }),
      edge({ start: 2, end: 3 }),
      edge({ start: 0, end: 1 }),
      edge({ start: 1, end: 3, evidence: { hasExact: true } }),
    ];
    const shuffled = [...edges].reverse();
    const a = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    const b = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: shuffled,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(a.paths.map((p) => p.boundaryKey)).toEqual(b.paths.map((p) => p.boundaryKey));
    expect(a.paths.map((p) => p.pathId)).toEqual(b.paths.map((p) => p.pathId));
  });

  it('throws on duplicate edge boundaries', () => {
    expect(() =>
      enumerateCompleteSegmentationPaths({
        syllableCount: 2,
        lexicalEdges: [edge({ start: 0, end: 2 }), edge({ start: 0, end: 2 })],
        limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
      })
    ).toThrow(/duplicate edge boundary/);
  });

  it('throws on illegal edge length >5', () => {
    expect(() =>
      enumerateCompleteSegmentationPaths({
        syllableCount: 6,
        lexicalEdges: [edge({ start: 0, end: 6 })],
        limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
      })
    ).toThrow(/illegal edge length/);
  });

  it('retains all legal paths when under complete-path cap', () => {
    const edges = [
      edge({ start: 0, end: 1 }),
      edge({ start: 1, end: 2 }),
      edge({ start: 0, end: 2 }),
    ];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 2,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.completePathCountBeforePrune).toBe(2);
    expect(out.retainedCompletePathCount).toBe(2);
    expect(out.prunedPaths).toHaveLength(0);
  });

  it('applies complete-path cap with structural best-first retention', () => {
    // Three complete paths on N=3; keep only 1. Prefer exact over fuzzy/plain.
    const e = [
      edge({ start: 0, end: 3, evidence: { hasExact: true } }), // A: 0-3 exact
      edge({ start: 0, end: 1, evidence: { hasFuzzy: true } }),
      edge({ start: 1, end: 3, evidence: { hasFuzzy: true } }), // B: fuzzy
      edge({ start: 0, end: 2 }),
      edge({ start: 2, end: 3 }), // C: plain
    ];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: e,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 1 },
    });
    expect(out.completePathCountBeforePrune).toBe(3);
    expect(out.retainedCompletePathCount).toBe(1);
    expect(out.paths[0]!.boundaryKey).toBe('0-3');
    expect(out.prunedPaths).toHaveLength(2);
    expect(out.capEvents.some((c) => c.pruneStage === 'complete_path_cap')).toBe(true);
  });

  it('applies per-position cap on active partial paths ending at same position', () => {
    const dense: LexicalEdge[] = [
      edge({ start: 0, end: 1, evidence: { hasExact: true } }),
      edge({ start: 0, end: 2, evidence: { hasFuzzy: true } }),
      edge({ start: 1, end: 2 }),
      edge({ start: 1, end: 3 }),
      edge({ start: 2, end: 3 }),
      edge({ start: 0, end: 3 }),
    ];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: dense,
      limits: { maxActivePathsPerPosition: 1, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.capEvents.some((c) => c.pruneStage === 'per_position_cap')).toBe(true);
    expect(out.retainedCompletePathCount).toBeGreaterThanOrEqual(1);
    expect(out.paths.every((p) => p.boundaryKey.length > 0)).toBe(true);
    const again = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: [...dense].reverse(),
      limits: { maxActivePathsPerPosition: 1, maxCompleteSegmentationPaths: 8 },
    });
    expect(again.paths.map((p) => p.boundaryKey)).toEqual(out.paths.map((p) => p.boundaryKey));
  });

  it('returns empty paths when no complete coverage exists', () => {
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: [edge({ start: 0, end: 1 })],
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.completePathCountBeforePrune).toBe(0);
    expect(out.retainedCompletePathCount).toBe(0);
    expect(out.paths).toHaveLength(0);
  });
});
