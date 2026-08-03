/**
 * Tone rebind for PathFineSpan final range (slice/cache read — no second model inference).
 *
 * Depends only on span raw/syllable range + candidates, not LTR commit ranking.
 */

import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import { extractAcousticTonePatternForRecall } from '../span-assembly-shared/tone-recall';
import { computeToneScoreResult } from '../tone-match-score';
import type { PathFineSpan, PathFineSpanToneRebindTrace } from './path-fine-span-types';
import type { WindowCandidate } from './v4-types';

export type PathFineSpanToneRebindResult = PathFineSpanToneRebindTrace;

/**
 * Rebind tone diagnostics on PathFineSpan candidates to the span's final range.
 * Mutates span.candidates tone fields when an acoustic pattern is available.
 */
export function rebindToneForFineSpan(
  span: PathFineSpan,
  acousticSlices: AcousticToneSlice[] | undefined,
  wordTimeSpans: WordTimeSpan[],
  toneTimestampOnlyEnabled: boolean
): PathFineSpanToneRebindResult {
  const preRebindCandidateRawStart = span.candidates[0]?.rawStart ?? span.rawStart;
  const preRebindCandidateRawEnd = span.candidates[0]?.rawEnd ?? span.rawEnd;

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
      finalToneRawStart = span.rawStart;
      finalToneRawEnd = span.rawEnd;
    }
  }

  if (acousticTonePattern) {
    for (const candidate of span.candidates) {
      rebindCandidateTone(candidate, acousticTonePattern, span);
    }
  } else {
    for (const candidate of span.candidates) {
      candidate.rawStart = span.rawStart;
      candidate.rawEnd = span.rawEnd;
      candidate.syllableStart = span.syllableStart;
      candidate.syllableEnd = span.syllableEnd;
    }
  }

  const trace: PathFineSpanToneRebindResult = {
    preRebindCandidateRawStart,
    preRebindCandidateRawEnd,
    pathRawStart: span.rawStart,
    pathRawEnd: span.rawEnd,
    finalToneRawStart,
    finalToneRawEnd,
    recomputedAfterRebind: true,
    acousticTonePattern,
  };
  span.toneRebindTrace = trace;
  return trace;
}

function rebindCandidateTone(
  candidate: WindowCandidate,
  acousticTonePattern: number[],
  span: PathFineSpan
): void {
  candidate.rawStart = span.rawStart;
  candidate.rawEnd = span.rawEnd;
  candidate.syllableStart = span.syllableStart;
  candidate.syllableEnd = span.syllableEnd;
  // Exact-term candidates carry no standalone tone key here — Recall already tone-scored them.
  const scored = computeToneScoreResult(acousticTonePattern, '', candidate.replacement);
  candidate.toneCompatible = scored.toneCompatible;
  candidate.tonePenalty = scored.tonePenalty;
  candidate.toneReason = scored.toneReason;
}
