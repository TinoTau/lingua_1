/**
 * Capture V2 public API — observability only.
 * Production must not depend on collector for decisions.
 */
export {
  FROZEN_EVIDENCE_CAPTURE_V2_ENV,
  isFrozenEvidenceCaptureV2Enabled,
} from './gate';
export {
  FLOAT_TIME_ABS_TOLERANCE_SEC,
  FLOAT_TIME_AUTHORITY,
  KENLM_SCORE_ABS_TOLERANCE,
  KENLM_SCORE_AUTHORITY,
  floatTimeEqual,
  kenlmScoreEqual,
} from './float-policy';
export {
  snapshotCopy,
  canonicalizeOrdered,
  canonicalizeUnorderedIdentities,
  stableStringify,
  sha256Utf8,
  canonicalHash,
} from './serialize';
export {
  beginCaptureV2Case,
  runWithCaptureV2Case,
  runWithCaptureV2CaseAsync,
  captureV2Identity,
  captureV2Boundary,
  markCaptureV2Incomplete,
  finalizeCaptureV2Case,
  getCaptureV2FinalizedArtifact,
  isCaptureV2CollectorActive,
  listMandatoryBoundaries,
  __debugCaptureV2Store,
} from './collector';
export { validateCaptureV2Completeness } from './completeness';
export {
  CAPTURE_V2_SCHEMA,
  CAPTURE_V2_SCHEMA_VERSION,
  CAPTURE_V2_MANDATORY_BOUNDARIES,
  type CaptureV2BoundaryId,
  type CaptureV2CaseArtifact,
  type CaptureV2CompletenessStatus,
} from './types';
