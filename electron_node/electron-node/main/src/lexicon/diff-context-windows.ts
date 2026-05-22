/**
 * Recover V5 Phase B — dual-scale windows inside diff context (chunk-bounded).
 */

import { textToSyllables } from './phonetic/pinyin';
import type { NbestDiffSpan } from './nbest-diff-span';
import { detectSuspiciousSpans, type TextSpan } from './suspicious-span-detector';
import type { AsrWindow } from './lexicon-types';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type DiffWindowMeta = {
  windowTrigger: 'nbest_diff';
  diffSpanId: string;
  hypothesisRank: number;
};

export type AsrWindowWithMeta = AsrWindow & { meta?: DiffWindowMeta };

export type DiffContextWindowsOptions = {
  allowedWindowLengths: readonly number[];
  fineLengths: readonly number[];
  coarseLengths: readonly number[];
  diffContextLeft: number;
  diffContextRight: number;
  maxWindows: number;
  hypothesisIndex?: number;
};

export type DiffContextWindowsResult = {
  windows: AsrWindowWithMeta[];
  windowLengthDistribution: Record<number, number>;
  fullChunkDualScaleCount: number;
};

function hashShort(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function windowKey(start: number, end: number, text: string): string {
  return `${start}:${end}:${text}`;
}

function spanOverlapsChunk(span: NbestDiffSpan, chunk: TextSpan): boolean {
  return span.top1Start < chunk.end && span.top1End > chunk.start;
}

/**
 * Expand diff span context and clamp to chunk bounds (D-07: no cross-chunk).
 */
export function expandDiffSpanContext(
  span: Pick<NbestDiffSpan, 'top1Start' | 'top1End'>,
  segmentText: string,
  left: number,
  right: number,
  chunk: TextSpan
): TextSpan | null {
  const start = Math.max(chunk.start, span.top1Start - left);
  const end = Math.min(chunk.end, span.top1End + right);
  if (end <= start) {
    return null;
  }
  return { text: segmentText.slice(start, end), start, end };
}

export function enumerateWindowsFromDiffContext(
  region: TextSpan,
  segmentText: string,
  lengths: readonly number[],
  meta: DiffWindowMeta,
  hypothesisIndex: number,
  maxWindows: number,
  seen: Set<string>,
  out: AsrWindowWithMeta[],
  distribution: Record<number, number>
): void {
  const localText = segmentText.slice(region.start, region.end);
  for (const size of lengths) {
    if (localText.length < size) {
      continue;
    }
    for (let i = 0; i + size <= localText.length; i++) {
      if (out.length >= maxWindows) {
        return;
      }
      const windowText = localText.slice(i, i + size);
      if (!hasCjk(windowText)) {
        continue;
      }
      const start = region.start + i;
      const end = start + size;
      const key = windowKey(start, end, windowText);
      if (seen.has(key)) {
        continue;
      }
      const syllables = textToSyllables(windowText);
      if (!syllables.length) {
        continue;
      }
      seen.add(key);
      distribution[size] = (distribution[size] ?? 0) + 1;
      out.push({
        windowId: `h${hypothesisIndex}-diff-${meta.diffSpanId}-${start}-${end}-${hashShort(windowText)}`,
        text: windowText,
        start,
        end,
        syllables,
        meta,
      });
    }
  }
}

/**
 * Fine (2–3) + coarse (4–5) enumeration only inside diff context regions.
 */
export function buildDiffContextWindows(
  segmentText: string,
  diffSpans: readonly NbestDiffSpan[],
  options: DiffContextWindowsOptions
): DiffContextWindowsResult {
  const chunks = detectSuspiciousSpans(segmentText);
  const seen = new Set<string>();
  const windows: AsrWindowWithMeta[] = [];
  const distribution: Record<number, number> = {};
  const hIdx = options.hypothesisIndex ?? 0;
  const allowed = new Set(options.allowedWindowLengths);
  const fine = options.fineLengths.filter((l) => allowed.has(l));
  const coarse = options.coarseLengths.filter((l) => allowed.has(l));

  for (const span of diffSpans) {
    const meta: DiffWindowMeta = {
      windowTrigger: 'nbest_diff',
      diffSpanId: span.diffSpanId,
      hypothesisRank: span.hypothesisRank,
    };
    for (const chunk of chunks) {
      if (!spanOverlapsChunk(span, chunk)) {
        continue;
      }
      const region = expandDiffSpanContext(
        span,
        segmentText,
        options.diffContextLeft,
        options.diffContextRight,
        chunk
      );
      if (!region) {
        continue;
      }
      enumerateWindowsFromDiffContext(
        region,
        segmentText,
        fine,
        meta,
        hIdx,
        options.maxWindows,
        seen,
        windows,
        distribution
      );
      enumerateWindowsFromDiffContext(
        region,
        segmentText,
        coarse,
        meta,
        hIdx,
        options.maxWindows,
        seen,
        windows,
        distribution
      );
    }
  }

  return {
    windows,
    windowLengthDistribution: distribution,
    fullChunkDualScaleCount: 0,
  };
}
