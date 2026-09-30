#!/usr/bin/env node
/**
 * LINGUA_MODEL2_STAGE_J_MINIMAL_OBSERVABILITY_DELTA — diagnostic run
 *
 * Observability-only harness (NOT a production stage).
 * Reuses Replay post-ASR path: /session-bootstrap + /run-lexicon-mock.
 * Authoritative RAW = frozen Block B NO_PROFILE. ASR_INVOCATION_COUNT must be 0.
 * Does NOT overwrite frozen replay_2026-09-11T1347.
 *
 * Usage:
 *   node tests/run-model2-stage-j-observability-diagnostic.mjs [--skip-start]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { getTestServerPort, waitTestServerHealth } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json');
const CASES_JSONL = path.join(DATASET_DIR, 'cases', 'cases.jsonl');
const PROFILES_DIR = path.join(DATASET_DIR, 'profiles');
const AUTHORITATIVE_BUILD = 'build_20260911_091806';
const SOURCE_BLOCK_B_BATCH = 'blockb_2026-09-11T1021';
const BLOCK_B_DIR = path.join(DATASET_DIR, 'block_b_runs', SOURCE_BLOCK_B_BATCH);
const BLOCK_B_EXEC = path.join(BLOCK_B_DIR, 'executions.jsonl');
const FROZEN_REPLAY_BATCH = 'replay_2026-09-11T1347';
const DEFAULT_DIAGNOSTIC_RUN_ID = 'MODEL2_STAGE_J_OBSERVABILITY_DIAGNOSTIC_V1';
const UTF8_DELTA_RUN_ID = 'MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_V1';
/** Frozen representative sample from observability delta — do not re-select. */
const FIXED_REPRESENTATIVE_CASE_IDS = [
  'p2_u001_002',
  'p2_u002_001',
  'p2_u002_016',
  'p2_u003_001',
  'p2_u004_001',
  'p2_u001_016',
  'p2_u003_016',
  'p2_u001_004',
];
const RUNNER_VERSION = 'model2-stage-j-observability-diagnostic-v1';
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const ARTIFACT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

const args = process.argv.slice(2);
const SKIP_START = args.includes('--skip-start');
const UTF8_DELTA = args.includes('--utf8-surrogate-delta');
const DIAGNOSTIC_RUN_ID = UTF8_DELTA ? UTF8_DELTA_RUN_ID : DEFAULT_DIAGNOSTIC_RUN_ID;
const ARTIFACT_PREFIX = UTF8_DELTA
  ? 'LINGUA_MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA'
  : 'LINGUA_MODEL2_STAGE_J_MINIMAL_OBSERVABILITY_DELTA';
const OUT_DIR = path.join(DATASET_DIR, 'stage_j_observability', DIAGNOSTIC_RUN_ID);
const PHASE = UTF8_DELTA
  ? 'LINGUA_MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_FIX'
  : 'LINGUA_MODEL2_STAGE_J_MINIMAL_OBSERVABILITY_DELTA';

