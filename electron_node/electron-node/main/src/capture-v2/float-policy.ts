/**
 * Capture V2 float policy — SSOT exact.
 * FLOAT_TIME: ALIGNMENT_TIME_TOLERANCE_SEC = 1e-3
 * KenLM: SCORE_ABS_TOLERANCE = 1e-6
 * Persist original values; tolerance is for comparison only.
 */
export const FLOAT_TIME_ABS_TOLERANCE_SEC = 0.001;
export const FLOAT_TIME_AUTHORITY = 'ALIGNMENT_TIME_TOLERANCE_SEC';

export const KENLM_SCORE_ABS_TOLERANCE = 1e-6;
export const KENLM_SCORE_AUTHORITY = 'SCORE_ABS_TOLERANCE';

export function floatTimeEqual(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) <= FLOAT_TIME_ABS_TOLERANCE_SEC;
}

export function kenlmScoreEqual(a: number, b: number): boolean {
  return Math.abs(Number(a) - Number(b)) <= KENLM_SCORE_ABS_TOLERANCE;
}
