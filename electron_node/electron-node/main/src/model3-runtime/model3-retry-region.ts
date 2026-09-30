/**
 * Model3 retry-region derivation — ASR postprocess only.
 * Derives bounded regions from RETRY decisions + PathFineSpan order; no new span registry.
 */

import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { Model3AnchorMark, Model3SpanDecision } from './model3-types';
import { anchorSpanIdSet } from './model3-anchor-adapter';

export type Model3RetryRegion = {
  retryRegionId: string;
  sourceSpanIds: readonly string[];
  firstSpanId: string;
  lastSpanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  regionMergedFromAdjacentRetry: boolean;
};

function isRetryEligible(
  span: PathFineSpan,
  decisionBySpan: Map<string, Model3SpanDecision>,
  anchorIds: ReadonlySet<string>
): boolean {
  if (anchorIds.has(span.spanId)) return false;
  const decision = decisionBySpan.get(span.spanId);
  return Boolean(decision && decision.decision === 'RETRY');
}

function spansAreAdjacent(a: PathFineSpan, b: PathFineSpan): boolean {
  return a.rawEnd === b.rawStart && a.syllableEnd === b.syllableStart;
}

function buildRegionFromSpans(spans: readonly PathFineSpan[]): Model3RetryRegion {
  const first = spans[0]!;
  const last = spans[spans.length - 1]!;
  const sourceSpanIds = Object.freeze(spans.map((s) => s.spanId));
  return {
    retryRegionId: `m3rr:${first.spanId}:${last.spanId}`,
    sourceSpanIds,
    firstSpanId: first.spanId,
    lastSpanId: last.spanId,
    rawStart: first.rawStart,
    rawEnd: last.rawEnd,
    syllableStart: first.syllableStart,
    syllableEnd: last.syllableEnd,
    regionMergedFromAdjacentRetry: spans.length > 1,
  };
}

/**
 * Collect NON-ANCHOR RETRY spans; merge directly adjacent RETRY spans when contiguous in
 * raw/syllable offsets. KEEP spans and Anchor spans break merge groups.
 */
export function deriveRetryRegions(args: {
  decisions: readonly Model3SpanDecision[];
  anchors: readonly Model3AnchorMark[];
  pathFineSpans: readonly PathFineSpan[];
}): Model3RetryRegion[] {
  const anchorIds = anchorSpanIdSet(args.anchors);
  const decisionBySpan = new Map(args.decisions.map((d) => [d.spanId, d]));
  const regions: Model3RetryRegion[] = [];
  let pending: PathFineSpan[] = [];

  const flush = (): void => {
    if (pending.length === 0) return;
    regions.push(buildRegionFromSpans(pending));
    pending = [];
  };

  for (const span of args.pathFineSpans) {
    if (!isRetryEligible(span, decisionBySpan, anchorIds)) {
      flush();
      continue;
    }
    if (pending.length > 0) {
      const prev = pending[pending.length - 1]!;
      if (!spansAreAdjacent(prev, span)) {
        flush();
      }
    }
    pending.push(span);
  }
  flush();
  return regions;
}

export function regionOverlapsCandidate(
  region: Model3RetryRegion,
  c: { rawStart: number; rawEnd: number; syllableStart: number; syllableEnd: number; isCovered?: boolean }
): boolean {
  if (c.isCovered) return false;
  const rawOverlap = c.rawStart < region.rawEnd && c.rawEnd > region.rawStart;
  const sylOverlap =
    c.syllableStart < region.syllableEnd && c.syllableEnd > region.syllableStart;
  return rawOverlap && sylOverlap;
}

export function surfacesForRegion(
  pathFineSpans: readonly PathFineSpan[],
  region: Model3RetryRegion,
  rawText: string
): string[] {
  return pathFineSpans
    .filter((s) => region.sourceSpanIds.includes(s.spanId))
    .map((s) => rawText.slice(s.rawStart, s.rawEnd));
}
