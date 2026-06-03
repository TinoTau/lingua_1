import type { PinyinImeV2SingleCharRole } from './pinyin-ime-v2-types';

/** Allowed in main beam (low weight from TSV). */
export const MAIN_BEAM_SINGLE_CHAR_ROLES = new Set<PinyinImeV2SingleCharRole>([
  'function_single_char',
  'time_single_char',
  'place_direction_single_char',
  'measure_single_char',
]);

/** Fallback-only single chars (not equal competition with multi-char tokens). */
export const FALLBACK_SINGLE_CHAR_ROLES = new Set<PinyinImeV2SingleCharRole>([
  'service_content_single_char',
  'content_single_char',
  'content_single_char_fallback',
]);

export const FALLBACK_SCORE_FACTOR = 0.06;

export function isKnownSingleCharRole(role: string): role is PinyinImeV2SingleCharRole {
  return MAIN_BEAM_SINGLE_CHAR_ROLES.has(role as PinyinImeV2SingleCharRole)
    || FALLBACK_SINGLE_CHAR_ROLES.has(role as PinyinImeV2SingleCharRole);
}
