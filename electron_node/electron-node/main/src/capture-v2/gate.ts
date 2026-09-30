/**
 * Capture V2 — env gate.
 * Authority: LINGUA_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2.md §5
 * Default OFF. Conceptual owner = Capture V2 (not MODEL2_DIALOG200_TRACE).
 */
export const FROZEN_EVIDENCE_CAPTURE_V2_ENV = 'FROZEN_EVIDENCE_CAPTURE_V2';

export function isFrozenEvidenceCaptureV2Enabled(): boolean {
  return process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] === '1';
}
