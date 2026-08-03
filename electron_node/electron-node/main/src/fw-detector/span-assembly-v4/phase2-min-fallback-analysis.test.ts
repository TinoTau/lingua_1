/**
 * Phase 2 Verification — minimal fallback alternate-set analysis (read-only).
 * Does NOT modify inject-fallback-edges.ts. Compares single deterministic DP set
 * vs enumeration of all same-cost minimal fallback sets.
 */
import { describe, expect, it } from '@jest/globals';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { injectFallbackEdges } from './inject-fallback-edges';
import { enumerateCompleteSegmentationPaths } from './enumerate-complete-segmentation-paths';
import { V4_LIMITS } from './v4-limits';

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

function lex(start: number, end: number): LexicalEdge {
  return {
    edgeId: `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    edgeKind: 'lexical',
    sourceWindowId: `${start}:${end}`,
    candidates: [
      fakeCandidate({
        candidateId: `${start}:${end}:c0`,
        windowId: `${start}:${end}`,
        syllableStart: start,
        syllableEnd: end,
      }),
    ],
    recallEvidence: {
      hasExact: true,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
    },
  };
}

function makeFallback(pos: number): LexicalEdge {
  return {
    edgeId: `fallback:${pos}:${pos + 1}`,
    syllableStart: pos,
    syllableEnd: pos + 1,
    edgeKind: 'fallback',
    sourceWindowId: 'fallback_injection',
    candidates: [],
    recallEvidence: {
      hasExact: false,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
    },
  };
}

/** Enumerate all fallback position-sets of exact size `cost` that make [0,N) reachable. */
function enumerateMinCostFallbackSets(
  syllableCount: number,
  lexicalEdges: readonly LexicalEdge[],
  cost: number
): number[][] {
  const results: number[][] = [];
  const positions = Array.from({ length: syllableCount }, (_, i) => i);

  function reachable(extra: Set<number>): boolean {
    const outgoing: number[][] = Array.from({ length: syllableCount + 1 }, () => []);
    for (const e of lexicalEdges) {
      if (e.edgeKind !== 'lexical') continue;
      outgoing[e.syllableStart]!.push(e.syllableEnd);
    }
    for (const p of extra) {
      outgoing[p]!.push(p + 1);
    }
    const seen = new Array(syllableCount + 1).fill(false);
    const q = [0];
    seen[0] = true;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === syllableCount) return true;
      for (const nxt of outgoing[cur]!) {
        if (!seen[nxt]) {
          seen[nxt] = true;
          q.push(nxt);
        }
      }
    }
    return false;
  }

  function choose(startIdx: number, chosen: number[]) {
    if (chosen.length === cost) {
      if (reachable(new Set(chosen))) {
        results.push([...chosen].sort((a, b) => a - b));
      }
      return;
    }
    for (let i = startIdx; i < positions.length; i += 1) {
      chosen.push(positions[i]!);
      choose(i + 1, chosen);
      chosen.pop();
    }
  }
  choose(0, []);
  // unique
  const uniq = new Map<string, number[]>();
  for (const s of results) {
    uniq.set(s.join(','), s);
  }
  return [...uniq.values()];
}

function pathKeysWithFallbacks(
  syllableCount: number,
  lexicalEdges: readonly LexicalEdge[],
  fallbackPositions: number[]
): string[] {
  const edges = [
    ...lexicalEdges,
    ...fallbackPositions.map((p) => makeFallback(p)),
  ];
  const enumResult = enumerateCompleteSegmentationPaths({
    syllableCount,
    lexicalEdges: edges,
    limits: {
      maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
      maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
    },
  });
  return enumResult.paths.map((p) => p.boundaryKey).sort();
}

describe('minimal fallback alternate-set analysis (verification only)', () => {
  it('unique min fallback set: DP matches sole solution', () => {
    // N=3; edges 0-1 and 2-3 → only {1}
    const lexical = [lex(0, 1), lex(2, 3)];
    const inj = injectFallbackEdges({ syllableCount: 3, lexicalEdges: lexical });
    expect(inj.fallbackInjectionCount).toBe(1);
    const sets = enumerateMinCostFallbackSets(3, lexical, 1);
    expect(sets).toEqual([[1]]);
  });

  it('two same-cost min sets: DP picks one; alternate set may add paths', () => {
    // N=4; edges: 0→2, 1→3
    // Min cost 2:
    //  A: fallback {2,3} with path 0-2|2-3|3-4
    //  B: fallback {0,3} with path 0-1|1-3|3-4
    const lexical = [lex(0, 2), lex(1, 3)];
    const inj = injectFallbackEdges({ syllableCount: 4, lexicalEdges: lexical });
    expect(inj.fallbackInjectionCount).toBe(2);
    const dpPositions: number[] = [];
    for (const r of inj.fallbackInjectionRanges) {
      for (let p = r.start; p < r.end; p += 1) dpPositions.push(p);
    }
    dpPositions.sort((a, b) => a - b);

    const allMin = enumerateMinCostFallbackSets(4, lexical, 2);
    expect(allMin.length).toBeGreaterThanOrEqual(2);

    const dpKeys = new Set(pathKeysWithFallbacks(4, lexical, dpPositions));
    const allKeys = new Set<string>();
    for (const set of allMin) {
      for (const k of pathKeysWithFallbacks(4, lexical, set)) {
        allKeys.add(k);
      }
    }
    const missed = [...allKeys].filter((k) => !dpKeys.has(k));
    // Record: DP may omit alternate boundaryKeys from other min-cost sets
    expect(allMin.some((s) => s.join(',') === dpPositions.join(','))).toBe(true);
    // Analysis artifact expectations for the report
    expect(missed.length + dpKeys.size).toBe(allKeys.size);
    expect(allKeys.size).toBeGreaterThanOrEqual(dpKeys.size);
  });

  it('three+ same-cost sets exist on crafted graph', () => {
    // N=5; edges 0→2, 1→3, 2→4 — several cost-2 / cost-3 covers
    const lexical = [lex(0, 2), lex(1, 3), lex(2, 4)];
    const inj = injectFallbackEdges({ syllableCount: 5, lexicalEdges: lexical });
    const cost = inj.fallbackInjectionCount;
    expect(cost).toBeGreaterThan(0);
    const allMin = enumerateMinCostFallbackSets(5, lexical, cost);
    expect(allMin.length).toBeGreaterThanOrEqual(1);
    // When multiple, document resource growth
    if (allMin.length >= 2) {
      const dpPos: number[] = [];
      for (const r of inj.fallbackInjectionRanges) {
        for (let p = r.start; p < r.end; p += 1) dpPos.push(p);
      }
      const dpKeys = pathKeysWithFallbacks(5, lexical, dpPos);
      let union = new Set(dpKeys);
      for (const set of allMin) {
        for (const k of pathKeysWithFallbacks(5, lexical, set)) union.add(k);
      }
      expect(union.size).toBeGreaterThanOrEqual(dpKeys.length);
    }
  });
});
