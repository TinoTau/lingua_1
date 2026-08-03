import type { WindowCandidate } from './v4-types';
import type { LexicalEdge } from './build-lexical-edges';

export interface FallbackInjectionRange {
  start: number;
  end: number; // boundary end (lastFallbackPos + 1)
}

export interface InjectFallbackEdgesResult {
  edges: readonly LexicalEdge[];
  fallbackInjectionCount: number; // number of injected fallback edges (= fallbackPositions length)
  fallbackInjectionRanges: readonly FallbackInjectionRange[];
}

function canReachEndWithLexicalEdges(input: {
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
}): boolean {
  const { syllableCount, lexicalEdges } = input;
  const outgoing: LexicalEdge[][] = Array.from({ length: syllableCount + 1 }, () => []);

  for (const e of lexicalEdges) {
    if (e.edgeKind !== 'lexical') continue;
    outgoing[e.syllableStart]!.push(e);
  }

  const seen = new Array<boolean>(syllableCount + 1).fill(false);
  const q: number[] = [];
  seen[0] = true;
  q.push(0);

  while (q.length) {
    const pos = q.shift()!;
    if (pos === syllableCount) return true;
    for (const e of outgoing[pos]!) {
      if (!seen[e.syllableEnd]) {
        seen[e.syllableEnd] = true;
        q.push(e.syllableEnd);
      }
    }
  }
  return seen[syllableCount] === true;
}

function relaxParentTieBreak(params: {
  current: { prev: number; used: 'lexical' | 'fallback'; edgeId?: string } | undefined;
  candidate: { prev: number; used: 'lexical' | 'fallback'; edgeId?: string };
}): boolean {
  const { current, candidate } = params;
  if (!current) return true;

  const rank = (u: 'lexical' | 'fallback') => (u === 'lexical' ? 0 : 1);
  const currRank = rank(current.used);
  const candRank = rank(candidate.used);
  if (currRank !== candRank) {
    return candRank < currRank;
  }

  if (candidate.prev !== current.prev) {
    return candidate.prev < current.prev;
  }

  const currId = current.edgeId ?? '';
  const candId = candidate.edgeId ?? '';
  return candId.localeCompare(currId) < 0;
}

