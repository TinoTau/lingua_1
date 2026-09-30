/**
 * Capture V2 schema types — DIALOG200_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2
 */
export const CAPTURE_V2_SCHEMA = 'DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2';
export const CAPTURE_V2_SCHEMA_VERSION = '2.0.0';

export type CaptureV2BoundaryId =
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'B6'
  | 'B7'
  | 'B8'
  | 'B9'
  | 'B10'
  | 'B11'
  | 'B12'
  | 'B13'
  | 'B14'
  | 'B15'
  | 'B16'
  | 'B17'
  | 'B18';

export const CAPTURE_V2_MANDATORY_BOUNDARIES: readonly CaptureV2BoundaryId[] = [
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
  'B10',
  'B11',
  'B12',
  'B13',
  'B14',
  'B15',
  'B16',
  'B17',
  'B18',
] as const;

export type CaptureV2CompletenessStatus = 'COMPLETE' | 'CAPTURE_INCOMPLETE';

export type CaptureV2BoundaryRecord = {
  boundary_id: CaptureV2BoundaryId;
  captured_at_ms: number;
  payload: unknown;
  payload_hash: string;
  missing?: boolean;
  missing_reason?: string;
};

export type CaptureV2CaseArtifact = {
  schema: typeof CAPTURE_V2_SCHEMA;
  schema_version: typeof CAPTURE_V2_SCHEMA_VERSION;
  caseId: string | null;
  gate: 'ON';
  identity: Record<string, unknown>;
  boundaries: Partial<Record<CaptureV2BoundaryId, CaptureV2BoundaryRecord>>;
  incomplete_marks: Array<{ boundary_id?: CaptureV2BoundaryId; reason: string }>;
  completeness: CaptureV2CompletenessStatus;
  completeness_details: string[];
  finalized_at: string | null;
};
