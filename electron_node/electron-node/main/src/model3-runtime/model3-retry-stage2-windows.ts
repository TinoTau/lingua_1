/**
 * Stage-2 success-path query enumeration — CONSUMER of SHARED_LEXICAL_WINDOW_OWNER.
 * Enumerates every legal contiguous syllable window L=1..min(5,R) inside RetryRegion.
 * Reuses buildLexicalWindowQueries; clips to region; minimal identity char↔syllable
 * ranges when utterance CJK coordinate is empty (e.g. ASCII unit fixtures).
 */

import {
  buildUtteranceSyllableCoordinate,
  type CharSyllableRange,
} from '../fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { buildLexicalWindowQueries } from '../fw-detector/span-assembly-v4/build-lexical-window-queries';
import {
  LATTICE_WINDOW_MAX_SYLLABLES,
  theoreticalLexicalWindowCount,
} from '../fw-detector/span-assembly-v4/window-construction-core';
import type { Model3RetryRegion } from './model3-retry-region';
import type { RetryRegionLocalSpan } from './model3-retry-region-resegment';

export type Stage2QueryRange = {
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  windowText: string;
  windowPinyinKey: string;
};

/**
 * Expected legal contiguous ranges count for RetryRegion syllable length R.
 * Count before dedup = SUM(R-L+1) for L=1..min(5,R).
 */
export function expectedStage2WindowCount(regionSyllableLength: number): number {
  return theoreticalLexicalWindowCount(
    regionSyllableLength,
    LATTICE_WINDOW_MAX_SYLLABLES
  );
}

function resolveCharSyllableRanges(
  rawText: string,
  globalSyllables: readonly string[]
): CharSyllableRange[] {
  const coord = buildUtteranceSyllableCoordinate(rawText);
  if (coord.ranges.length > 0) {
    return coord.ranges.map((r) => ({ ...r }));
  }
  // Minimal identity adapter when CJK stream yields no ranges but caller already
  // supplies a matching syllable stream (common in ASCII unit fixtures).
  if (rawText.length === globalSyllables.length && globalSyllables.length > 0) {
    return globalSyllables.map((_, i) => ({
      charStart: i,
      charEnd: i + 1,
      syllableStart: i,
      syllableEnd: i + 1,
    }));
  }
  return [];
}

/**
 * Enumerate Stage-2 query locals for a successful regional reinterpretation.
 */
export function enumerateStage2SuccessPathQueryLocals(args: {
  region: Model3RetryRegion;
  rawText: string;
  globalSyllables: readonly string[];
}): RetryRegionLocalSpan[] {
  return enumerateStage2SuccessPathQueryRanges(args).map((q) => ({
    rawStart: q.rawStart,
    rawEnd: q.rawEnd,
    syllableStart: q.syllableStart,
    syllableEnd: q.syllableEnd,
    surface: q.windowText,
  }));
}

export function enumerateStage2SuccessPathQueryRanges(args: {
  region: Model3RetryRegion;
  rawText: string;
  globalSyllables: readonly string[];
}): Stage2QueryRange[] {
  const { region, rawText, globalSyllables } = args;
  const R = region.syllableEnd - region.syllableStart;
  if (R <= 0) {
    return [];
  }

  const ranges = resolveCharSyllableRanges(rawText, globalSyllables);
  if (ranges.length === 0) {
    return [];
  }

  const windows = buildLexicalWindowQueries({
    rawText,
    globalSyllables,
    coarseSpans: [],
    charSyllableRanges: ranges,
  });

  const out: Stage2QueryRange[] = [];
  for (const w of windows) {
    if (
      w.syllableStart < region.syllableStart ||
      w.syllableEnd > region.syllableEnd ||
      w.rawStart < region.rawStart ||
      w.rawEnd > region.rawEnd
    ) {
      continue;
    }
    out.push({
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      rawStart: w.rawStart,
      rawEnd: w.rawEnd,
      windowText: w.windowText,
      windowPinyinKey: w.windowPinyinKey,
    });
  }
  return out;
}

/** Normalize query keys for set comparison (syllable + raw bounds). */
export function stage2QueryRangeKey(q: {
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
}): string {
  return `${q.syllableStart}:${q.syllableEnd}|${q.rawStart}:${q.rawEnd}`;
}
