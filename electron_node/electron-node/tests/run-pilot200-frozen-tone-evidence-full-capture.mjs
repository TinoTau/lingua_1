#!/usr/bin/env node
/**
 * LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE
 *
 * HARNESS-ONLY: capture missing frozen RAW+segments+utterance_tone for Pilot200.
 * NO product code change. NO profile matrix. NO Model2 quality analysis.
 *
 * Usage:
 *   node tests/run-pilot200-frozen-tone-evidence-full-capture.mjs
 *   node tests/run-pilot200-frozen-tone-evidence-full-capture.mjs --skip-start --resume
 *   node tests/run-pilot200-frozen-tone-evidence-full-capture.mjs --validate-only
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import {
  getTestServerPort,
  waitTestServerHealth,
  waitAsrReady,
} from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import {
  classifyAuthoritativeCaptureOutcome,
  hasTiming,
} from './lib/pilot200-capture-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json');
const CASES_JSONL = path.join(DATASET_DIR, 'cases', 'cases.jsonl');
const AUTHORITATIVE_BUILD = 'build_20260911_091806';
const EXISTING_BATCH = 'tonecap_2026-09-12T0001';
const EXISTING_DIR = path.join(DATASET_DIR, 'tone_evidence_captures', EXISTING_BATCH);
const PRIOR_SUMMARY = path.join(
  REPO,
  'docs/user_correction/model3/LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_SUMMARY.json'
);
const ARTIFACT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const PHASE = 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE';
const RUNNER_VERSION = 'pilot200-frozen-tone-evidence-full-capture-v1';

const EXISTING_VALID_IDS = [
  'p2_u001_002',
  'p2_u001_004',
  'p2_u001_016',
  'p2_u002_001',
  'p2_u002_016',
  'p2_u003_001',
  'p2_u003_016',
  'p2_u004_001',
];

const args = process.argv.slice(2);
const SKIP_START = args.includes('--skip-start');
const RESUME = args.includes('--resume');
const VALIDATE_ONLY = args.includes('--validate-only');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;
const batchIdx = args.indexOf('--batch-id');
const BATCH_ID_OVERRIDE = batchIdx >= 0 ? args[batchIdx + 1] : null;

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(p) {
  return sha256Buf(fs.readFileSync(p));
}
function canonicalHash(obj) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return sha256Buf(Buffer.from(JSON.stringify(sortKeys(obj ?? null)), 'utf8'));
}
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function emptyProfile() {
  return {
    schema_version: 2,
    profile_version: 0,
    phonetic_bias: {},
    tone_bias: {},
    personal_terms: [],
    personal_term_evidence: {},
    resolved_lexical_terms: {},
    unresolved_lexical_observations: [],
    legacy_free_text_personal_terms: [],
    confusion_bias: {},
    domain_bias: {},
    long_term_domain_evidence: {},
  };
}
function loadCases() {
  return fs
    .readFileSync(CASES_JSONL, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function validateEvidencePackage(evidence, caseRow) {
  return classifyAuthoritativeCaptureOutcome(evidence, caseRow, AUTHORITATIVE_BUILD);
}

function classifyCaptureError(errMsg, stage) {
  const m = String(errMsg || '');
  if (stage === 'audio_missing') return 'AUDIO_MISSING';
  if (stage === 'audio_read') return 'AUDIO_READ_FAIL';
  if (/bootstrap/i.test(m)) return 'HARNESS_FAIL';
  if (/ECONNREFUSED|fetch failed|timeout|AbortError/i.test(m)) return 'ASR_RUNTIME_FAIL';
  if (/HTTP|pipeline|asr/i.test(m)) return 'ASR_RUNTIME_FAIL';
  if (/write|ENOENT|EPERM/i.test(m)) return 'OUTPUT_WRITE_FAIL';
  return 'UNKNOWN';
}

function ensureServicePreferences() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  if (!fs.existsSync(cfgPath)) return;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const prefs = { ...(cfg.servicePreferences || {}) };
  let changed = false;
  for (const id of ['faster-whisper-vad']) {
    if (prefs[id] !== true) {
      prefs[id] = true;
      changed = true;
    }
  }
  if (changed) {
    cfg.servicePreferences = prefs;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  }
}

function startElectron() {
  ensureServicePreferences();
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    MODEL2_DIALOG200_TRACE: '0',
    TONE_P10_VAD_CPU: '1',
  };
  delete env.MODEL2_RUNTIME_DISABLED;
  delete env.MODEL3_RUNTIME_DISABLED;
  const child = spawn(process.execPath, [START_DETACHED], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stdout += d.toString();
  });
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout: stdout.trim().slice(0, 2000) });
    });
  });
}

async function postJson(port, route, body, timeoutMs = 300000) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function captureOne(port, caseRow, captureBatchId) {
  const audioAbs = path.join(DATASET_DIR, caseRow.audioPath);
  if (!fs.existsSync(audioAbs)) {
    const e = new Error(`missing audio ${audioAbs}`);
    e.captureFailureReason = 'AUDIO_MISSING';
    throw e;
  }
  let audioSha256;
  try {
    audioSha256 = sha256File(audioAbs);
  } catch (err) {
    const e = new Error(err instanceof Error ? err.message : String(err));
    e.captureFailureReason = 'AUDIO_READ_FAIL';
    throw e;
  }

  const sessionId = `pilot200-tonecap::${caseRow.caseId}::${captureBatchId}`;
  const profile = emptyProfile();
  const boot = await postJson(
    port,
    '/session-bootstrap',
    {
      type: 'session_bootstrap',
      session_id: sessionId,
      user_id: caseRow.userId,
      profile_version: 0,
      user_profile: profile,
      trace_id: `${captureBatchId}_${caseRow.caseId}`,
    },
    30000
  );
  if (!(boot.ok && boot.data?.ok)) {
    const e = new Error(`bootstrap failed: ${JSON.stringify(boot.data)}`);
    e.captureFailureReason = 'HARNESS_FAIL';
    throw e;
  }

  const pipe = await postJson(
    port,
    '/run-pipeline-with-audio',
    {
      wavPath: audioAbs,
      srcLang: 'zh',
      tgtLang: 'en',
      session_id: sessionId,
      is_manual_cut: true,
    },
    300000
  );
  if (!pipe.ok) {
    const e = new Error(pipe.data?.error || `HTTP ${pipe.status}`);
    e.captureFailureReason = 'ASR_RUNTIME_FAIL';
    throw e;
  }

  const rawMergedAsrText = pipe.data.text_asr ?? pipe.data.extra?.raw_asr_text ?? '';
  const segments = Array.isArray(pipe.data.segments) ? pipe.data.segments : [];
  const utteranceTone = pipe.data.extra?.utterance_tone || null;
  const slices = Array.isArray(utteranceTone?.acousticToneSlices)
    ? utteranceTone.acousticToneSlices
    : [];
  const skippedReason = utteranceTone?.skippedReason ?? null;

  const evidence = {
    caseId: caseRow.caseId,
    captureBatchId,
    datasetBuildId: AUTHORITATIVE_BUILD,
    split: caseRow.split,
    userId: caseRow.userId,
    domain: caseRow.domain,
    audioId: caseRow.audioId,
    audioPath: caseRow.audioPath,
    audioSha256,
    profileConditionAtCapture: 'NO_PROFILE',
    rawMergedAsrText,
    rawAsrHash: sha256Buf(Buffer.from(String(rawMergedAsrText), 'utf8')),
    segments,
    segmentEvidenceHash: canonicalHash(segments),
    utterance_tone: utteranceTone,
    acousticToneSlices: slices,
    toneEvidenceHash: canonicalHash(slices),
    toneSliceCount: slices.length,
    toneSkippedReason: skippedReason,
    toneEvidencePresent: slices.length > 0,
    sessionId,
    captureTimestamp: new Date().toISOString(),
    runnerVersion: RUNNER_VERSION,
    asrExecutedForCapture: true,
    status: 'OK',
  };
  return evidence;
}

function coverageMap(rows, key, expectedKeys) {
  const out = {};
  for (const k of expectedKeys) out[k] = { have: 0, total: 0 };
  for (const r of rows) {
    const k = r[key];
    if (!out[k]) out[k] = { have: 0, total: 0 };
    out[k].total += 1;
    if (r.evidenceStatus === 'PASS') out[k].have += 1;
  }
  const asStr = {};
  for (const [k, v] of Object.entries(out)) asStr[k] = `${v.have}/${v.total}`;
  return asStr;
}

function writeArtifacts({
  captureBatchId,
  captureDir,
  allCases,
  byId,
  existingEntries,
  newResults,
  targetMissingIds,
  setValid,
}) {
  const byCase = new Map();
  for (const e of existingEntries) byCase.set(e.caseId, e);
  for (const e of newResults) byCase.set(e.caseId, e);

  const manifestEntries = allCases.map((c) => {
    const row = byCase.get(c.caseId);
    if (!row) {
      return {
        caseId: c.caseId,
        split: c.split,
        userId: c.userId,
        domain: c.domain,
        evidenceStatus: 'FAIL',
        sourceCaptureBatch: null,
        evidenceFile: null,
        authoritativeEvidenceFile: null,
        rawPresent: false,
        segmentsPresent: false,
        toneEvidencePresent: false,
        caseIdentityMatch: 'FAIL',
        audioIdentityMatch: 'FAIL',
        captureFailureReason: 'UNKNOWN',
      };
    }
    return {
      caseId: c.caseId,
      split: c.split,
      userId: c.userId,
      domain: c.domain,
      evidenceStatus: row.evidenceStatus,
      captureOutcome: row.captureOutcome ?? (row.evidenceStatus === 'PASS' ? 'ASR_NONEMPTY' : 'CAPTURE_INVALID'),
      runtimeClass: row.runtimeClass ?? (row.evidenceStatus === 'PASS' ? 'RAW_REPAIR_NEEDED' : 'CAPTURE_INVALID'),
      toneStatus: row.toneStatus ?? (row.toneEvidencePresent ? 'TONE_EVIDENCE_PRESENT' : 'TONE_EVIDENCE_MISSING'),
      model2Eligibility: row.model2Eligibility ?? (row.evidenceStatus === 'PASS' ? 'ELIGIBLE_FOR_EVALUATION' : 'NOT_ELIGIBLE_INVALID_CAPTURE'),
      sourceCaptureBatch: row.sourceCaptureBatch,
      evidenceFile: row.evidenceFile,
      authoritativeEvidenceFile: row.evidenceFile,
      rawPresent: row.rawPresent,
      segmentsPresent: row.segmentsPresent,
      toneEvidencePresent: row.toneEvidencePresent,
      caseIdentityMatch: row.caseIdentityMatch,
      audioIdentityMatch: row.audioIdentityMatch,
      captureFailureReason: row.captureFailureReason,
      toneSliceCount: row.toneSliceCount ?? null,
      reusedExisting: row.reusedExisting === true,
    };
  });

  const valid = manifestEntries.filter((m) => m.evidenceStatus === 'PASS');
  const missing = manifestEntries.filter((m) => m.evidenceStatus !== 'PASS');
  const failCats = {};
  for (const m of missing) {
    const k = m.captureFailureReason || 'UNKNOWN';
    failCats[k] = (failCats[k] || 0) + 1;
  }

  const attempted = newResults.filter((r) => r.attempted).length;
  const successNew = newResults.filter((r) => r.evidenceStatus === 'PASS' && r.attempted).length;
  const failNew = newResults.filter((r) => r.evidenceStatus !== 'PASS' && r.attempted).length;
  const existingReused = existingEntries.filter((e) => e.evidenceStatus === 'PASS').length;
  const existingInvalid = existingEntries.filter((e) => e.evidenceStatus !== 'PASS').length;

  const evidenceComplete =
    manifestEntries.length === 200 &&
    valid.length === 200 &&
    missing.length === 0 &&
    manifestEntries.every((m) => m.caseIdentityMatch === 'PASS') &&
    manifestEntries.every((m) => m.audioIdentityMatch === 'PASS') &&
    manifestEntries.every((m) => {
      if (m.captureOutcome === 'ASR_NONEMPTY') {
        return m.segmentsPresent && m.toneEvidencePresent;
      }
      if (m.captureOutcome === 'ASR_EMPTY') {
        return m.toneStatus === 'TONE_NOT_APPLICABLE_ASR_EMPTY';
      }
      return false;
    });

  const userCov = coverageMap(manifestEntries, 'userId', [
    'U001',
    'U002',
    'U003',
    'U004',
    'U005',
  ]);
  const domainCov = coverageMap(manifestEntries, 'domain', [
    'general_daily',
    'software_meeting',
    'travel_hotel',
    'food_cafe',
    'medical',
    'retail_service',
  ]);
  const splitRows = {
    DEV: manifestEntries.filter((m) => m.split === 'DEV'),
    VALIDATION: manifestEntries.filter((m) => m.split === 'VALIDATION'),
    HOLDOUT: manifestEntries.filter((m) => m.split === 'HOLDOUT'),
  };
  const covStr = (arr) => `${arr.filter((x) => x.evidenceStatus === 'PASS').length}/${arr.length}`;

  let oneNextOwner = 'PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE';
  if (!evidenceComplete) {
    const dominant =
      Object.entries(failCats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'HARNESS_CAPTURE';
    const map = {
      ASR_RUNTIME_FAIL: 'ASR_CAPTURE_RUNTIME',
      ASR_SEGMENT_MISSING: 'ASR_CAPTURE_RUNTIME',
      TIMESTAMP_MISSING: 'ASR_CAPTURE_RUNTIME',
      TONE_RUNTIME_FAIL: 'TONE_CAPTURE_RUNTIME',
      TONE_EVIDENCE_NOT_PERSISTED: 'TONE_CAPTURE_RUNTIME',
      AUDIO_MISSING: 'AUDIO_SOURCE_GAP',
      AUDIO_READ_FAIL: 'AUDIO_SOURCE_GAP',
      IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
      HARNESS_FAIL: 'HARNESS_CAPTURE',
      OUTPUT_WRITE_FAIL: 'HARNESS_CAPTURE',
      UNKNOWN: 'HARNESS_CAPTURE',
    };
    oneNextOwner = map[dominant] || 'HARNESS_CAPTURE';
  }

  const summary = {
    PHASE,
    DATASET: 'LINGUA_DIALOG2000_V2_PILOT200',
    BUILD: AUTHORITATIVE_BUILD,
    TOTAL_UNIQUE_CASES: 200,
    CAPTURE_TARGET_SET_VALID: setValid,
    INITIAL_VALID_EVIDENCE: 8,
    INITIAL_MISSING_EVIDENCE: 192,
    TARGET_CAPTURE_COUNT: 192,
    CAPTURE_BATCH_ID: captureBatchId,
    EXISTING_BATCH_ID: EXISTING_BATCH,
    ASR_EXECUTED_FOR_CAPTURE: 'YES',
    CAPTURE_ATTEMPTED_COUNT: attempted,
    CAPTURE_SUCCESS_COUNT: successNew,
    CAPTURE_FAIL_COUNT: failNew,
    FINAL_VALID_EVIDENCE_COUNT: valid.length,
    FINAL_MISSING_EVIDENCE_COUNT: missing.length,
    ASR_NONEMPTY_VALID_COUNT: manifestEntries.filter(
      (m) => m.evidenceStatus === 'PASS' && m.captureOutcome === 'ASR_NONEMPTY'
    ).length,
    ASR_EMPTY_VALID_COUNT: manifestEntries.filter(
      (m) => m.evidenceStatus === 'PASS' && m.captureOutcome === 'ASR_EMPTY'
    ).length,
    CAPTURE_INVALID_COUNT: manifestEntries.filter((m) => m.evidenceStatus !== 'PASS').length,
    AUTHORITATIVE_CAPTURE_VALID_COUNT: valid.length,
    DEV_COVERAGE: covStr(splitRows.DEV),
    VALIDATION_COVERAGE: covStr(splitRows.VALIDATION),
    HOLDOUT_COVERAGE: covStr(splitRows.HOLDOUT),
    USER_COVERAGE: userCov,
    DOMAIN_COVERAGE: domainCov,
    CASE_IDENTITY_MISMATCH_COUNT: manifestEntries.filter((m) => m.caseIdentityMatch !== 'PASS')
      .length,
    AUDIO_IDENTITY_MISMATCH_COUNT: manifestEntries.filter((m) => m.audioIdentityMatch !== 'PASS')
      .length,
    SEGMENTS_MISSING_COUNT: manifestEntries.filter(
      (m) => m.captureFailureReason === 'ASR_SEGMENT_MISSING'
    ).length,
    TONE_EVIDENCE_MISSING_COUNT: manifestEntries.filter(
      (m) => m.captureFailureReason === 'TONE_EVIDENCE_NOT_PERSISTED'
    ).length,
    EXISTING_CAPTURE_REUSED_COUNT: existingReused,
    EXISTING_CAPTURE_INVALID_COUNT: existingInvalid,
    CAPTURE_FAILURE_TAXONOMY: failCats,
    HARNESS_ONLY_CHANGE: 'YES',
    HARNESS_ONLY_FILES: [
      'electron_node/electron-node/tests/run-pilot200-frozen-tone-evidence-full-capture.mjs',
    ],
    PRODUCT_CODE_CHANGE: 'NO',
    AUTHORITATIVE_MODEL2_SSOT: 'AUG12_PRE_LEXICAL_EDGE',
    ARCHITECTURE_SCOPE_VIOLATION: 'NO',
    EVIDENCE_COMPLETE: evidenceComplete ? 'YES' : 'NO',
    FULL_PILOT200_REMEASURE_EVIDENCE_READY: evidenceComplete ? 'YES' : 'NO',
    ONE_NEXT_OWNER: oneNextOwner,
    CAPTURE_DIR: captureDir,
    TARGET_MISSING_COUNT: targetMissingIds.length,
  };

  const report = `# LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE_REPORT

| Field | Value |
|-------|-------|
| Date | ${new Date().toISOString().slice(0, 10)} |
| Nature | MEASUREMENT / EVIDENCE CAPTURE ONLY |
| PHASE | ${PHASE} |

## A. Pilot identity

\`\`\`text
DATASET = LINGUA_DIALOG2000_V2_PILOT200
BUILD = ${AUTHORITATIVE_BUILD}
TOTAL_UNIQUE_CASES = 200
SPLITS = DEV120 / VALIDATION60 / HOLDOUT20
CAPTURE_TARGET_SET_VALID = ${setValid}
\`\`\`

## B. Initial coverage

\`\`\`text
INITIAL_VALID_EVIDENCE = 8 / 200
INITIAL_MISSING_EVIDENCE = 192
EXISTING_BATCH = ${EXISTING_BATCH}
\`\`\`

## C. Capture execution

\`\`\`text
NEW_CAPTURE_BATCH = ${captureBatchId}
TARGET_CAPTURE_COUNT = 192
CAPTURE_ATTEMPTED_COUNT = ${attempted}
CAPTURE_SUCCESS_COUNT = ${successNew}
CAPTURE_FAIL_COUNT = ${failNew}
ASR_EXECUTED_FOR_CAPTURE = YES
PROFILE_MATRIX_EXECUTED = NO
\`\`\`

## D. Final coverage

| Slice | Coverage |
|-------|----------|
| Overall | ${valid.length}/200 |
| DEV | ${summary.DEV_COVERAGE} |
| VALIDATION | ${summary.VALIDATION_COVERAGE} |
| HOLDOUT | ${summary.HOLDOUT_COVERAGE} |

### User

${Object.entries(userCov)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

### Domain

${Object.entries(domainCov)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## E. Contract validation

| Check | Count FAIL |
|-------|-----------:|
| CASE_IDENTITY_MISMATCH | ${summary.CASE_IDENTITY_MISMATCH_COUNT} |
| AUDIO_IDENTITY_MISMATCH | ${summary.AUDIO_IDENTITY_MISMATCH_COUNT} |
| SEGMENTS_MISSING | ${summary.SEGMENTS_MISSING_COUNT} |
| TONE_EVIDENCE_MISSING | ${summary.TONE_EVIDENCE_MISSING_COUNT} |

## F. Capture failures

\`\`\`json
${JSON.stringify(failCats, null, 2)}
\`\`\`

Failed case IDs (if any): ${
    missing.length
      ? missing
          .slice(0, 40)
          .map((m) => m.caseId)
          .join(', ') + (missing.length > 40 ? ` …(+${missing.length - 40})` : '')
      : '(none)'
  }

## G. Existing 8 handling

\`\`\`text
EXISTING_CAPTURE_REUSED_COUNT = ${existingReused}
EXISTING_CAPTURE_INVALID_COUNT = ${existingInvalid}
POLICY = KEEP prior validated captures; do not regenerate unless contract invalid
\`\`\`

Reused IDs: ${EXISTING_VALID_IDS.join(', ')}

## H. Harness changes

\`\`\`text
HARNESS_ONLY_CHANGE = YES
PRODUCT_CODE_CHANGE = NO
ARCHITECTURE_SCOPE_VIOLATION = NO
AUTHORITATIVE_MODEL2_SSOT = AUG12_PRE_LEXICAL_EDGE
\`\`\`

Harness-only file:

- \`electron_node/electron-node/tests/run-pilot200-frozen-tone-evidence-full-capture.mjs\`

## I. Full Pilot readiness

\`\`\`text
EVIDENCE_COMPLETE = ${summary.EVIDENCE_COMPLETE}
FULL_PILOT200_REMEASURE_EVIDENCE_READY = ${summary.FULL_PILOT200_REMEASURE_EVIDENCE_READY}
\`\`\`

## J. One next owner

\`\`\`text
ONE_NEXT_OWNER = ${oneNextOwner}
\`\`\`

**STOP.** No profile matrix. No Model2 quality analysis.
`;

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'),
    JSON.stringify(
      {
        PHASE,
        DATASET: 'LINGUA_DIALOG2000_V2_PILOT200',
        BUILD: AUTHORITATIVE_BUILD,
        CAPTURE_BATCH_ID: captureBatchId,
        EXISTING_BATCH_ID: EXISTING_BATCH,
        TOTAL_CASES: 200,
        cases: manifestEntries,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE_SUMMARY.json'),
    JSON.stringify(summary, null, 2)
  );
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE_REPORT.md'),
    report
  );

  fs.writeFileSync(
    path.join(captureDir, 'capture_run_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  return summary;
}

async function main() {
  const datasetManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (datasetManifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('build mismatch', datasetManifest.build_id);
    process.exit(2);
  }

  const prior = JSON.parse(fs.readFileSync(PRIOR_SUMMARY, 'utf8'));
  const presentIds = [...new Set(prior.REPLAY_EVIDENCE_PRESENT_IDS || [])].sort();
  const missingIds = [...new Set(prior.REPLAY_EVIDENCE_MISSING_IDS || [])].sort();
  const allCases = loadCases();
  const byId = new Map(allCases.map((c) => [c.caseId, c]));
  const allIds = allCases.map((c) => c.caseId).sort();

  const inter = presentIds.filter((id) => missingIds.includes(id));
  const union = new Set([...presentIds, ...missingIds]);
  const setValid =
    presentIds.length === 8 &&
    missingIds.length === 192 &&
    inter.length === 0 &&
    union.size === 200 &&
    allIds.every((id) => union.has(id)) &&
    [...union].every((id) => byId.has(id)) &&
    EXISTING_VALID_IDS.every((id) => presentIds.includes(id))
      ? 'PASS'
      : 'FAIL';

  console.log(JSON.stringify({ CAPTURE_TARGET_SET_VALID: setValid, present: presentIds.length, missing: missingIds.length }, null, 2));
  if (setValid !== 'PASS') {
    console.error('STOP: capture target set invalid');
    process.exit(4);
  }

  // Validate existing 8 (KEEP unless contract violation)
  const existingEntries = [];
  for (const id of EXISTING_VALID_IDS) {
    const caseRow = byId.get(id);
    const evPath = path.join(EXISTING_DIR, `${id}.evidence.json`);
    if (!fs.existsSync(evPath)) {
      existingEntries.push({
        caseId: id,
        evidenceStatus: 'FAIL',
        sourceCaptureBatch: EXISTING_BATCH,
        evidenceFile: null,
        rawPresent: false,
        segmentsPresent: false,
        toneEvidencePresent: false,
        caseIdentityMatch: 'FAIL',
        audioIdentityMatch: 'FAIL',
        captureFailureReason: 'TONE_EVIDENCE_NOT_PERSISTED',
        reusedExisting: false,
        attempted: false,
      });
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(evPath, 'utf8'));
    const v = validateEvidencePackage(evidence, caseRow);
    const rel = path.relative(REPO, evPath).replace(/\\/g, '/');
    existingEntries.push({
      caseId: id,
      evidenceStatus: v.pass ? 'PASS' : 'FAIL',
      captureOutcome: v.captureOutcome,
      runtimeClass: v.runtimeClass,
      toneStatus: v.toneStatus,
      model2Eligibility: v.model2Eligibility,
      sourceCaptureBatch: EXISTING_BATCH,
      evidenceFile: rel,
      rawPresent: v.rawPresent,
      segmentsPresent: v.segmentsPresent,
      toneEvidencePresent: v.toneEvidencePresent,
      caseIdentityMatch: v.caseIdentityMatch,
      audioIdentityMatch: v.audioIdentityMatch,
      captureFailureReason: v.pass ? null : v.failureReason,
      toneSliceCount: v.toneSliceCount,
      reusedExisting: v.pass,
      attempted: false,
    });
  }

  const existingInvalid = existingEntries.filter((e) => e.evidenceStatus !== 'PASS');
  if (existingInvalid.length) {
    console.error('EXISTING_CAPTURE_INVALID', existingInvalid.map((e) => e.caseId));
  } else {
    console.log('[existing] KEEP 8/8 PASS');
  }

  // Resolve / create new capture batch
  let captureBatchId = BATCH_ID_OVERRIDE;
  if (!captureBatchId) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', 'T');
    captureBatchId = `tonecap_pilot200_full_${stamp.slice(0, 13)}`;
  }
  // Prefer resume into latest incomplete batch if --resume and no override
  const capturesRoot = path.join(DATASET_DIR, 'tone_evidence_captures');
  if (RESUME && !BATCH_ID_OVERRIDE) {
    const dirs = fs
      .readdirSync(capturesRoot)
      .filter((d) => d.startsWith('tonecap_pilot200_full_'))
      .sort();
    if (dirs.length) captureBatchId = dirs[dirs.length - 1];
  }
  const captureDir = path.join(capturesRoot, captureBatchId);
  fs.mkdirSync(captureDir, { recursive: true });
  const progressPath = path.join(captureDir, 'captures.jsonl');

  const alreadyOk = new Set();
  const newResults = [];
  // Scan existing evidence files from captureDir
  for (const id of missingIds) {
    const evPath = path.join(captureDir, `${id}.evidence.json`);
    if (!fs.existsSync(evPath)) continue;
    const caseRow = byId.get(id);
    if (!caseRow) continue;
    try {
      const evidence = JSON.parse(fs.readFileSync(evPath, 'utf8'));
      const v = validateEvidencePackage(evidence, caseRow);
      const rel = path.relative(REPO, evPath).replace(/\\/g, '/');
      newResults.push({
        caseId: id,
        evidenceStatus: v.pass ? 'PASS' : 'FAIL',
        captureOutcome: v.captureOutcome,
        runtimeClass: v.runtimeClass,
        toneStatus: v.toneStatus,
        model2Eligibility: v.model2Eligibility,
        sourceCaptureBatch: captureBatchId,
        evidenceFile: rel,
        rawPresent: v.rawPresent,
        segmentsPresent: v.segmentsPresent,
        toneEvidencePresent: v.toneEvidencePresent,
        caseIdentityMatch: v.caseIdentityMatch,
        audioIdentityMatch: v.audioIdentityMatch,
        captureFailureReason: v.pass ? null : v.failureReason,
        toneSliceCount: v.toneSliceCount,
        reusedExisting: false,
        attempted: true,
      });
      if (v.pass) {
        alreadyOk.add(id);
      }
    } catch (_) {}
  }

  let targets = missingIds.map((id) => byId.get(id)).filter(Boolean);
  // If an existing capture became invalid, include it for re-capture into new batch
  for (const inv of existingInvalid) {
    if (!targets.find((t) => t.caseId === inv.caseId)) targets.push(byId.get(inv.caseId));
  }
  targets = targets.filter((c) => !alreadyOk.has(c.caseId));
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);

  console.log(
    JSON.stringify(
      {
        captureBatchId,
        toCapture: targets.length,
        resumeSkipped: alreadyOk.size,
        validateOnly: VALIDATE_ONLY,
      },
      null,
      2
    )
  );

  if (VALIDATE_ONLY) {
    const summary = writeArtifacts({
      captureBatchId,
      captureDir,
      allCases,
      byId,
      existingEntries,
      newResults,
      targetMissingIds: missingIds,
      setValid,
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const port = getTestServerPort();
  if (!SKIP_START) {
    console.log('[start] electron…');
    const st = await startElectron();
    console.log('[start]', st.pid);
  }
  const healthy = await waitTestServerHealth(port, SKIP_START ? 30000 : 180000);
  if (!healthy) {
    console.error('health failed');
    process.exit(3);
  }

  const warmPreferred = path.join(DATASET_DIR, 'audio', 'p2_u001_025.wav');
  const warmFallback = path.join(
    DATASET_DIR,
    (targets[0] || byId.get(missingIds[0])).audioPath
  );
  const warmupWav = fs.existsSync(warmPreferred) ? warmPreferred : warmFallback;
  console.log('[asr-ready] warmup…', warmupWav);
  const asr = await waitAsrReady(port, {
    warmupWavPath: warmupWav,
    maxWaitMs: 600000,
    pollMs: 5000,
    label: 'pilot200-full-tone-capture',
  });
  if (!asr.ready) {
    console.error('ASR warmup failed:', asr.lastError || asr);
    process.exit(3);
  }
  console.log('[asr-ready] ok', { attempt: asr.attempt, elapsedMs: asr.elapsedMs });

  const progressFh = fs.createWriteStream(progressPath, { flags: RESUME ? 'a' : 'w' });

  let i = 0;
  for (const caseRow of targets) {
    i += 1;
    process.stdout.write(`[capture ${i}/${targets.length}] ${caseRow.caseId}\n`);
    let evidence = null;
    let lastErr = null;
    let failReason = 'UNKNOWN';
    for (let a = 0; a < 2; a++) {
      try {
        evidence = await captureOne(port, caseRow, captureBatchId);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        failReason = e?.captureFailureReason || classifyCaptureError(lastErr);
        await wait(2000);
      }
    }

    if (!evidence) {
      const row = {
        caseId: caseRow.caseId,
        status: 'CAPTURE_FAILED',
        error: lastErr,
        captureFailureReason: failReason,
        captureBatchId,
      };
      progressFh.write(JSON.stringify(row) + '\n');
      newResults.push({
        caseId: caseRow.caseId,
        evidenceStatus: 'FAIL',
        sourceCaptureBatch: captureBatchId,
        evidenceFile: null,
        rawPresent: false,
        segmentsPresent: false,
        toneEvidencePresent: false,
        caseIdentityMatch: 'PASS',
        audioIdentityMatch: 'PASS',
        captureFailureReason: failReason,
        reusedExisting: false,
        attempted: true,
      });
      continue;
    }

    const v = validateEvidencePackage(evidence, caseRow);
    if (!v.pass) {
      evidence.status = 'CAPTURE_INVALID';
      evidence.captureOutcome = v.captureOutcome;
      evidence.runtimeClass = v.runtimeClass;
      evidence.toneStatus = v.toneStatus;
      evidence.model2Eligibility = v.model2Eligibility;
      evidence.captureFailureReason = v.failureReason;
      progressFh.write(JSON.stringify(evidence) + '\n');
      const evPath = path.join(captureDir, `${caseRow.caseId}.evidence.json`);
      fs.writeFileSync(evPath, JSON.stringify(evidence, null, 2));
      newResults.push({
        caseId: caseRow.caseId,
        evidenceStatus: 'FAIL',
        captureOutcome: v.captureOutcome,
        runtimeClass: v.runtimeClass,
        toneStatus: v.toneStatus,
        model2Eligibility: v.model2Eligibility,
        sourceCaptureBatch: captureBatchId,
        evidenceFile: path.relative(REPO, evPath).replace(/\\/g, '/'),
        rawPresent: v.rawPresent,
        segmentsPresent: v.segmentsPresent,
        toneEvidencePresent: v.toneEvidencePresent,
        caseIdentityMatch: v.caseIdentityMatch,
        audioIdentityMatch: v.audioIdentityMatch,
        captureFailureReason: v.failureReason,
        toneSliceCount: v.toneSliceCount,
        reusedExisting: false,
        attempted: true,
      });
      continue;
    }

    evidence.status = v.captureOutcome === 'ASR_EMPTY' ? 'OK_EMPTY_ASR' : 'OK';
    evidence.captureOutcome = v.captureOutcome;
    evidence.runtimeClass = v.runtimeClass;
    evidence.toneStatus = v.toneStatus;
    evidence.model2Eligibility = v.model2Eligibility;
    evidence.captureFailureReason = null;
    if (v.captureOutcome === 'ASR_EMPTY') {
      evidence.toneSkippedReason = 'ASR_EMPTY';
    }

    const evPath = path.join(captureDir, `${caseRow.caseId}.evidence.json`);
    try {
      fs.writeFileSync(evPath, JSON.stringify(evidence, null, 2));
    } catch (e) {
      newResults.push({
        caseId: caseRow.caseId,
        evidenceStatus: 'FAIL',
        captureOutcome: v.captureOutcome,
        runtimeClass: v.runtimeClass,
        toneStatus: v.toneStatus,
        model2Eligibility: v.model2Eligibility,
        sourceCaptureBatch: captureBatchId,
        evidenceFile: null,
        rawPresent: v.rawPresent,
        segmentsPresent: v.segmentsPresent,
        toneEvidencePresent: v.toneEvidencePresent,
        caseIdentityMatch: 'PASS',
        audioIdentityMatch: 'PASS',
        captureFailureReason: 'OUTPUT_WRITE_FAIL',
        reusedExisting: false,
        attempted: true,
      });
      continue;
    }
    progressFh.write(JSON.stringify(evidence) + '\n');
    newResults.push({
      caseId: caseRow.caseId,
      evidenceStatus: 'PASS',
      captureOutcome: v.captureOutcome,
      runtimeClass: v.runtimeClass,
      toneStatus: v.toneStatus,
      model2Eligibility: v.model2Eligibility,
      sourceCaptureBatch: captureBatchId,
      evidenceFile: path.relative(REPO, evPath).replace(/\\/g, '/'),
      rawPresent: v.rawPresent,
      segmentsPresent: v.segmentsPresent,
      toneEvidencePresent: v.toneEvidencePresent,
      caseIdentityMatch: 'PASS',
      audioIdentityMatch: 'PASS',
      captureFailureReason: null,
      toneSliceCount: v.toneSliceCount,
      reusedExisting: false,
      attempted: true,
    });
  }

  progressFh.end();

  // Merge any previously resumed OK rows already in newResults; ensure all missing covered
  const got = new Set(newResults.map((r) => r.caseId));
  for (const id of missingIds) {
    if (got.has(id)) continue;
    // may still be in alreadyOk from earlier resume seed path miss
    const evPath = path.join(captureDir, `${id}.evidence.json`);
    if (fs.existsSync(evPath)) {
      const evidence = JSON.parse(fs.readFileSync(evPath, 'utf8'));
      const caseRow = byId.get(id);
      const v = validateEvidencePackage(evidence, caseRow);
      newResults.push({
        caseId: id,
        evidenceStatus: v.pass ? 'PASS' : 'FAIL',
        captureOutcome: v.captureOutcome,
        runtimeClass: v.runtimeClass,
        toneStatus: v.toneStatus,
        model2Eligibility: v.model2Eligibility,
        sourceCaptureBatch: captureBatchId,
        evidenceFile: path.relative(REPO, evPath).replace(/\\/g, '/'),
        rawPresent: v.rawPresent,
        segmentsPresent: v.segmentsPresent,
        toneEvidencePresent: v.toneEvidencePresent,
        caseIdentityMatch: v.caseIdentityMatch,
        audioIdentityMatch: v.audioIdentityMatch,
        captureFailureReason: v.pass ? null : v.failureReason,
        toneSliceCount: v.toneSliceCount,
        reusedExisting: false,
        attempted: true,
      });
    } else {
      newResults.push({
        caseId: id,
        evidenceStatus: 'FAIL',
        sourceCaptureBatch: captureBatchId,
        evidenceFile: null,
        rawPresent: false,
        segmentsPresent: false,
        toneEvidencePresent: false,
        caseIdentityMatch: 'PASS',
        audioIdentityMatch: 'PASS',
        captureFailureReason: 'UNKNOWN',
        reusedExisting: false,
        attempted: false,
      });
    }
  }

  const summary = writeArtifacts({
    captureBatchId,
    captureDir,
    allCases,
    byId,
    existingEntries,
    newResults,
    targetMissingIds: missingIds,
    setValid,
  });

  console.log(
    JSON.stringify(
      {
        EVIDENCE_COMPLETE: summary.EVIDENCE_COMPLETE,
        FINAL_VALID: summary.FINAL_VALID_EVIDENCE_COUNT,
        FINAL_MISSING: summary.FINAL_MISSING_EVIDENCE_COUNT,
        ONE_NEXT_OWNER: summary.ONE_NEXT_OWNER,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
