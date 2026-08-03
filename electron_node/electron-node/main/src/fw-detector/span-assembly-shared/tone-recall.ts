import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import { mapToneEvidenceForRecall } from '../tone-time-align';

export type TimestampToneState = {
  tonePayloadAvailable: boolean;
  toneEnabled: boolean;
  toneSkippedReason?: string;
};

export function resolveTimestampToneState(
  acousticSlices: AcousticToneSlice[] | null | undefined,
  toneTimestampOnlyEnabled: boolean
): TimestampToneState {
  const tonePayloadAvailable = (acousticSlices?.length ?? 0) > 0;
  if (!toneTimestampOnlyEnabled) {
    return {
      tonePayloadAvailable,
      toneEnabled: false,
      toneSkippedReason: 'tone_timestamp_disabled',
    };
  }
  if (!tonePayloadAvailable) {
    return {
      tonePayloadAvailable: false,
      toneEnabled: false,
      toneSkippedReason: 'no_acoustic_slices',
    };
  }
  return {
    tonePayloadAvailable: true,
    toneEnabled: true,
  };
}

/**
 * Recall-side entry: consume real Tone Evidence via Participation Mapping.
 * Does not invent tones — mapToneEvidenceForRecall only reads real slice posteriors.
 */
export function extractAcousticTonePatternForRecall(
  rawStart: number,
  rawEnd: number,
  syllableStart: number,
  syllableEnd: number,
  acousticSlices: AcousticToneSlice[],
  wordTimeSpans: WordTimeSpan[]
) {
  return mapToneEvidenceForRecall(
    rawStart,
    rawEnd,
    syllableStart,
    syllableEnd,
    acousticSlices,
    wordTimeSpans
  );
}
