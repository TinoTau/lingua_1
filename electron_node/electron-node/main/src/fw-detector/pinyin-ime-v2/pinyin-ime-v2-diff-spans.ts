import type { PinyinImeV2Candidate, PinyinImeV2DiffSpan } from './pinyin-ime-v2-types';

export type RawDiffSpan = {
  start: number;
  end: number;
  source: string;
  target: string;
};

export type DiffReplacementResult = {
  spans: RawDiffSpan[];
  alignFailed: boolean;
};

/**
 * Character-level diff between raw ASR and IME candidate.
 * Aligns with Span Coverage audit (substitution-only spans).
 */
export function diffReplacementSpans(raw: string, candidate: string): DiffReplacementResult {
  if (raw === candidate) {
    return { spans: [], alignFailed: false };
  }
  if (!raw.length || !candidate.length) {
    return { spans: [], alignFailed: true };
  }

  const m = raw.length;
  const n = candidate.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 1; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        raw[i - 1] === candidate[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  if (dp[m][n] > Math.max(m, n) * 0.6) {
    return { spans: [], alignFailed: true };
  }

  type Op =
    | { type: 'eq'; i: number; j: number }
    | { type: 'sub'; i: number; j: number }
    | { type: 'del'; i: number }
    | { type: 'ins'; j: number };

  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && raw[i - 1] === candidate[j - 1]) {
      ops.push({ type: 'eq', i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: 'sub', i: i - 1, j: j - 1 });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'del', i: i - 1 });
      i--;
    } else {
      ops.push({ type: 'ins', j: j - 1 });
      j--;
    }
  }
  ops.reverse();

  const spans: RawDiffSpan[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.type === 'sub') {
      const start = op.i;
      let end = start + 1;
      let target = candidate[op.j];
      k++;
      while (k < ops.length && ops[k].type === 'sub') {
        const sub = ops[k] as Extract<Op, { type: 'sub' }>;
        end = sub.i + 1;
        target += candidate[sub.j];
        k++;
      }
      spans.push({ start, end, source: raw.slice(start, end), target });
    } else {
      if (op.type === 'ins' || op.type === 'del') {
        return { spans: [], alignFailed: true };
      }
      k++;
    }
  }

  return { spans, alignFailed: false };
}

export function collectDiffSpansFromCandidates(
  rawAsrText: string,
  candidates: PinyinImeV2Candidate[],
  topK: number
): { diffSpans: PinyinImeV2DiffSpan[]; alignFailedCount: number } {
  const unionTopK = candidates.slice(0, topK);
  const diffSpans: PinyinImeV2DiffSpan[] = [];
  let alignFailedCount = 0;

  for (const candidate of unionTopK) {
    const { spans, alignFailed } = diffReplacementSpans(rawAsrText, candidate.text);
    if (alignFailed) {
      alignFailedCount++;
      continue;
    }
    for (const span of spans) {
      diffSpans.push({
        rawSpan: span.source,
        start: span.start,
        end: span.end,
        candidateRank: candidate.rank,
        supportCount: 1,
      });
    }
  }

  return { diffSpans, alignFailedCount };
}
