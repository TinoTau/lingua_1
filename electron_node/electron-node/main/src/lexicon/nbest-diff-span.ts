/**
 * Recover V5 Phase B — n-best vs top1 (segment) character diff spans.
 */

import type { ASRHypothesis } from '../asr/types';

export type DiffType = 'substitution' | 'insertion' | 'deletion' | 'mixed';

export type NbestDiffSpan = {
  hypothesisRank: number;
  diffSpanId: string;
  top1Start: number;
  top1End: number;
  top1Text: string;
  altText: string;
  diffType: DiffType;
};

function hashShort(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function buildDiffSpanId(
  span: Pick<NbestDiffSpan, 'hypothesisRank' | 'top1Start' | 'top1End' | 'top1Text' | 'altText'>
): string {
  return `d${span.hypothesisRank}-${span.top1Start}-${span.top1End}-${hashShort(span.top1Text)}-${hashShort(span.altText)}`;
}

type EditOp = {
  type: 'equal' | 'replace' | 'delete' | 'insert';
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
};

function buildEditScript(a: string, b: string): EditOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const reversed: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      reversed.push({
        type: 'equal',
        aStart: i - 1,
        aEnd: i,
        bStart: j - 1,
        bEnd: j,
      });
      i -= 1;
      j -= 1;
      continue;
    }
    if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: 'insert', aStart: i, aEnd: i, bStart: j - 1, bEnd: j });
      j -= 1;
      continue;
    }
    if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      reversed.push({ type: 'delete', aStart: i - 1, aEnd: i, bStart: j, bEnd: j });
      i -= 1;
      continue;
    }
    reversed.push({ type: 'replace', aStart: i - 1, aEnd: i, bStart: j - 1, bEnd: j });
    i -= 1;
    j -= 1;
  }
  return reversed.reverse();
}

function classifyDiffType(op: EditOp): DiffType {
  const aLen = op.aEnd - op.aStart;
  const bLen = op.bEnd - op.bStart;
  if (op.type === 'insert') {
    return 'insertion';
  }
  if (op.type === 'delete') {
    return 'deletion';
  }
  if (op.type === 'replace') {
    if (aLen > 0 && bLen > 0 && aLen !== bLen) {
      return 'mixed';
    }
    return 'substitution';
  }
  return 'mixed';
}

function editOpsToSpans(a: string, b: string, ops: EditOp[]): Array<{
  start: number;
  end: number;
  altText: string;
  type: DiffType;
}> {
  const spans: Array<{ start: number; end: number; altText: string; type: DiffType }> = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      continue;
    }
    const altText = b.slice(op.bStart, op.bEnd);
    const type = classifyDiffType(op);
    spans.push({
      start: op.aStart,
      end: op.aEnd,
      altText,
      type,
    });
  }
  if (spans.length === 0 && a !== b) {
    spans.push({ start: 0, end: a.length, altText: b, type: 'mixed' });
  }
  return spans;
}

/**
 * Diff in segment (top1) coordinates; supports unequal-length hypotheses.
 */
export function charDiffSpansInTop1(top1: string, alt: string): Array<{
  start: number;
  end: number;
  altText: string;
  type: DiffType;
}> {
  if (top1 === alt) {
    return [];
  }
  return editOpsToSpans(top1, alt, buildEditScript(top1, alt));
}

/**
 * Detect diff spans between segment text and non-rank0 hypotheses.
 */
export function detectNbestDiffSpans(
  segmentText: string,
  hypotheses: readonly ASRHypothesis[]
): NbestDiffSpan[] {
  const top1 = segmentText;
  const out: NbestDiffSpan[] = [];
  const seen = new Set<string>();

  for (const hyp of hypotheses) {
    if (hyp.rank === 0) {
      continue;
    }
    const alt = hyp.text.trim();
    if (!alt || alt === top1) {
      continue;
    }
    for (const raw of charDiffSpansInTop1(top1, alt)) {
      const top1Text = top1.slice(raw.start, raw.end);
      const partial: Omit<NbestDiffSpan, 'diffSpanId'> = {
        hypothesisRank: hyp.rank,
        top1Start: raw.start,
        top1End: raw.end,
        top1Text,
        altText: raw.altText,
        diffType: raw.type,
      };
      const diffSpanId = buildDiffSpanId(partial);
      if (seen.has(diffSpanId)) {
        continue;
      }
      seen.add(diffSpanId);
      out.push({ ...partial, diffSpanId });
    }
  }

  return out.sort((a, b) => a.top1Start - b.top1Start || a.hypothesisRank - b.hypothesisRank);
}
