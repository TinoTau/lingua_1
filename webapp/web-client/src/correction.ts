/**
 * Manual Correction — Browser → API Gateway only.
 * Browser never authors authoritative user_id; never calls Scheduler correction API.
 */

export type CorrectionUiState =
  | 'idle'
  | 'editing'
  | 'submitting'
  | 'submitted'
  | 'error';

export interface UtteranceCorrectionModel {
  sessionId: string;
  utteranceIndex: number;
  /** Immutable system ASR fact */
  systemText: string;
  correctedTextDraft: string;
  correctionState: CorrectionUiState;
  clientCorrectionId: string | null;
  lastError: string | null;
  lastCorrectionId: string | null;
  submittedCorrectedText: string | null;
}

export interface SubmitCorrectionPayload {
  session_id: string;
  utterance_index: number;
  system_text: string;
  corrected_text: string;
  client_correction_id: string;
  source_profile_version?: number;
  pipeline_version?: string;
}

export interface SubmitCorrectionResult {
  accepted: boolean;
  correction_id: string;
  duplicate: boolean;
  profile_delta: unknown | null;
}

const MAX_TEXT = 8000;

export function createCorrectionModel(
  sessionId: string,
  utteranceIndex: number,
  systemText: string
): UtteranceCorrectionModel {
  return {
    sessionId,
    utteranceIndex,
    systemText,
    correctedTextDraft: systemText,
    correctionState: 'idle',
    clientCorrectionId: null,
    lastError: null,
    lastCorrectionId: null,
    submittedCorrectedText: null,
  };
}

export function beginEdit(model: UtteranceCorrectionModel): UtteranceCorrectionModel {
  return {
    ...model,
    correctionState: 'editing',
    correctedTextDraft: model.systemText,
    lastError: null,
    // New explicit confirm → new client id (re-edit after submit)
    clientCorrectionId: model.correctionState === 'submitted' ? null : model.clientCorrectionId,
  };
}

export function cancelEdit(model: UtteranceCorrectionModel): UtteranceCorrectionModel {
  return {
    ...model,
    correctionState: model.submittedCorrectedText ? 'submitted' : 'idle',
    correctedTextDraft: model.submittedCorrectedText ?? model.systemText,
    lastError: null,
  };
}

export function setDraft(
  model: UtteranceCorrectionModel,
  draft: string
): UtteranceCorrectionModel {
  return { ...model, correctedTextDraft: draft };
}

/** Validate before submit; returns error message or null if ok. */
export function validateCorrectionSubmit(model: UtteranceCorrectionModel): string | null {
  const system = model.systemText.trim();
  const corrected = model.correctedTextDraft.trim();
  if (!system) return 'system_text required';
  if (!corrected) return 'corrected_text required';
  if (system === corrected) return 'NO_OP: corrected text equals system text';
  if (system.length > MAX_TEXT || corrected.length > MAX_TEXT) return 'text too large';
  if (!model.sessionId) return 'session_id required';
  return null;
}

export function ensureClientCorrectionId(model: UtteranceCorrectionModel): UtteranceCorrectionModel {
  if (model.clientCorrectionId) return model;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { ...model, clientCorrectionId: id };
}

export function gatewayHttpBaseFromWsUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const proto = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${proto}//${u.host}`;
  } catch {
    return 'http://127.0.0.1:8081';
  }
}

export function apiKeyFromWsUrl(wsUrl: string): string | null {
  try {
    const u = new URL(wsUrl);
    return u.searchParams.get('access_token') || u.searchParams.get('api_key');
  } catch {
    return null;
  }
}

/**
 * Submit correction to Gateway POST /v1/corrections only.
 */
export async function submitCorrection(
  gatewayHttpBase: string,
  apiKey: string,
  payload: SubmitCorrectionPayload,
  fetchImpl: typeof fetch = fetch
): Promise<SubmitCorrectionResult> {
  const res = await fetchImpl(`${gatewayHttpBase.replace(/\/$/, '')}/v1/corrections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return {
    accepted: !!body.accepted,
    correction_id: String(body.correction_id || ''),
    duplicate: !!body.duplicate,
    profile_delta: body.profile_delta ?? null,
  };
}