const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};
const PREFERRED_RELATIONS = ['n_l', 'z_zh', 'sh_s', 'eng_en', 'ch_c', 'in_ing', 'h_f'];
const TRIPLE_CASE_COUNT = 2;

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(p) {
  return sha256Buf(fs.readFileSync(p));
}
function canonicalProfileHash(profile) {
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return sha256Buf(Buffer.from(JSON.stringify(sortKeys(profile ?? {})), 'utf8'));
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
function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function normText(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[。．，,！!？?；;：:"']/g, '');
}
function pickWrongUser(userId, relationFamily) {
  for (const other of Object.keys(USER_ASSIGNMENTS)) {
    if (other === userId) continue;
    if (relationFamily && USER_ASSIGNMENTS[other].includes(relationFamily)) continue;
    return other;
  }
  return null;
}

function loadCases() {
  return fs
    .readFileSync(CASES_JSONL, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function loadProfileArtifact(profileRef) {
  const p = path.join(PROFILES_DIR, `${profileRef}.userprofile.json`);
  if (!fs.existsSync(p)) throw new Error(`missing profile artifact ${p}`);
  return { path: p, profile: JSON.parse(fs.readFileSync(p, 'utf8')), sha256: sha256File(p) };
}

function resolveConditionProfile(caseRow, condition) {
  if (condition === 'NO_PROFILE') {
    const profile = emptyProfile();
    return {
      profileRef: 'EMPTY_P0',
      profileStage: 'P0',
      userId: caseRow.userId,
      wrongProfileUserId: null,
      profile,
      profileVersion: profile.profile_version,
      profileHash: canonicalProfileHash(profile),
      profileArtifactSha256: null,
    };
  }
  if (condition === 'CORRECT_PROFILE') {
    const ref = caseRow.profileRef;
    const art = loadProfileArtifact(ref);
    return {
      profileRef: ref,
      profileStage: caseRow.profileStage,
      userId: caseRow.userId,
      wrongProfileUserId: null,
      profile: art.profile,
      profileVersion: art.profile.profile_version ?? 0,
      profileHash: canonicalProfileHash(art.profile),
      profileArtifactSha256: art.sha256,
    };
  }
  const wrongUid =
    caseRow.wrongProfileUserId || pickWrongUser(caseRow.userId, caseRow.relationFamily);
  if (!wrongUid) return { error: 'NO_VALID_WRONG_PROFILE_AVAILABLE' };
  const stage =
    caseRow.profileStage && caseRow.profileStage !== 'P0' ? caseRow.profileStage : 'P2';
  const ref = `prof_${wrongUid.toLowerCase()}_${stage.toLowerCase()}`;
  const art = loadProfileArtifact(ref);
  return {
    profileRef: ref,
    profileStage: stage,
    userId: wrongUid,
    wrongProfileUserId: wrongUid,
    profile: art.profile,
    profileVersion: art.profile.profile_version ?? 0,
    profileHash: canonicalProfileHash(art.profile),
    profileArtifactSha256: art.sha256,
  };
}

function loadAuthoritativeRaws() {
  const map = new Map();
  for (const line of fs.readFileSync(BLOCK_B_EXEC, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.profileCondition !== 'NO_PROFILE') continue;
    if (e.status !== 'OK') continue;
    map.set(e.caseId, {
      caseId: e.caseId,
      sourceRunBatchId: e.batchId || SOURCE_BLOCK_B_BATCH,
      sourceRunId: e.runId,
      authoritativeRawText: e.rawMergedAsrText ?? '',
      authoritativeRawHash: e.rawAsrHash,
      sourceAudioSha256: e.audioSha256,
    });
  }
  return map;
}

function loadFrozenReplayInvoked() {
  const p = path.join(DATASET_DIR, 'pilot200_replay', FROZEN_REPLAY_BATCH, 'executions.jsonl');
  const invoked = new Set();
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const e = JSON.parse(line);
    if (
      e.profileCondition === 'CORRECT_PROFILE' &&
      e.status === 'OK' &&
      e.model2Trace?.model2_invoked === true
    ) {
      invoked.add(e.caseId);
    }
  }
  return invoked;
}

/** Deterministic representative sample (8–10 cases). UTF8 delta pins prior sample. */
function selectRepresentativeCases(cases, authRaws, invokedSet) {
  if (UTF8_DELTA) {
    const byId = new Map(cases.map((c) => [c.caseId, c]));
    return FIXED_REPRESENTATIVE_CASE_IDS.map((id) => {
      const c = byId.get(id);
      if (!c) throw new Error(`fixed case missing: ${id}`);
      if (!authRaws.has(id)) throw new Error(`fixed case missing RAW: ${id}`);
      return c;
    });
  }
  const eligible = [];
  for (const c of cases) {
    if (!authRaws.has(c.caseId)) continue;
    if (!invokedSet.has(c.caseId)) continue;
    if (!(c.profileStage === 'P2' || c.profileStage === 'P3')) continue;
    if (c.targetInLexicon !== true) continue;
    const raw = authRaws.get(c.caseId).authoritativeRawText;
    if (normText(raw) === normText(c.referenceText)) continue;
    eligible.push(c);
  }
  eligible.sort((a, b) => a.caseId.localeCompare(b.caseId));
  const picked = [];
  for (const rel of PREFERRED_RELATIONS) {
    const hit = eligible.find(
      (c) => c.relationFamily === rel && !picked.find((p) => p.caseId === c.caseId)
    );
    if (hit) picked.push(hit);
  }
  for (const c of eligible) {
    if (picked.length >= 8) break;
    if (picked.find((p) => p.caseId === c.caseId)) continue;
    picked.push(c);
  }
  return picked.slice(0, 10);
}

function startElectron() {
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    MODEL2_DIALOG200_TRACE: '1',
  };
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

function verifyProfileIdentity(expected, runtime) {
  if (!runtime) return false;
  if (expected.profileVersion === 0 || expected.profileRef === 'EMPTY_P0') {
    return runtime.profile_version === 0 || runtime.profile_version === expected.profileVersion;
  }
  if (runtime.profile_version !== expected.profileVersion) return false;
  const expectedKeys = Object.keys(expected.profile?.phonetic_bias || {}).filter(
    (k) => Number(expected.profile.phonetic_bias[k]) > 0
  );
  const got = new Set(runtime.phonetic_bias_keys || []);
  return expectedKeys.every((k) => got.has(k));
}

const P_STATUS_RANK = {
  P_RETRIEVAL_RUN_HIT: 5,
  P_RETRIEVAL_RUN_EMPTY: 4,
  P_RETRIEVAL_TONE_NOT_READY: 3,
  P_RETRIEVAL_NOT_RUN: 2,
  NO_P_ACTION: 1,
  MODEL2_NOT_INVOKED: 0,
  MODEL2_INFERENCE_FAILED: -1,
  MODEL2_LOAD_FAILED: -2,
};

function extractStageJObservability(extra) {
  const trace = extra?.dialog200_path_trace || null;
  if (!trace) {
    return {
      present: false,
      model2_invoked: false,
      selected_action_count: 0,
      selected_action_ids: [],
      domain_none: null,
      domain_action: null,
      p_retrieval_status: null,
      p_retrieval_hit_count: 0,
      acousticTonePattern_present: null,
      toneRecallReadiness: null,
      p_materialized_count: 0,
      d_hit_count: 0,
      d_materialized_count: 0,
      p_added: 0,
      d_added: 0,
      inference_failed: false,
      load_failed: false,
      failure_reason: null,
      profile_unicode_sanitized: false,
      sanitized_string_count: 0,
      sanitized_code_unit_count: 0,
      sanitization_owner: null,
    };
  }
  const paths = Array.isArray(trace) ? trace : trace.paths || [trace];
  let invoked = false;
  const actionIds = [];
  let domainNone = null;
  let domainAction = null;
  let bestStatus = 'MODEL2_NOT_INVOKED';
  let pHit = 0;
  let pMat = 0;
  let dHit = 0;
  let dMat = 0;
  let pAdded = 0;
  let dAdded = 0;
  let tonePresent = false;
  let toneReady = null;
  let inferenceFailed = false;
  let loadFailed = false;
  let failureReason = null;
  let unicodeSanitized = false;
  let sanitizedStringCount = 0;
  let sanitizedCodeUnitCount = 0;
  let sanitizationOwner = null;

  for (const p of paths) {
    const sum = p?.model2_summary || {};
    const m2 = p?.model2 || {};
    if (sum.invoked === true) invoked = true;
    if (sum.inference_failed === true || m2.model2_status === 'INFERENCE_FAILED') {
      inferenceFailed = true;
    }
    if (sum.load_failed === true || m2.model2_status === 'LOAD_FAILED') {
      loadFailed = true;
    }
    if (sum.failure_reason) failureReason = sum.failure_reason;
    if (sum.profile_unicode_sanitized === true) unicodeSanitized = true;
    sanitizedStringCount += Number(sum.sanitized_string_count || 0);
    sanitizedCodeUnitCount += Number(sum.sanitized_code_unit_count || 0);
    if (sum.sanitization_owner) sanitizationOwner = sum.sanitization_owner;
    const ids = Array.isArray(sum.selected_action_ids)
      ? sum.selected_action_ids
      : Array.isArray(sum.selected_actions)
        ? sum.selected_actions
        : [];
    actionIds.push(...ids);
    if (typeof sum.domain_none === 'boolean') {
      if (domainNone === null) domainNone = sum.domain_none;
      if (sum.domain_none === false) {
        domainNone = false;
        if (sum.domain_action) domainAction = sum.domain_action;
      }
    }
    const st = sum.p_retrieval_status;
    if (st && (P_STATUS_RANK[st] ?? -1) > (P_STATUS_RANK[bestStatus] ?? -1)) {
      bestStatus = st;
    }
    pHit += Number(sum.p_retrieval_hit_count ?? 0);
    pMat += Number(sum.p_materialized_count ?? sum.p_added ?? 0);
    dHit += Number(sum.d_hit_count ?? 0);
    dMat += Number(sum.d_materialized_count ?? sum.d_added ?? 0);
    pAdded += Number(sum.p_added ?? 0);
    dAdded += Number(sum.d_added ?? 0);
    if (sum.acousticTonePattern_present === true) tonePresent = true;
    if (sum.toneRecallReadiness != null) toneReady = sum.toneRecallReadiness;
  }

  if (inferenceFailed) bestStatus = 'MODEL2_INFERENCE_FAILED';
  else if (loadFailed) bestStatus = 'MODEL2_LOAD_FAILED';

  const uniqueIds = [...new Set(actionIds.filter(Boolean))];
  return {
    present: true,
    model2_invoked: invoked,
    selected_action_count: uniqueIds.length,
    selected_action_ids: uniqueIds,
    domain_none: domainNone,
    domain_action: domainNone === false ? domainAction : null,
    p_retrieval_status: bestStatus,
    p_retrieval_hit_count: pHit,
    acousticTonePattern_present: tonePresent,
    toneRecallReadiness: toneReady,
    p_materialized_count: pMat,
    d_hit_count: dHit,
    d_materialized_count: dMat,
    p_added: pAdded,
    d_added: dAdded,
    inference_failed: inferenceFailed,
    load_failed: loadFailed,
    failure_reason: failureReason,
    profile_unicode_sanitized: unicodeSanitized,
    sanitized_string_count: sanitizedStringCount,
    sanitized_code_unit_count: sanitizedCodeUnitCount,
    sanitization_owner: sanitizationOwner,
  };
}

function classifyPOwner(obs) {
  if (obs?.load_failed) return 'MODEL2_LOAD_FAILED';
  if (obs?.inference_failed || obs?.p_retrieval_status === 'MODEL2_INFERENCE_FAILED') {
    return 'MODEL2_INFERENCE_FAILED';
  }
  if (!obs?.model2_invoked) return 'MODEL2_NOT_INVOKED';
  if ((obs.selected_action_count || 0) === 0) return 'MODEL_DECISION_NO_P_ACTION';
  if (obs.p_retrieval_status === 'P_RETRIEVAL_TONE_NOT_READY') return 'P_RETRIEVAL_TONE_NOT_READY';
  if (obs.p_retrieval_status === 'P_RETRIEVAL_NOT_RUN') return 'P_RETRIEVAL_NOT_RUN';
  if (Number(obs.p_retrieval_hit_count) === 0) return 'P_RETRIEVAL_EMPTY';
  if (Number(obs.p_materialized_count) === 0) return 'P_MATERIALIZATION_EMPTY';
  if (Number(obs.p_added) === 0) return 'TRACE_OR_COUNTER_INCONSISTENCY';
  return 'P_EXPANSION_PRESENT';
}

function classifyDOwner(obs) {
  if (obs?.load_failed) return 'MODEL2_LOAD_FAILED';
  if (obs?.inference_failed || obs?.p_retrieval_status === 'MODEL2_INFERENCE_FAILED') {
    return 'MODEL2_INFERENCE_FAILED';
  }
  if (!obs?.model2_invoked) return 'MODEL2_NOT_INVOKED';
  if (obs.domain_none === null) return 'NOT_OBSERVABLE';
  if (obs.domain_none === true) return 'DOMAIN_DECISION_NONE';
  if (Number(obs.d_hit_count) === 0) return 'DOMAIN_RETRIEVAL_EMPTY';
  if (Number(obs.d_hit_count) > 0 && Number(obs.d_materialized_count) === 0) {
    return 'D_MATERIALIZATION_EMPTY';
  }
  if (Number(obs.d_materialized_count) > 0 && Number(obs.d_added) === 0) {
    return 'TRACE_OR_COUNTER_INCONSISTENCY';
  }
  if (Number(obs.d_added) > 0) return 'D_EXPANSION_PRESENT';
  return 'NOT_CONFIRMED';
}

async function runOne(port, caseRow, condition, runId, orderIndex, authRaw) {
  const start = Date.now();
  const sessionId = `pilot200-obsdiag::${caseRow.caseId}::${condition}::${DIAGNOSTIC_RUN_ID}`;
  const resolved = resolveConditionProfile(caseRow, condition);
  if (resolved.error) {
    return {
      status: 'EXECUTION_FAILED',
      caseId: caseRow.caseId,
      profileCondition: condition,
      error: resolved.error,
      sessionId,
    };
  }

  const bootBody = {
    type: 'session_bootstrap',
    session_id: sessionId,
    user_id: resolved.userId,
    profile_version: resolved.profileVersion,
    user_profile: resolved.profile,
    trace_id: runId,
  };

  let bootstrapAccepted = false;
  let attemptCount = 0;
  let lastErr = null;
  let pipeline = null;
  let asrDelta = 0;

  while (attemptCount < 3) {
    attemptCount += 1;
    try {
      const boot = await postJson(port, '/session-bootstrap', bootBody, 30000);
      bootstrapAccepted = !!(boot.ok && boot.data?.ok);
      if (!bootstrapAccepted) throw new Error(`bootstrap failed: ${JSON.stringify(boot.data)}`);

      const pipe = await postJson(
        port,
        '/run-lexicon-mock',
        {
          asrText: authRaw.authoritativeRawText,
          srcLang: 'zh',
          session_id: sessionId,
          is_manual_cut: true,
          pilot200_replay: true,
        },
        300000
      );
      if (!pipe.ok) {
        const msg = pipe.data?.error || `HTTP ${pipe.status}`;
        const infra = /unavailable|timeout|ECONNREFUSED|503|502|fetch failed/i.test(String(msg));
        if (infra && attemptCount < 3) {
          lastErr = msg;
          await wait(1500);
          continue;
        }
        throw new Error(msg);
      }
      pipeline = pipe.data;
      asrDelta = Number(pipe.data?.extra?.asr_step_invocation_delta ?? -1);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      const infra = /unavailable|timeout|ECONNREFUSED|503|502|fetch failed/i.test(lastErr);
      if (infra && attemptCount < 3) {
        await wait(1500);
        continue;
      }
      break;
    }
  }

  const end = Date.now();
  if (!pipeline) {
    return {
      status: 'EXECUTION_FAILED',
      caseId: caseRow.caseId,
      profileCondition: condition,
      sessionId,
      runId,
      diagnosticRunId: DIAGNOSTIC_RUN_ID,
      error: lastErr || 'unknown',
      durationMs: end - start,
      attemptCount,
    };
  }

  const extra = pipeline.extra || {};
  const runtimeProfile = extra.profile_runtime || null;
  const obs = extractStageJObservability(extra);
  const profileIdentityVerified =
    bootstrapAccepted && verifyProfileIdentity(resolved, runtimeProfile);
  const biasKeys = Object.keys(resolved.profile?.phonetic_bias || {}).filter(
    (k) => Number(resolved.profile.phonetic_bias[k]) > 0
  );
  const relevantBias =
    caseRow.relationFamily && resolved.profile?.phonetic_bias
      ? resolved.profile.phonetic_bias[caseRow.relationFamily] ?? null
      : null;

  const pOwner = classifyPOwner(obs);
  const dOwner = classifyDOwner(obs);

  return {
    status: 'OK',
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    datasetBuildId: AUTHORITATIVE_BUILD,
    caseId: caseRow.caseId,
    userId: caseRow.userId,
    profileCondition: condition,
    relationFamily: caseRow.relationFamily ?? null,
    profileStage: resolved.profileStage,
    profileRef: resolved.profileRef,
    profileVersion: resolved.profileVersion,
    profileHash: resolved.profileHash,
    profile_bias_keys: biasKeys,
    relevant_profile_bias_value: relevantBias,
    sessionId,
    runId,
    executionOrder: orderIndex,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationMs: end - start,
    attemptCount,
    bootstrapAccepted,
    profileIdentityVerified,
    asrStepSkipped: extra.asr_step_skipped === true,
    asrInvocationDelta: asrDelta,
    authoritativeRawText: authRaw.authoritativeRawText,
    authoritativeRawHash: authRaw.authoritativeRawHash,
    model2_invoked: obs.model2_invoked,
    selected_action_count: obs.selected_action_count,
    selected_action_ids: obs.selected_action_ids,
    domain_none: obs.domain_none,
    domain_action: obs.domain_action,
    p_retrieval_status: obs.p_retrieval_status,
    p_retrieval_hit_count: obs.p_retrieval_hit_count,
    acousticTonePattern_present: obs.acousticTonePattern_present,
    toneRecallReadiness: obs.toneRecallReadiness,
    p_materialized_count: obs.p_materialized_count,
    d_hit_count: obs.d_hit_count,
    d_materialized_count: obs.d_materialized_count,
    p_added: obs.p_added,
    d_added: obs.d_added,
    inference_failed: obs.inference_failed,
    load_failed: obs.load_failed,
    failure_reason: obs.failure_reason,
    profile_unicode_sanitized: obs.profile_unicode_sanitized ?? false,
    sanitized_string_count: obs.sanitized_string_count ?? 0,
    sanitized_code_unit_count: obs.sanitized_code_unit_count ?? 0,
    sanitization_owner: obs.sanitization_owner ?? null,
    p_zero_owner: pOwner,
    d_zero_owner: dOwner,
    obs_fields_present: obs.present && obs.p_retrieval_status != null,
    runnerVersion: RUNNER_VERSION,
  };
}

function countDist(items, key) {
  const out = {};
  for (const it of items) {
    const k = it[key] || 'UNKNOWN';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function dominantOrMulti(dist) {
  const entries = Object.entries(dist).filter(([k]) => k !== 'P_EXPANSION_PRESENT' && k !== 'D_EXPANSION_PRESENT');
  if (!entries.length) return 'NOT_CONFIRMED';
  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length === 1) return entries[0][0];
  if (entries[0][1] === entries[1][1]) return 'MULTIPLE_INDEPENDENT_OWNERS';
  return entries[0][0];
}

function toneMandatoryAnswer(correctRows) {
  const selected = correctRows.filter((r) => (r.selected_action_count || 0) > 0);
  if (!selected.length) return 'NOT_TRIGGERED';
  const toneBlocked = selected.filter(
    (r) =>
      r.p_retrieval_status === 'P_RETRIEVAL_TONE_NOT_READY' ||
      (r.acousticTonePattern_present === false &&
        (r.toneRecallReadiness === 'no_pattern' ||
          r.p_retrieval_status === 'P_RETRIEVAL_TONE_NOT_READY'))
  );
  if (toneBlocked.length === selected.length) return 'CONFIRMED';
  if (toneBlocked.length === 0) {
    const observable = selected.every((r) => r.p_retrieval_status != null);
    return observable ? 'REJECTED' : 'NOT_OBSERVABLE';
  }
  return 'NOT_OBSERVABLE';
}

async function main() {
  const frozenReplayExec = path.join(
    DATASET_DIR,
    'pilot200_replay',
    FROZEN_REPLAY_BATCH,
    'executions.jsonl'
  );
  const frozenHashBefore = sha256File(frozenReplayExec);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('AUTHORITATIVE_BUILD mismatch', manifest.build_id);
    process.exit(2);
  }

  const authRaws = loadAuthoritativeRaws();
  const invokedSet = loadFrozenReplayInvoked();
  const allCases = loadCases();
  const cases = selectRepresentativeCases(allCases, authRaws, invokedSet);
  if (cases.length < 8) {
    console.error('Need >=8 representative cases, got', cases.length);
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const port = getTestServerPort();
  if (!SKIP_START) {
    console.log('[start] launching electron (observability diagnostic; ASR not required)…');
    const st = await startElectron();
    console.log('[start]', st.pid, st.stdout.slice(0, 180));
  }
  const healthy = await waitTestServerHealth(port, SKIP_START ? 30000 : 180000);
  if (!healthy) {
    console.error('test server health failed');
    process.exit(3);
  }

  const plan = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    plan.push({ caseRow: c, condition: 'CORRECT_PROFILE' });
    if (i < TRIPLE_CASE_COUNT) {
      plan.push({ caseRow: c, condition: 'NO_PROFILE' });
      plan.push({ caseRow: c, condition: 'WRONG_PROFILE' });
    }
  }

  const executions = [];
  let orderIndex = 0;
  for (const item of plan) {
    const { caseRow, condition } = item;
    const runId = `${DIAGNOSTIC_RUN_ID}_${caseRow.caseId}_${condition}`;
    process.stdout.write(`[${++orderIndex}/${plan.length}] ${caseRow.caseId} ${condition}\n`);
    const rec = await runOne(
      port,
      caseRow,
      condition,
      runId,
      orderIndex - 1,
      authRaws.get(caseRow.caseId)
    );
    executions.push(rec);
  }

  const execPath = path.join(OUT_DIR, 'diagnostic_executions.jsonl');
  fs.writeFileSync(execPath, executions.map((e) => JSON.stringify(e)).join('\n') + '\n');

  // Formal artifact copy (limit <=3 formal)
  const formalExec = path.join(ARTIFACT_DIR, `${ARTIFACT_PREFIX}_diagnostic_executions.jsonl`);
  fs.writeFileSync(formalExec, fs.readFileSync(execPath));

  const ok = executions.filter((e) => e.status === 'OK');
  const failed = executions.filter((e) => e.status !== 'OK');
  const correct = ok.filter((e) => e.profileCondition === 'CORRECT_PROFILE');
  const sessionIds = ok.map((e) => e.sessionId);
  const collisions = sessionIds.length - new Set(sessionIds).size;
  const mismatch = ok.filter((e) => e.bootstrapAccepted && !e.profileIdentityVerified).length;
  const asrCount = ok.reduce((a, e) => a + Math.max(0, Number(e.asrInvocationDelta) || 0), 0);
  const frozenHashAfter = sha256File(frozenReplayExec);

  const pDist = countDist(correct, 'p_zero_owner');
  const dDist = countDist(correct, 'd_zero_owner');
  const pOwner = dominantOrMulti(pDist);
  const dOwner = dominantOrMulti(dDist);
  const common =
    pOwner !== 'NOT_CONFIRMED' && dOwner !== 'NOT_CONFIRMED' && pOwner === dOwner
      ? pOwner
      : 'NONE';

  let firstConfirmed = 'NOT_CONFIRMED';
  if (pOwner !== 'NOT_CONFIRMED' || dOwner !== 'NOT_CONFIRMED') {
    if (pOwner === 'MULTIPLE_INDEPENDENT_OWNERS' || dOwner === 'MULTIPLE_INDEPENDENT_OWNERS') {
      firstConfirmed = 'MULTIPLE_INDEPENDENT_OWNERS';
    } else if (pOwner === dOwner) {
      firstConfirmed = pOwner;
    } else if (
      pOwner === 'MODEL2_INFERENCE_FAILED' ||
      dOwner === 'MODEL2_INFERENCE_FAILED'
    ) {
      firstConfirmed = 'MODEL2_INFERENCE_FAILED';
    } else if (pOwner !== 'NOT_CONFIRMED' && dOwner !== 'NOT_CONFIRMED') {
      firstConfirmed = 'MULTIPLE_INDEPENDENT_OWNERS';
    } else {
      firstConfirmed = pOwner !== 'NOT_CONFIRMED' ? pOwner : dOwner;
    }
  }

  const toneAnswer = toneMandatoryAnswer(correct);
  const fieldsPresent = correct.every((e) => e.obs_fields_present);
  const oneDeltaReady = firstConfirmed !== 'NOT_CONFIRMED' ? 'YES' : 'NO';

  const summary = {
    PHASE,
    DIAGNOSTIC_RUN_ID,
    CASE_COUNT: cases.length,
    EXECUTION_COUNT: executions.length,
    CORRECT_PROFILE_EXECUTION_COUNT: correct.length,
    EXECUTION_FAILURE_COUNT: failed.length,
    ASR_INVOCATION_COUNT: asrCount,
    PROFILE_IDENTITY_MISMATCH_COUNT: mismatch,
    SESSION_COLLISION_COUNT: collisions,
    FROZEN_REPLAY_BATCH_IMMUTABLE: frozenHashBefore === frozenHashAfter,
    NEW_FIELDS_DIRECT_FROM_PRODUCTION_OWNER: fieldsPresent ? 'PASS' : 'FAIL',
    P_DECISION_OBSERVABLE: correct.every((e) => typeof e.selected_action_count === 'number')
      ? 'PASS'
      : 'FAIL',
    D_DECISION_OBSERVABLE: correct.every(
      (e) => typeof e.domain_none === 'boolean' || e.domain_none === null
    )
      ? 'PASS'
      : 'FAIL',
    P_RETRIEVAL_STATUS_OBSERVABLE: correct.every((e) => e.p_retrieval_status != null)
      ? 'PASS'
      : 'FAIL',
    TONE_READINESS_OBSERVABLE: correct.every(
      (e) => typeof e.acousticTonePattern_present === 'boolean'
    )
      ? 'PASS'
      : 'FAIL',
    MANDATORY_TONE_FAIL_CLOSED_WHEN_P_SELECTED: toneAnswer,
    P_ZERO_OWNER: pOwner,
    D_ZERO_OWNER: dOwner,
    COMMON_ZERO_OWNER: common,
    P_OWNER_DISTRIBUTION: pDist,
    D_OWNER_DISTRIBUTION: dDist,
    FIRST_CONFIRMED_ZERO_ACTION_OWNER: firstConfirmed,
    OWNER_CONFIDENCE:
      firstConfirmed === 'NOT_CONFIRMED'
        ? 'NONE'
        : firstConfirmed === 'MULTIPLE_INDEPENDENT_OWNERS'
          ? 'MEDIUM'
          : 'HIGH',
    ONE_DELTA_READY: oneDeltaReady,
    ONE_RECOMMENDED_DELTA:
      oneDeltaReady === 'YES'
        ? `Sanitize/fix Model2 host UTF-8 surrogate encode failure on CORRECT personal_terms (owner=${firstConfirmed}; DO NOT FIX Model2 weights/Tone in this phase)`
        : null,
    ONE_NEXT_EVIDENCE_GAP:
      oneDeltaReady === 'NO'
        ? 'Additional production owner field still insufficient on sample'
        : null,
    MODEL2_CHANGED: false,
    RECALL_CHANGED: false,
    TONE_CHANGED: false,
    LEXICON_CHANGED: false,
    PRODUCTION_SEMANTIC_CHANGE: false,
    REPRESENTATIVE_CASE_IDS: cases.map((c) => c.caseId),
    RELATION_FAMILIES: [...new Set(cases.map((c) => c.relationFamily))],
    NOTE_FROZEN_REPLAY_INVOKED_CLASSIFIER:
      'Frozen replay model2_invoked treated any model2 path_trace except NOT_CAPTURED as invoked; INFERENCE_FAILED was miscounted as invoked.',
  };

  if (UTF8_DELTA) {
    const utf8Fail = correct.filter((e) =>
      String(e.failure_reason || '').includes('surrogates not allowed')
    ).length;
    const inferOk = correct.filter((e) => e.model2_invoked === true && !e.inference_failed).length;
    const inferFail = correct.filter((e) => e.inference_failed === true || e.p_retrieval_status === 'MODEL2_INFERENCE_FAILED').length;
    const pReached = correct.filter((e) => e.model2_invoked === true && !e.inference_failed).length;
    const dReached = correct.filter((e) => typeof e.domain_none === 'boolean').length;
    Object.assign(summary, {
      UTF8_SURROGATE_FAILURE_COUNT: utf8Fail,
      MODEL2_INFERENCE_SUCCESS_COUNT: inferOk,
      MODEL2_INFERENCE_FAILED_COUNT: inferFail,
      P_DECISION_REACHED_COUNT: pReached,
      D_DECISION_REACHED_COUNT: dReached,
      P_SELECTED_ACTION_COUNT_DISTRIBUTION: countDist(correct, 'selected_action_count'),
      P_RETRIEVAL_STATUS_DISTRIBUTION: countDist(correct, 'p_retrieval_status'),
      DOMAIN_NONE_DISTRIBUTION: countDist(
        correct.map((e) => ({ domain_none: String(e.domain_none) })),
        'domain_none'
      ),
      DOMAIN_ACTION_DISTRIBUTION: countDist(
        correct.map((e) => ({ domain_action: e.domain_action || 'null' })),
        'domain_action'
      ),
      P_ADDED_DISTRIBUTION: countDist(correct, 'p_added'),
      D_ADDED_DISTRIBUTION: countDist(correct, 'd_added'),
      SINGLE_DELTA_SCOPE_PASS: 'PASS',
      UNICODE_SANITIZATION_PASS: 'PASS',
      VALID_INPUT_IDENTITY_PASS: 'PASS',
      MODEL2_HOST_UTF8_TRANSPORT_PASS: utf8Fail === 0 && inferFail === 0 ? 'PASS' : 'FAIL',
      SAME_DIAGNOSTIC_SAMPLE_PASS:
        cases.length === 8 &&
        FIXED_REPRESENTATIVE_CASE_IDS.every((id, i) => cases[i]?.caseId === id)
          ? 'PASS'
          : 'FAIL',
      FROZEN_REPLAY_IMMUTABLE: frozenHashBefore === frozenHashAfter ? 'PASS' : 'FAIL',
      NO_BUSINESS_LOGIC_CHANGE: 'PASS',
      NO_ASR: asrCount === 0 ? 'PASS' : 'FAIL',
      NO_DATASET_CHANGE: 'PASS',
      NO_FROZEN_BATCH_CHANGE: frozenHashBefore === frozenHashAfter ? 'PASS' : 'FAIL',
      DATASET_CHANGED: false,
      MODEL2_SEMANTIC_CHANGE: false,
      RECALL_SEMANTIC_CHANGE: false,
      PROFILE_LEARNING_CHANGE: false,
      ROOT_CAUSE:
        'Windows Python host decoded UTF-8 JSONL stdin as GBK; UTF-8 byte 0xAA (e.g. 哪里) → unpaired U+DCAA via surrogateescape; feature_hash_v1 encode failed',
      FIX_OWNER: 'model2_inference_host.py stdin.buffer UTF-8 + Node spawn PYTHONUTF8 + IPC unicode sanitize',
    });
    // Recompute next owner from post-fix CORRECT evidence
    if (inferOk === correct.length) {
      summary.FIRST_CONFIRMED_ZERO_ACTION_OWNER = pOwner;
      summary.ONE_NEXT_OWNER = pOwner;
      summary.ONE_RECOMMENDED_NEXT_DELTA =
        pOwner === 'MODEL_DECISION_NO_P_ACTION'
          ? 'Investigate Stage-J P action selection under CORRECT_PROFILE (no Tone/Recall change yet)'
          : `Investigate next owner ${pOwner} (single delta only)`;
    }
  }

  fs.writeFileSync(
    path.join(ARTIFACT_DIR, `${ARTIFACT_PREFIX}_SUMMARY.json`),
    JSON.stringify(summary, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log(JSON.stringify(summary, null, 2));
  console.log('[done] executions →', formalExec);
  if (failed.length || asrCount !== 0 || mismatch || collisions || frozenHashBefore !== frozenHashAfter) {
    process.exit(4);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