export function injectFallbackEdges(input: {
  syllableCount: number;
  lexicalEdges: readonly LexicalEdge[];
}): InjectFallbackEdgesResult {
  const { syllableCount, lexicalEdges } = input;
  if (syllableCount <= 0) {
    throw new Error('[injectFallbackEdges] syllableCount must be > 0');
  }

  const hasLexicalCompletePath = canReachEndWithLexicalEdges({ syllableCount, lexicalEdges });
  if (hasLexicalCompletePath) {
    return {
      edges: lexicalEdges,
      fallbackInjectionCount: 0,
      fallbackInjectionRanges: [],
    };
  }

  const existingBoundary = new Set<string>();
  for (const e of lexicalEdges) {
    existingBoundary.add(`${e.syllableStart}:${e.syllableEnd}`);
  }

  // Build outgoing lexical edge lists with deterministic order.
  const outgoingLex: LexicalEdge[][] = Array.from({ length: syllableCount + 1 }, () => []);
  for (const e of lexicalEdges) {
    if (e.edgeKind !== 'lexical') continue;
    outgoingLex[e.syllableStart]!.push(e);
  }
  for (let i = 0; i < syllableCount; i += 1) {
    outgoingLex[i]!.sort((a, b) => {
      if (a.syllableEnd !== b.syllableEnd) return a.syllableEnd - b.syllableEnd;
      return a.edgeId.localeCompare(b.edgeId);
    });
  }

  // 0-1 DP on an implicit DAG:
  // - lexical edge cost = 0
  // - fallback edge i->i+1 cost = 1 (injecting that fallback boundary)
  const INF = Number.POSITIVE_INFINITY;
  const dist = new Array<number>(syllableCount + 1).fill(INF);
  type ParentInfo = { prev: number; used: 'lexical' | 'fallback'; edgeId?: string };
  const parent: Array<ParentInfo | undefined> = new Array(syllableCount + 1);

  dist[0] = 0;

  for (let i = 0; i < syllableCount; i += 1) {
    if (!Number.isFinite(dist[i])) continue;

    // lexical transitions cost 0
    for (const e of outgoingLex[i]!) {
      const j = e.syllableEnd;
      const cand = dist[i]!;
      if (cand < dist[j]!) {
        dist[j] = cand;
        parent[j] = { prev: i, used: 'lexical', edgeId: e.edgeId };
      } else if (cand === dist[j]!) {
        const curr = parent[j];
        const candidate = { prev: i, used: 'lexical' as const, edgeId: e.edgeId };
        if (relaxParentTieBreak({ current: curr, candidate })) {
          parent[j] = candidate;
        }
      }
    }

    // fallback transition i->i+1 cost 1
    const j = i + 1;
    const cand = dist[i]! + 1;
    if (cand < dist[j]!) {
      dist[j] = cand;
      parent[j] = { prev: i, used: 'fallback' };
    } else if (cand === dist[j]!) {
      const curr = parent[j];
      const candidate = { prev: i, used: 'fallback' as const };
      if (relaxParentTieBreak({ current: curr, candidate })) {
        parent[j] = candidate;
      }
    }
  }

  if (!Number.isFinite(dist[syllableCount]!) || dist[syllableCount] === INF) {
    throw new Error('[injectFallbackEdges] unreachable even with fallback edges — invariant broken');
  }

  // Reconstruct one minimal-fallback path and collect injected fallback positions.
  const fallbackPositions: number[] = [];
  let cur = syllableCount;
  while (cur > 0) {
    const p = parent[cur];
    if (!p) {
      throw new Error(`[injectFallbackEdges] missing parent for position=${cur}`);
    }
    if (p.used === 'fallback') {
      fallbackPositions.push(p.prev);
    }
    cur = p.prev;
  }
  fallbackPositions.reverse();

  // Build fallback edges (length=1) for each fallback boundary position.
  // Shared empty candidates array to preserve reference sharing contracts.
  const FALLBACK_EMPTY_CANDIDATES: WindowCandidate[] = [];
  const EMPTY_EVIDENCE = {
    hasExact: false,
    hasToneExact: false,
    hasToneRelaxed: false,
    hasFuzzy: false,
  };

  const fallbackEdges: LexicalEdge[] = [];
  for (const pos of fallbackPositions) {
    const end = pos + 1;
    const key = `${pos}:${end}`;
    if (existingBoundary.has(key)) {
      // This should not happen if lexical graph is genuinely unreachable.
      throw new Error(`[injectFallbackEdges] fallback boundary already exists as lexical edge ${key}`);
    }

    fallbackEdges.push({
      edgeId: `fallback:${pos}:${end}`,
      syllableStart: pos,
      syllableEnd: end,
      edgeKind: 'fallback',
      sourceWindowId: 'fallback_injection',
      candidates: FALLBACK_EMPTY_CANDIDATES,
      recallEvidence: EMPTY_EVIDENCE,
    });
  }

  // Injection ranges are maximal consecutive fallback positions.
  const sorted = [...fallbackPositions].sort((a, b) => a - b);
  const ranges: FallbackInjectionRange[] = [];
  if (sorted.length) {
    let s = sorted[0]!;
    let prev = sorted[0]!;
    for (let i = 1; i < sorted.length; i += 1) {
      const x = sorted[i]!;
      if (x === prev + 1) {
        prev = x;
        continue;
      }
      ranges.push({ start: s, end: prev + 1 });
      s = x;
      prev = x;
    }
    ranges.push({ start: s, end: prev + 1 });
  }

  return {
    edges: [...lexicalEdges, ...fallbackEdges],
    fallbackInjectionCount: fallbackEdges.length,
    fallbackInjectionRanges: ranges,
  };
}

