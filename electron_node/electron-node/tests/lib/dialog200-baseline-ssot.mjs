/**
 * Dialog200 Baseline SSOT pointer — single authority loader.
 * Engine Stable V1: ONE authoritative Capture V2 baseline. Fail closed.
 * No V1 fallback, no supplementation, no env selector.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../../..');
const DEFAULT_SSOT = path.join(
  REPO,
  'docs/user_correction/model3/DIALOG200_BASELINE_SSOT.json'
);

/** Historical evidence. Never selectable as authoritative baseline. */
const HISTORICAL_ONLY_EVIDENCE = new Set([
  'DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl',
  'fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl',
]);

function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

/**
 * @returns {{
 *   authority: string,
 *   evidencePath: string,
 *   provenancePath: string,
 *   runId: string,
 *   caseCount: number,
 *   status: string,
 *   manifest: object
 * }}
 */
export function resolveDialog200BaselineSsot(ssotPath = DEFAULT_SSOT) {
  if (!fs.existsSync(ssotPath)) {
    throw new Error(
      `DIALOG200_BASELINE_SSOT missing at ${ssotPath}. FAIL_CLOSED. No V1 fallback.`
    );
  }
  const manifest = JSON.parse(fs.readFileSync(ssotPath, 'utf8'));
  if (manifest.authority !== 'DIALOG200_BASELINE_SSOT') {
    throw new Error(
      `DIALOG200_BASELINE_SSOT authority=${manifest.authority} invalid. FAIL_CLOSED.`
    );
  }
  if (manifest.status !== 'AUTHORITATIVE') {
    throw new Error(
      `DIALOG200_BASELINE_SSOT status=${manifest.status} (expected AUTHORITATIVE). FAIL_CLOSED.`
    );
  }
  if (manifest.case_count !== 200) {
    throw new Error(
      `DIALOG200_BASELINE_SSOT case_count=${manifest.case_count} (expected 200). FAIL_CLOSED.`
    );
  }
  if (!manifest.run_id || typeof manifest.evidence_sha256 !== 'string' || !manifest.evidence_sha256) {
    throw new Error('DIALOG200_BASELINE_SSOT missing run_id or evidence_sha256. FAIL_CLOSED.');
  }
  const evidenceRel = manifest.evidence_artifact;
  const provRel = manifest.provenance_artifact;
  if (!evidenceRel || !provRel) {
    throw new Error('DIALOG200_BASELINE_SSOT missing evidence or provenance artifact. FAIL_CLOSED.');
  }
  const evidenceBase = path.basename(String(evidenceRel));
  if (HISTORICAL_ONLY_EVIDENCE.has(evidenceBase)) {
    throw new Error(
      `HISTORICAL_ONLY_NOT_AUTHORITY: ${evidenceBase} cannot be selected as baseline. NOT_RUNTIME_FALLBACK. FAIL_CLOSED.`
    );
  }
  const evidencePath = path.isAbsolute(evidenceRel)
    ? evidenceRel
    : path.join(REPO, evidenceRel);
  const provenancePath = path.isAbsolute(provRel) ? provRel : path.join(REPO, provRel);
  if (!fs.existsSync(evidencePath)) {
    throw new Error(`SSOT evidence missing: ${evidencePath}. FAIL_CLOSED. No V1 fallback.`);
  }
  const actualSha = sha256File(evidencePath);
  if (actualSha.toLowerCase() !== String(manifest.evidence_sha256).toLowerCase()) {
    throw new Error(
      `SSOT evidence SHA mismatch expected=${manifest.evidence_sha256} actual=${actualSha}. FAIL_CLOSED.`
    );
  }
  return {
    authority: manifest.authority,
    evidencePath,
    provenancePath,
    runId: manifest.run_id,
    caseCount: manifest.case_count,
    evidenceSha256: actualSha,
    status: manifest.status,
    manifest,
  };
}

export function loadDialog200SsotCases(ssotPath = DEFAULT_SSOT) {
  const ssot = resolveDialog200BaselineSsot(ssotPath);
  const rows = fs
    .readFileSync(ssot.evidencePath, 'utf8')
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (rows.length !== ssot.caseCount) {
    throw new Error(
      `SSOT case count mismatch rows=${rows.length} declared=${ssot.caseCount}. FAIL_CLOSED.`
    );
  }
  return { ssot, rows };
}

/** Hard refuse reading retired incomplete baseline as authority. */
export function assertNotRetiredBaseline(filePath) {
  const base = path.basename(String(filePath || ''));
  if (HISTORICAL_ONLY_EVIDENCE.has(base)) {
    throw new Error(
      `HISTORICAL_ONLY_NOT_AUTHORITY: ${base} must not be used as active evaluation baseline. NOT_RUNTIME_FALLBACK. Use DIALOG200_BASELINE_SSOT.`
    );
  }
}
