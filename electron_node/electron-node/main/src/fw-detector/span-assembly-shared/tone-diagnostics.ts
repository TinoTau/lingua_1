import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import type { CoarseAssemblyToneDiagnostics } from './types';
import { resolveTimestampToneState } from './tone-recall';

export function createEmptyToneDiagnostics(
  acousticSlices?: AcousticToneSlice[],
  wordTimeSpans?: WordTimeSpan[],
  toneTimestampOnlyEnabled = true
): CoarseAssemblyToneDiagnostics {
  const toneState = resolveTimestampToneState(acousticSlices, toneTimestampOnlyEnabled);
  return {
    tonePayloadAvailable: toneState.tonePayloadAvailable,
    toneEnabled: toneState.toneEnabled,
    toneSkippedReason: toneState.toneSkippedReason,
    toneSliceCount: acousticSlices?.length ?? 0,
    wordTimeSpanCount: wordTimeSpans?.length ?? 0,
    windowTimeAttemptCount: 0,
    windowTimeHitCount: 0,
    toneOverlapHitCount: 0,
    toneOverlapMissCount: 0,
    toneOverlapSyllableMismatchCount: 0,
    ngramTonePatternAttemptCount: 0,
    ngramTonePatternHitCount: 0,
    ngramTonePatternMissCount: 0,
    recallToneCompatibleCount: 0,
    recallToneFallbackCount: 0,
    toneExactHitCount: 0,
    plainFallbackHitCount: 0,
  };
}
