/**
 * Capture V2 completeness validator — evidence completeness only.
 * Missing mandatory → CAPTURE_INCOMPLETE (never empty-array PASS).
 */
import {
  CAPTURE_V2_MANDATORY_BOUNDARIES,
  type CaptureV2BoundaryId,
  type CaptureV2BoundaryRecord,
  type CaptureV2CompletenessStatus,
} from './types';

export type CompletenessInput = {
  boundaries: Partial<Record<CaptureV2BoundaryId, CaptureV2BoundaryRecord>>;
  incomplete_marks: Array<{ boundary_id?: CaptureV2BoundaryId; reason: string }>;
};

function isTruncationMarker(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.authoritative_truncated === true || p._truncated === true;
}

function boundaryPayloadMissing(rec: CaptureV2BoundaryRecord | undefined): string | null {
  if (!rec) return 'boundary_absent';
  if (rec.missing) return rec.missing_reason || 'marked_missing';
  if (rec.payload === null || rec.payload === undefined) return 'null_payload';
  if (isTruncationMarker(rec.payload)) return 'authoritative_truncation_marker';
  return null;
}

/**
 * Tone injection-state completeness (Replay Role Matrix: acousticToneSlices = INJECTION_STATE).
 * Canonical path: B4.payload.acousticToneSlices (not B2; not reconstructed from mapped Tone).
 */
export type ToneSliceExecutionStatus =
  | 'TONE_EXECUTED_AND_SLICES_CAPTURED'
  | 'TONE_LEGITIMATELY_NOT_APPLICABLE'
  | 'TONE_CAPABILITY_UNAVAILABLE'
  | 'TONE_REQUIRED_BUT_SLICES_MISSING';

function windowsIndicateToneConsumed(windows: unknown[]): boolean {
  for (const w of windows) {
    if (!w || typeof w !== 'object') continue;
    const row = w as Record<string, unknown>;
    if (Array.isArray(row.acousticTonePattern) && row.acousticTonePattern.length > 0) return true;
    if (typeof row.toneNorm === 'string' && row.toneNorm.length > 0) return true;
    if (Array.isArray(row.pattern) && row.pattern.length > 0) return true;
  }
  return false;
}

function validateB4ToneInjection(p: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const slices = p.acousticToneSlices;
  const windows = Array.isArray(p.windows) ? p.windows : [];
  const status = p.tone_execution_status as ToneSliceExecutionStatus | undefined;
  const role = p.slice_role;

  if (role != null && role !== 'INJECTION_STATE') {
    issues.push('B4:slice_role_must_be_INJECTION_STATE');
  }

  if (slices === undefined || slices === null) {
    if (windowsIndicateToneConsumed(windows) || status === 'TONE_EXECUTED_AND_SLICES_CAPTURED') {
      issues.push('B4:TONE_REQUIRED_BUT_SLICES_MISSING');
    } else if (status === 'TONE_LEGITIMATELY_NOT_APPLICABLE' || status === 'TONE_CAPABILITY_UNAVAILABLE') {
      // Explicit legitimate empty — require declared status, no silent null PASS.
    } else {
      // No slices field at all without explicit N/A status.
      issues.push('B4:TONE_REQUIRED_BUT_SLICES_MISSING');
    }
    return issues;
  }

  if (!Array.isArray(slices)) {
    issues.push('B4:acousticToneSlices_not_array');
    return issues;
  }

  if (isTruncationMarker({ authoritative_truncated: (p as any).slices_authoritative_truncated })) {
    issues.push('B4:acousticToneSlices_authoritative_truncation');
  }

  if (slices.length > 0) {
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i] as Record<string, unknown> | null;
      if (!s || typeof s !== 'object') {
        issues.push(`B4:slice[${i}]_not_object`);
        continue;
      }
      if (typeof s.start !== 'number' || typeof s.end !== 'number') {
        issues.push(`B4:slice[${i}]_timing`);
      }
      if (!s.tonePosterior || typeof s.tonePosterior !== 'object') {
        issues.push(`B4:slice[${i}]_tonePosterior`);
      }
    }
    if (status && status !== 'TONE_EXECUTED_AND_SLICES_CAPTURED') {
      issues.push('B4:tone_execution_status_mismatch_nonempty_slices');
    }
    return issues;
  }

  // Empty array
  if (windowsIndicateToneConsumed(windows)) {
    issues.push('B4:TONE_REQUIRED_BUT_SLICES_MISSING');
    return issues;
  }
  if (
    status !== 'TONE_LEGITIMATELY_NOT_APPLICABLE' &&
    status !== 'TONE_CAPABILITY_UNAVAILABLE' &&
    status !== 'TONE_EXECUTED_AND_SLICES_CAPTURED'
  ) {
    // Empty slices without explicit classification → incomplete (never silent PASS).
    issues.push('B4:empty_slices_without_explicit_tone_status');
  }
  return issues;
}

