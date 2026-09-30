/**
 * Capture V2 case-scoped collector (AsyncLocalStorage).
 * Production algorithms must NEVER read collector state for decisions.
 * Default no-op when gate OFF.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { isFrozenEvidenceCaptureV2Enabled } from './gate';
import { canonicalHash, snapshotCopy } from './serialize';
import {
  CAPTURE_V2_MANDATORY_BOUNDARIES,
  CAPTURE_V2_SCHEMA,
  CAPTURE_V2_SCHEMA_VERSION,
  type CaptureV2BoundaryId,
  type CaptureV2BoundaryRecord,
  type CaptureV2CaseArtifact,
  type CaptureV2CompletenessStatus,
} from './types';
import { validateCaptureV2Completeness } from './completeness';

type Store = {
  caseId: string | null;
  identity: Record<string, unknown>;
  boundaries: Partial<Record<CaptureV2BoundaryId, CaptureV2BoundaryRecord>>;
  incomplete_marks: Array<{ boundary_id?: CaptureV2BoundaryId; reason: string }>;
  finalized: CaptureV2CaseArtifact | null;
};

const storage = new AsyncLocalStorage<Store>();

function newStore(caseId: string | null): Store {
  return {
    caseId,
    identity: {},
    boundaries: {},
    incomplete_marks: [],
    finalized: null,
  };
}

export function isCaptureV2CollectorActive(): boolean {
  return isFrozenEvidenceCaptureV2Enabled() && storage.getStore() != null;
}

/** Begin a case-scoped capture. No-op when gate OFF. */
export function beginCaptureV2Case(caseId?: string | null): void {
  if (!isFrozenEvidenceCaptureV2Enabled()) return;
  storage.enterWith(newStore(caseId ?? null));
}

export function runWithCaptureV2Case<T>(caseId: string | null | undefined, fn: () => T): T {
  if (!isFrozenEvidenceCaptureV2Enabled()) {
    return fn();
  }
  return storage.run(newStore(caseId ?? null), fn);
}

export async function runWithCaptureV2CaseAsync<T>(
  caseId: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!isFrozenEvidenceCaptureV2Enabled()) {
    return fn();
  }
  return storage.run(newStore(caseId ?? null), fn);
}

export function captureV2Identity(fields: Record<string, unknown>): void {
  const store = storage.getStore();
  if (!store || !isFrozenEvidenceCaptureV2Enabled()) return;
  Object.assign(store.identity, snapshotCopy(fields) as Record<string, unknown>);
}

/**
 * Snapshot a boundary payload. Copies deeply; never mutates Production input.
 * No-op when gate OFF or no active case store.
 * Special: B17 merges by_path maps across path invocations.
 */
export function captureV2Boundary(boundaryId: CaptureV2BoundaryId, payload: unknown): void {
  if (!isFrozenEvidenceCaptureV2Enabled()) return;
  const store = storage.getStore();
  if (!store) return;
  const copied = snapshotCopy(payload);

  if (boundaryId === 'B17' && store.boundaries.B17?.payload && typeof copied === 'object' && copied) {
    const prev = store.boundaries.B17.payload as Record<string, unknown>;
    const next = copied as Record<string, unknown>;
    const mergedByPath = {
      ...((prev.by_path as Record<string, unknown>) || {}),
      ...((next.by_path as Record<string, unknown>) || {}),
    };
    const merged = { ...prev, ...next, by_path: mergedByPath };
    store.boundaries.B17 = {
      boundary_id: 'B17',
      captured_at_ms: Date.now(),
      payload: merged,
      payload_hash: canonicalHash(merged),
      missing: false,
    };
    return;
  }

  // B4: ONE authority for acousticToneSlices (INJECTION_STATE) + windows (COMPARISON_ONLY).
  // Early orchestrator write may persist slices; later recall write merges windows without wiping slices.
  if (boundaryId === 'B4' && store.boundaries.B4?.payload && typeof copied === 'object' && copied) {
    const prev = store.boundaries.B4.payload as Record<string, unknown>;
    const next = copied as Record<string, unknown>;
    const merged: Record<string, unknown> = {
      ...prev,
      ...next,
      acousticToneSlices:
        next.acousticToneSlices !== undefined ? next.acousticToneSlices : prev.acousticToneSlices,
      windows: next.windows !== undefined ? next.windows : prev.windows,
      slice_role: 'INJECTION_STATE',
      tone_execution_status:
        next.tone_execution_status !== undefined
          ? next.tone_execution_status
          : prev.tone_execution_status,
    };
    store.boundaries.B4 = {
      boundary_id: 'B4',
      captured_at_ms: Date.now(),
      payload: merged,
      payload_hash: canonicalHash(merged),
      missing: false,
    };
    return;
  }

  const record: CaptureV2BoundaryRecord = {
    boundary_id: boundaryId,
    captured_at_ms: Date.now(),
    payload: copied,
    payload_hash: canonicalHash(copied),
    missing: false,
  };
  store.boundaries[boundaryId] = record;
}

export function markCaptureV2Incomplete(
  reason: string,
  boundaryId?: CaptureV2BoundaryId
): void {
  if (!isFrozenEvidenceCaptureV2Enabled()) return;
  const store = storage.getStore();
  if (!store) return;
  store.incomplete_marks.push({ boundary_id: boundaryId, reason });
  if (boundaryId) {
    const existing = store.boundaries[boundaryId];
    if (!existing) {
      store.boundaries[boundaryId] = {
        boundary_id: boundaryId,
        captured_at_ms: Date.now(),
        payload: null,
        payload_hash: canonicalHash(null),
        missing: true,
        missing_reason: reason,
      };
    } else {
      existing.missing = true;
      existing.missing_reason = reason;
    }
  }
}

export function finalizeCaptureV2Case(): CaptureV2CaseArtifact | null {
  if (!isFrozenEvidenceCaptureV2Enabled()) return null;
  const store = storage.getStore();
  if (!store) return null;

  const { status, details } = validateCaptureV2Completeness({
    boundaries: store.boundaries,
    incomplete_marks: store.incomplete_marks,
  });

  const artifact: CaptureV2CaseArtifact = {
    schema: CAPTURE_V2_SCHEMA,
    schema_version: CAPTURE_V2_SCHEMA_VERSION,
    caseId: store.caseId,
    gate: 'ON',
    identity: { ...store.identity },
    boundaries: { ...store.boundaries },
    incomplete_marks: [...store.incomplete_marks],
    completeness: status,
    completeness_details: details,
    finalized_at: new Date().toISOString(),
  };
  store.finalized = artifact;
  return artifact;
}

export function getCaptureV2FinalizedArtifact(): CaptureV2CaseArtifact | null {
  return storage.getStore()?.finalized ?? null;
}

/** Test helper: peek active store boundaries (never used by Production decisions). */
export function __debugCaptureV2Store(): Store | null {
  return storage.getStore() ?? null;
}

export function listMandatoryBoundaries(): readonly CaptureV2BoundaryId[] {
  return CAPTURE_V2_MANDATORY_BOUNDARIES;
}

export type { CaptureV2CompletenessStatus };
