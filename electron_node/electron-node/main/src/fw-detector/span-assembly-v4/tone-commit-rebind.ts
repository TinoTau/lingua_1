/**
 * Formal FineSpan Tone commit rebind (Supplement / Constraint: final tone range = Formal range).
 *
 * Temporary options may carry tone evidence from their own window recall. After Formal commit,
 * re-extract AcousticToneSlice pattern for the Formal rawStart/rawEnd only (slice/cache read —
 * no per-option second model inference). Loser option tone is never reused.
 */

import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import { extractAcousticTonePatternForRecall } from '../span-assembly-shared/tone-recall';
import { computeToneScoreResult } from '../tone-match-score';
import type { FormalFineSpan } from './ltr-fine-span-generator';
import type { WindowCandidate } from './v4-types';

export type ToneCommitTrace = {
  optionRawStart: number;
  optionRawEnd: number;
  formalRawStart: number;
  formalRawEnd: number;
  finalToneRawStart: number;
  finalToneRawEnd: number;
  recomputedAfterCommit: true;
  acousticTonePattern: number[] | null;
};

/**
 * Rebind tone diagnostics on Formal FineSpan candidates to the committed Formal range.
 * Mutates span.candidates tone fields when a Formal acoustic pattern is available.
 */
export function rebindToneAfterFormalCommit(
  span: FormalFineSpan,
  acousticSlices: AcousticToneSlice[] | undefined,
  wordTimeSpans: WordTimeSpan[],
  toneTimestampOnlyEnabled: boolean
): ToneCommitTrace {
  const optionRawStart = span.candidates[0]?.rawStart ?? span.rawStart;
  const optionRawEnd = span.candidates[0]?.rawEnd ?? span.rawEnd;

  let acousticTonePattern: number[] | null = null;
  let finalToneRawStart = span.rawStart;
  let finalToneRawEnd = span.rawEnd;

  if (toneTimestampOnlyEnabled && acousticSlices?.length && wordTimeSpans.length) {
    const extracted = extractAcousticTonePatternForRecall(
      span.rawStart,
      span.rawEnd,
      span.syllableStart,
      span.syllableEnd,
      acousticSlices,
      wordTimeSpans
    );
    acousticTonePattern = extracted.pattern;
    if (extracted.windowTimeRange) {
      // Keep character-range SSOT for tone mapping; windowTimeRange is time-only.
      finalToneRawStart = span.rawStart;
      finalToneRawEnd = span.rawEnd;
    }
  }

  if (acousticTonePattern) {
    for (const candidate of span.candidates) {
      rebindCandidateTone(candidate, acousticTonePattern, span);
    }
  } else {
    // Still force candidate ranges to Formal coordinates for diagnostics consistency.
    for (const candidate of span.candidates) {
      candidate.rawStart = span.rawStart;
      candidate.rawEnd = span.rawEnd;
      candidate.syllableStart = span.syllableStart;
      candidate.syllableEnd = span.syllableEnd;
    }
  }

  const trace: ToneCommitTrace = {
    optionRawStart,
    optionRawEnd,
    formalRawStart: span.rawStart,
    formalRawEnd: span.rawEnd,
    finalToneRawStart,
    finalToneRawEnd,
    recomputedAfterCommit: true,
    acousticTonePattern,
  };
  span.toneCommitTrace = trace;
  return trace;
}

function rebindCandidateTone(
  candidate: WindowCandidate,
  acousticTonePattern: number[],
  span: FormalFineSpan
): void {
  candidate.rawStart = span.rawStart;
  candidate.rawEnd = span.rawEnd;
  candidate.syllableStart = span.syllableStart;
  candidate.syllableEnd = span.syllableEnd;
  const toneKey = candidate.fragmentTonePinyinKey ?? '';
  const scored = computeToneScoreResult(acousticTonePattern, toneKey, candidate.replacement);
  candidate.toneCompatible = scored.toneCompatible;
  candidate.tonePenalty = scored.tonePenalty;
  candidate.toneReason = scored.toneReason;
}