function structuralIssues(id: CaptureV2BoundaryId, payload: unknown): string[] {
  const issues: string[] = [];
  if (payload === null || typeof payload !== 'object') {
    return [`${id}:payload_not_object`];
  }
  const p = payload as Record<string, unknown>;
  switch (id) {
    case 'B1':
      if (typeof p.rawAsrText !== 'string') issues.push('B1:rawAsrText');
      if (typeof p.repairText !== 'string') issues.push('B1:repairText');
      if (typeof p.scriptNormalized !== 'boolean') issues.push('B1:scriptNormalized');
      if (!Array.isArray(p.segments)) issues.push('B1:segments');
      break;
    case 'B2':
      if (!Array.isArray(p.segmentTimeOffsetsSec)) issues.push('B2:segmentTimeOffsetsSec');
      if (!Array.isArray(p.asrSegmentNodeBatchIndices)) issues.push('B2:asrSegmentNodeBatchIndices');
      if (!Array.isArray(p.segmentCharOffsets)) issues.push('B2:segmentCharOffsets');
      break;
    case 'B3':
      if (!Array.isArray(p.spans)) issues.push('B3:spans');
      if (typeof p.count !== 'number') issues.push('B3:count');
      if (typeof p.canonicalHash !== 'string') issues.push('B3:canonicalHash');
      break;
    case 'B4':
      if (!Array.isArray(p.windows)) issues.push('B4:windows');
      issues.push(...validateB4ToneInjection(p));
      break;
    case 'B5':
      if (!Array.isArray(p.paths)) issues.push('B5:paths');
      if (p.field_name !== 'finespans') issues.push('B5:field_name_must_be_finespans');
      break;
    case 'B6':
      if (typeof p.globalWindowGeneratedCount !== 'number') issues.push('B6:globalWindowGeneratedCount');
      if (typeof p.logicalWindowRecallCount !== 'number') issues.push('B6:logicalWindowRecallCount');
      if (typeof p.blockedWindowCount !== 'number') issues.push('B6:blockedWindowCount');
      if (!Array.isArray(p.logicalRecallWindows)) issues.push('B6:logicalRecallWindows');
      break;
    case 'B7':
      if (!Array.isArray(p.queries)) issues.push('B7:queries');
      break;
    case 'B8':
      if (!Array.isArray(p.executions)) issues.push('B8:executions');
      break;
    case 'B9':
      if (!Array.isArray(p.occurrence_list)) issues.push('B9:occurrence_list');
      if (!Array.isArray(p.unique_identity_set)) issues.push('B9:unique_identity_set');
      break;
    case 'B10':
      if (typeof p.inputHash !== 'string' && !Array.isArray(p.windows)) issues.push('B10:input');
      break;
    case 'B11':
      if (p.selected_actions == null && p.after_model2_candidate_set == null) {
        issues.push('B11:output');
      }
      break;
    case 'B12':
      if (!Array.isArray(p.edges)) issues.push('B12:edges');
      break;
    case 'B13':
      if (typeof p.completePathCountBeforePrune !== 'number') issues.push('B13:completePathCountBeforePrune');
      if (typeof p.sortedPathIdentityHash !== 'string') issues.push('B13:sortedPathIdentityHash');
      break;
    case 'B14':
      if (!Array.isArray(p.retained_path_ids)) issues.push('B14:retained_path_ids');
      break;
    case 'B15':
      if (!Array.isArray(p.paths) && p.domainScores == null) issues.push('B15:domain_or_paths');
      break;
    case 'B16':
      if (!Array.isArray(p.pool)) issues.push('B16:pool');
      break;
    case 'B17':
      if (p.by_path == null && !Array.isArray(p.anchors) && !Array.isArray(p.paths)) {
        issues.push('B17:anchors_or_paths');
      }
      break;
    case 'B18':
      if (typeof p.finalPostprocessText !== 'string') issues.push('B18:finalPostprocessText');
      if (typeof p.finalHash !== 'string') issues.push('B18:finalHash');
      break;
    default:
      break;
  }
  return issues;
}

export function validateCaptureV2Completeness(input: CompletenessInput): {
  status: CaptureV2CompletenessStatus;
  details: string[];
} {
  const hard: string[] = [];
  for (const mark of input.incomplete_marks) {
    hard.push(`incomplete_mark:${mark.boundary_id ?? 'general'}:${mark.reason}`);
  }
  for (const id of CAPTURE_V2_MANDATORY_BOUNDARIES) {
    const miss = boundaryPayloadMissing(input.boundaries[id]);
    if (miss) {
      hard.push(`missing:${id}:${miss}`);
      continue;
    }
    hard.push(...structuralIssues(id, input.boundaries[id]!.payload));
  }
  return {
    status: hard.length === 0 ? 'COMPLETE' : 'CAPTURE_INCOMPLETE',
    details: hard,
  };
}
