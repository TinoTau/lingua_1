/**
 * Lattice Phase 1 — full-utterance LexicalWindowQuery generation (length 1..5).
 * Harness / tests only; not wired into production orchestrator.
 */

import {
  buildUtteranceSyllableCoordinate,
  type CharSyllableRange,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { GlobalWindowDescriptor } from './v4-types';
import {
  buildWindowDescriptorForRange,
  LATTICE_WINDOW_MAX_SYLLABLES,
  LATTICE_WINDOW_MIN_SYLLABLES,
} from './window-construction-core';

/** Runtime carrier for Architecture LexicalWindowQuery — reuse GlobalWindowDescriptor. */
export type LexicalWindowQuery = GlobalWindowDescriptor;

export type BuildLexicalWindowQueriesInput = {
  rawText: string;
  globalSyllables: readonly string[];
  coarseSpans: readonly CoarseSpan[];
  /** Prefer utterance coordinate ranges SSOT when available. */
  charSyllableRanges?: readonly CharSyllableRange[];
};

/**
 * Emit every contiguous syllable window of length 1..5 over the full utterance.
 * windowId = `${syllableStart}:${syllableEnd}` (stable, coordinate-only).
 * Empty coarse refs are allowed; coarse cross is soft metadata only.
 */
export function buildLexicalWindowQueries(
  input: BuildLexicalWindowQueriesInput
): LexicalWindowQuery[] {
  const ranges = input.charSyllableRanges
    ? input.charSyllableRanges.map((r) => ({ ...r }))
    : buildUtteranceSyllableCoordinate(input.rawText).ranges;

  const syllableCount = input.globalSyllables.length;
  const windows: LexicalWindowQuery[] = [];

  for (let start = 0; start < syllableCount; start += 1) {
    const maxEnd = Math.min(start + LATTICE_WINDOW_MAX_SYLLABLES, syllableCount);
    for (let end = start + LATTICE_WINDOW_MIN_SYLLABLES; end <= maxEnd; end += 1) {
      const window = buildWindowDescriptorForRange({
        syllableStart: start,
        syllableEnd: end,
        rawText: input.rawText,
        globalSyllables: input.globalSyllables,
        coarseSpans: input.coarseSpans,
        charSyllableRanges: ranges,
        allowEmptyCoarseRefs: true,
        hardBlockOnBoundaryCross: false,
      });
      if (window) {
        windows.push(window);
      }
    }
  }

  return windows;
}
