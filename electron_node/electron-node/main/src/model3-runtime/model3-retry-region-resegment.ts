/**
 * Local retry-region re-segmentation — reuses production lattice FineSpan generation on a slice.
 * Acoustic/tone + word-time inputs are utterance SSOT views remapped to region-local raw coords.
 */

import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { PathFineSpan, PathFineSpanView } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import { runLatticeFineSpanGeneration } from '../fw-detector/span-assembly-v4/lattice-fine-span-runtime';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../fw-detector/pinyin-ime-v2/pinyin-ime-v2-types';
import type { AcousticToneSlice, WordTimeSpan } from '../fw-detector/tone-time-align';
import type { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { Model3RetryRegion } from './model3-retry-region';

export type RetryRegionLocalSpan = {
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  surface: string;
};

export type ResegmentRetryRegionResult = {
  ok: boolean;
  localSpans: RetryRegionLocalSpan[];
  code?: string;
};

export type Model3RetryRegionResegmentFn = (args: {
  region: Model3RetryRegion;
  rawText: string;
  globalSyllables: readonly string[];
  pathFineSpans: readonly PathFineSpan[];
}) => ResegmentRetryRegionResult | Promise<ResegmentRetryRegionResult>;

function mapLocalSpansToGlobal(
  localPathSpans: readonly PathFineSpan[],
  region: Model3RetryRegion,
  rawText: string
): RetryRegionLocalSpan[] {
  return localPathSpans.map((s) => ({
    rawStart: region.rawStart + s.rawStart,
    rawEnd: region.rawStart + s.rawEnd,
    syllableStart: region.syllableStart + s.syllableStart,
    syllableEnd: region.syllableStart + s.syllableEnd,
    surface: rawText.slice(region.rawStart + s.rawStart, region.rawStart + s.rawEnd),
  }));
}

/** Coordinate identity for Retry Stage-2 Recall — downstream uses bounds + surface only. */
function retryRegionLocalSpanKey(span: RetryRegionLocalSpan): string {
  return `${span.syllableStart}:${span.syllableEnd}:${span.rawStart}:${span.rawEnd}`;
}

/**
 * Dedup semantically equivalent local spans from multiple retained pathFineSpanViews.
 * Stable first-wins; path provenance is not consumed downstream.
 */
export function dedupRetryRegionLocalSpans(
  spans: readonly RetryRegionLocalSpan[]
): RetryRegionLocalSpan[] {
  const seen = new Set<string>();
  const out: RetryRegionLocalSpan[] = [];
  for (const span of spans) {
    const key = retryRegionLocalSpanKey(span);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(span);
  }
  return out;
}

function collectLocalSpansFromRetainedPathViews(
  pathFineSpanViews: readonly PathFineSpanView[],
  region: Model3RetryRegion,
  rawText: string
): RetryRegionLocalSpan[] {
  const collected: RetryRegionLocalSpan[] = [];
  for (const view of pathFineSpanViews) {
    collected.push(...mapLocalSpansToGlobal(view.pathFineSpans, region, rawText));
  }
  return dedupRetryRegionLocalSpans(collected);
}

/**
 * Derive region-local WordTimeSpan raw offsets from authoritative utterance spans.
 * Times stay absolute so AcousticToneSlice overlap mapping remains valid.
 */
function regionLocalWordTimeSpans(
  wordTimeSpans: readonly WordTimeSpan[],
  region: Model3RetryRegion
): WordTimeSpan[] {
  const sliceLen = Math.max(0, region.rawEnd - region.rawStart);
  return wordTimeSpans
    .filter((s) => (s.rawEnd ?? 0) > region.rawStart && (s.rawStart ?? 0) < region.rawEnd)
    .map((s) => ({
      ...s,
      rawStart: Math.max(0, (s.rawStart ?? 0) - region.rawStart),
      rawEnd: Math.min(sliceLen, (s.rawEnd ?? 0) - region.rawStart),
    }));
}

/** Fallback: one local span per original source span in region (boundary-locked). */
export function fallbackRegionLocalSpans(
  region: Model3RetryRegion,
  pathFineSpans: readonly PathFineSpan[],
  rawText: string
): RetryRegionLocalSpan[] {
  return pathFineSpans
    .filter((s) => region.sourceSpanIds.includes(s.spanId))
    .map((s) => ({
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      surface: rawText.slice(s.rawStart, s.rawEnd),
    }));
}

/**
 * Production re-segmentation: lattice generation on bounded raw/syllable slice.
 * All retained pathFineSpanViews contribute deduped local spans (no single-path discard).
 * Tone/acoustic: same SSOT objects as first-pass FineSpan (region-local raw remap only).
 */
export async function resegmentRetryRegionWithLattice(args: {
  region: Model3RetryRegion;
  rawText: string;
  globalSyllables: readonly string[];
  pathFineSpans: readonly PathFineSpan[];
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  retainedDomains: readonly string[];
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  coarseSpans: readonly CoarseSpan[];
  minPrior?: number;
  /** Authoritative utterance acoustic slices (first-pass SSOT). */
  acousticSlices?: readonly AcousticToneSlice[];
  /** Authoritative utterance word time spans (first-pass SSOT). */
  wordTimeSpans?: readonly WordTimeSpan[];
  fuzzyRecallEnabled?: boolean;
  toneTimestampOnlyEnabled?: boolean;
}): Promise<ResegmentRetryRegionResult> {
  const sliceText = args.rawText.slice(args.region.rawStart, args.region.rawEnd);
  // Bounded view of authoritative utterance syllable coordinate — not a new SSOT.
  const sliceSyllables = args.globalSyllables.slice(
    args.region.syllableStart,
    args.region.syllableEnd
  );
  if (!sliceText || sliceSyllables.length <= 0) {
    return {
      ok: false,
      localSpans: fallbackRegionLocalSpans(args.region, args.pathFineSpans, args.rawText),
      code: 'EMPTY_SLICE',
    };
  }

  const sliceCoarse = args.coarseSpans
    .filter(
      (c) => c.rawStart < args.region.rawEnd && c.rawEnd > args.region.rawStart
    )
    .map((c) => ({
      ...c,
      rawStart: Math.max(0, c.rawStart - args.region.rawStart),
      rawEnd: Math.min(sliceText.length, c.rawEnd - args.region.rawStart),
      syllableStart: Math.max(0, c.syllableStart - args.region.syllableStart),
      syllableEnd: Math.min(sliceSyllables.length, c.syllableEnd - args.region.syllableStart),
    }));

  const acousticSlices = args.acousticSlices ? [...args.acousticSlices] : undefined;
  const wordTimeSpans = args.wordTimeSpans
    ? regionLocalWordTimeSpans(args.wordTimeSpans, args.region)
    : undefined;

  try {
    const lattice = runLatticeFineSpanGeneration({
      rawText: sliceText,
      runtime: args.runtime,
      profile: args.profile,
      domainIds: [...args.retainedDomains],
      minPrior: args.minPrior ?? 0,
      imeConfig: args.imeConfig,
      dict: args.dict,
      coarseSpans: sliceCoarse.length ? sliceCoarse : undefined,
      acousticSlices,
      wordTimeSpans,
      fuzzyRecallEnabled: args.fuzzyRecallEnabled,
      toneTimestampOnlyEnabled: args.toneTimestampOnlyEnabled,
      enableUtteranceRecallCache: false,
    });
    if (!lattice.ok || !lattice.pathFineSpanViews.length) {
      return {
        ok: false,
        localSpans: fallbackRegionLocalSpans(args.region, args.pathFineSpans, args.rawText),
        code: lattice.ok ? 'NO_PATH' : lattice.code,
      };
    }
    return {
      ok: true,
      localSpans: collectLocalSpansFromRetainedPathViews(
        lattice.pathFineSpanViews,
        args.region,
        args.rawText
      ),
    };
  } catch (err) {
    return {
      ok: false,
      localSpans: fallbackRegionLocalSpans(args.region, args.pathFineSpans, args.rawText),
      code: err instanceof Error ? err.message : String(err),
    };
  }
}
