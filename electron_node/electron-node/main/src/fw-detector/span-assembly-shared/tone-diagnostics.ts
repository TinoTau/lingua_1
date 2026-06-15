import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import { createTimestampToneCompliance } from '../tone-time-align';
import type { CoarseAssemblyToneDiagnostics } from './types';
import { resolveTimestampToneState } from './tone-recall';

export function createEmptyToneDiagnostics(
  acousticSlices?: AcousticToneSlice[],
  wordTimeSpans?: WordTimeSpan[],
  toneTimestampOnlyEnabled = true
): CoarseAssemblyToneDiagnostics {
  const toneState = resolveTimestampToneState(acousticSlices, toneTimestampOnlyEnabled);
  const compliance = createTimestampToneCompliance();
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
    alignmentTextUsedCount: compliance.alignmentTextUsedCount,
    tokenTextUsedForAlignmentCount: compliance.tokenTextUsedForAlignmentCount,
    charScanFallbackCount: compliance.charScanFallbackCount,
    ngramTonePatternAttemptCount: 0,
    ngramTonePatternHitCount: 0,
    ngramTonePatternMissCount: 0,
    recallToneCompatibleCount: 0,
    recallToneIncompatibleCount: 0,
    recallToneFallbackCount: 0,
  };
}
