import type { ToneEvidenceProductionDiagnostic } from '../../task-router/types';
import type { WordTimeSpan } from '../tone-time-align';
import type { TonePatternMappingMissReason } from '../tone-time-align';
import type { ToneMappingMissAttribution } from './types';

/**
 * Correlate a Mapping miss with Evidence production diagnostics by utterance-local time.
 * Does not invent Evidence — only attributes when times/text match a production row.
 */
export function attributeMappingMiss(input: {
  missReason?: TonePatternMappingMissReason;
  failedWordSpan?: WordTimeSpan;
  evidenceProduction?: ToneEvidenceProductionDiagnostic[];
}): ToneMappingMissAttribution {
  if (input.missReason === 'no_word_timespan_for_slot') {
    return 'word_timespan_mapping_failure';
  }

  const span = input.failedWordSpan;
  const rows = input.evidenceProduction ?? [];
  if (!span || !rows.length) {
    return 'unknown';
  }

  const hits = rows.filter(
    (row) =>
      row.endSec > span.start &&
      row.startSec < span.end &&
      (!span.word || !row.word || row.word === span.word)
  );
  const ranked = hits.length
    ? hits
    : rows.filter((row) => row.endSec > span.start && row.startSec < span.end);

  if (!ranked.length) {
    return input.missReason === 'no_slice_overlap_word_time'
      ? 'slice_exists_but_no_overlap'
      : 'unknown';
  }

  ranked.sort(
    (a, b) =>
      Math.abs(a.startSec - span.start) +
      Math.abs(a.endSec - span.end) -
      (Math.abs(b.startSec - span.start) + Math.abs(b.endSec - span.end))
  );
  const best = ranked[0];
  if (best.status === 'short_duration_skipped') {
    return 'short_duration_skipped';
  }
  if (best.status === 'feature_extraction_failed') {
    return 'feature_extraction_failed';
  }
  if (best.status === 'inference_output_missing') {
    return 'inference_output_missing';
  }
  if (best.status === 'invalid_word_time') {
    return 'invalid_word_time';
  }
  if (best.status === 'slice_created') {
    return 'slice_exists_but_no_overlap';
  }
  return 'unknown';
}

export function bumpCount<T extends string>(
  bag: Partial<Record<T, number>> | undefined,
  key: T
): Partial<Record<T, number>> {
  const next: Partial<Record<T, number>> = { ...(bag ?? {}) };
  next[key] = (next[key] ?? 0) + 1;
  return next;
}
