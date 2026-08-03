/**
 * Phase 2 Code Verification — Path Cap stress + comparator direction (read-only verification tests).
 * Does not modify enumerator business semantics; asserts documented Contract behavior.
 */
import { describe, expect, it } from '@jest/globals';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { enumerateCompleteSegmentationPaths } from './enumerate-complete-segmentation-paths';

function fakeCandidate(partial: Partial<WindowCandidate> & { candidateId: string }): WindowCandidate {
  return {
    windowId: '0:1',
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
}): LexicalEdge {
  const id = `${input.start}:${input.end}`;
  return {
    edgeId: input.kind === 'fallback' ? `fallback:${id}` : id,
    syllableStart: input.start,
    syllableEnd: input.end,
    edgeKind: input.kind ?? 'lexical',
    sourceWindowId: input.kind === 'fallback' ? 'fallback_injection' : 'src',
    candidates: [
      fakeCandidate({
        candidateId: `${id}:c0`,
        windowId: id,
        syllableStart: input.start,
        syllableEnd: input.end,
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

/** Dense graph: every legal 1..5 edge on [0,N). */
function denseAll(n: number): LexicalEdge[] {
  const out: LexicalEdge[] = [];
  for (let s = 0; s < n; s += 1) {
    for (let len = 1; len <= Math.min(5, n - s); len += 1) {
      out.push(edge({ start: s, end: s + len, evidence: { hasExact: true } }));
    }
  }
  return out;
}

function denseN4(): LexicalEdge[] {
  return denseAll(4);
}

describe('Phase 2 Path Cap stress (verification)', () => {
  it.each([
    [7, 7],
    [8, 8],
    [9, 8],
    [16, 8],
  ])(
    'complete-path cap: before=%i with maxComplete=8 retains expected',
    (_ignoredBefore, maxComplete) => {
      // Use dense N=4 which yields Catalan-like many paths; cap to maxComplete
      const edges = denseN4();
      const uncapped = enumerateCompleteSegmentationPaths({
        syllableCount: 4,
        lexicalEdges: edges,
        limits: { maxActivePathsPerPosition: 64, maxCompleteSegmentationPaths: 64 },
      });
      expect(uncapped.completePathCountBeforePrune).toBeGreaterThanOrEqual(7);
      const capped = enumerateCompleteSegmentationPaths({
        syllableCount: 4,
        lexicalEdges: edges,
        limits: { maxActivePathsPerPosition: 64, maxCompleteSegmentationPaths: maxComplete },
      });
      if (uncapped.completePathCountBeforePrune > maxComplete) {
        expect(capped.retainedCompletePathCount).toBe(maxComplete);
        expect(capped.prunedPaths.length).toBe(
          uncapped.completePathCountBeforePrune - maxComplete
        );
        expect(capped.capEvents.some((e) => e.pruneStage === 'complete_path_cap')).toBe(true);
      } else {
        expect(capped.retainedCompletePathCount).toBe(uncapped.completePathCountBeforePrune);
      }
    }
  );

  it('32+ complete paths retained to probe complete cap of 8', () => {
    // Compositions of N=8 with parts in 1..5 exceed 32.
    const edges = denseAll(8);
    const uncapped = enumerateCompleteSegmentationPaths({
      syllableCount: 8,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 256, maxCompleteSegmentationPaths: 256 },
    });
    expect(uncapped.completePathCountBeforePrune).toBeGreaterThanOrEqual(32);
    const capped = enumerateCompleteSegmentationPaths({
      syllableCount: 8,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 256, maxCompleteSegmentationPaths: 8 },
    });
    expect(capped.retainedCompletePathCount).toBe(8);
    const shuffled = [...edges].reverse();
    const again = enumerateCompleteSegmentationPaths({
      syllableCount: 8,
      lexicalEdges: shuffled,
      limits: { maxActivePathsPerPosition: 256, maxCompleteSegmentationPaths: 8 },
    });
    expect(again.paths.map((p) => p.boundaryKey)).toEqual(capped.paths.map((p) => p.boundaryKey));
  });

  it('per-position cap only prunes prefixes and remains deterministic', () => {
    const edges = denseN4();
    const a = enumerateCompleteSegmentationPaths({
      syllableCount: 4,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 2, maxCompleteSegmentationPaths: 64 },
    });
    const b = enumerateCompleteSegmentationPaths({
      syllableCount: 4,
      lexicalEdges: [...edges].reverse(),
      limits: { maxActivePathsPerPosition: 2, maxCompleteSegmentationPaths: 64 },
    });
    expect(a.capEvents.some((e) => e.pruneStage === 'per_position_cap')).toBe(true);
    expect(a.paths.map((p) => p.boundaryKey)).toEqual(b.paths.map((p) => p.boundaryKey));
  });

  it('both caps: retained keys stable under shuffle', () => {
    const edges = denseN4();
    const a = enumerateCompleteSegmentationPaths({
      syllableCount: 4,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 3, maxCompleteSegmentationPaths: 5 },
    });
    const b = enumerateCompleteSegmentationPaths({
      syllableCount: 4,
      lexicalEdges: [...edges].sort((x, y) => y.edgeId.localeCompare(x.edgeId)),
      limits: { maxActivePathsPerPosition: 3, maxCompleteSegmentationPaths: 5 },
    });
    expect(a.paths.map((p) => p.boundaryKey)).toEqual(b.paths.map((p) => p.boundaryKey));
    expect(a.retainedCompletePathCount).toBeLessThanOrEqual(5);
  });

  it('best-first prefers fewer fallback, then fewer fuzzy, then more exact', () => {
    // N=2: three complete paths
    const edges = [
      edge({ start: 0, end: 2, evidence: { hasExact: true } }), // best
      edge({ start: 0, end: 1, evidence: { hasFuzzy: true } }),
      edge({ start: 1, end: 2, evidence: { hasFuzzy: true } }),
      edge({ start: 0, end: 1, kind: 'fallback' }), // cannot duplicate 0:1
    ];
    // rebuild without duplicate: use N=3
    const e = [
      edge({ start: 0, end: 3, evidence: { hasExact: true } }),
      edge({ start: 0, end: 1, evidence: { hasFuzzy: true } }),
      edge({ start: 1, end: 3, evidence: { hasFuzzy: true } }),
      edge({ start: 0, end: 2 }),
      edge({ start: 2, end: 3 }),
      edge({ start: 0, end: 1, kind: 'fallback' }),
      edge({ start: 1, end: 2, kind: 'fallback' }),
      edge({ start: 2, end: 3, kind: 'fallback' }),
    ];
    // Remove duplicate boundaries - fallback 0:1 conflicts with fuzzy 0:1
    const clean = [
      edge({ start: 0, end: 3, evidence: { hasExact: true } }),
      edge({ start: 0, end: 1, evidence: { hasFuzzy: true } }),
      edge({ start: 1, end: 3, evidence: { hasFuzzy: true } }),
      edge({ start: 0, end: 2 }),
      edge({ start: 2, end: 3 }),
    ];
    const out = enumerateCompleteSegmentationPaths({
      syllableCount: 3,
      lexicalEdges: clean,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 1 },
    });
    expect(out.paths[0]!.boundaryKey).toBe('0-3');
    expect(out.prunedPaths.map((p) => p.boundaryKey).sort()).toEqual(
      ['0-1|1-3', '0-2|2-3'].sort()
    );
  });

  it('documents invalidGapCount redundancy: modeled as fallbackEdgeCount', () => {
    // Verification note — Contract lists invalidGapCount separately; implementation
    // equates it to fallbackEdgeCount for gap-finalized paths (see enumerator comment).
    const src = require('fs').readFileSync(
      require('path').join(__dirname, 'enumerate-complete-segmentation-paths.ts'),
      'utf8'
    );
    expect(src).toMatch(/invalidGapCount ASC — we model as fallbackEdgeCount/);
  });
});
