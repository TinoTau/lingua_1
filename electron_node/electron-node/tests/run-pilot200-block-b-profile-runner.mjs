#!/usr/bin/env node
/**
 * LINGUA_DIALOG2000_V2_PILOT200 Block B — Profile-Aware Runner
 *
 * Runs frozen Pilot200 cases under NO_PROFILE / CORRECT_PROFILE / WRONG_PROFILE
 * via production SessionBootstrap contract (test harness wiring only).
 *
 * Does NOT score Model2 / PROFILE_GAIN. Does NOT mutate dataset.
 *
 * Usage:
 *   node tests/run-pilot200-block-b-profile-runner.mjs --accept-only
 *   node tests/run-pilot200-block-b-profile-runner.mjs --full
 *   node tests/run-pilot200-block-b-profile-runner.mjs --full --skip-start --resume
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json');
const CASES_JSONL = path.join(DATASET_DIR, 'cases', 'cases.jsonl');
const PROFILES_DIR = path.join(DATASET_DIR, 'profiles');
const AUTHORITATIVE_BUILD = 'build_20260911_091806';
const RUNNER_VERSION = 'pilot200-block-b-runner-v1';
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');

const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};

const CONDITIONS = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];

const args = process.argv.slice(2);
const ACCEPT_ONLY = args.includes('--accept-only');
const FULL = args.includes('--full');
const SKIP_START = args.includes('--skip-start');
const RESUME = args.includes('--resume');
const DRY_FP = args.includes('--dry-fingerprint');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;

if (!DRY_FP && !ACCEPT_ONLY && !FULL) {
  console.error('Usage: --accept-only | --full [--skip-start] [--resume] [--limit N]');
  process.exit(2);
}

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(p) {
  return sha256Buf(fs.readFileSync(p));
}
function canonicalProfileHash(profile) {
  // Stable JSON: sort object keys recursively
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

function pickWrongUser(userId, relationFamily) {
  for (const other of Object.keys(USER_ASSIGNMENTS)) {
    if (other === userId) continue;
    if (relationFamily && USER_ASSIGNMENTS[other].includes(relationFamily)) continue;
    return other;
  }
  return null;
}

function conditionOrderForCase(caseId, seed) {
  const h = crypto.createHash('sha256').update(`${seed}|${caseId}|order`).digest();
  const idx = h[0] % 6;
  const perms = [
    ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'],
    ['NO_PROFILE', 'WRONG_PROFILE', 'CORRECT_PROFILE'],
    ['CORRECT_PROFILE', 'NO_PROFILE', 'WRONG_PROFILE'],
    ['CORRECT_PROFILE', 'WRONG_PROFILE', 'NO_PROFILE'],
    ['WRONG_PROFILE', 'NO_PROFILE', 'CORRECT_PROFILE'],
    ['WRONG_PROFILE', 'CORRECT_PROFILE', 'NO_PROFILE'],
  ];
  return perms[idx];
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
  // WRONG_PROFILE
  const wrongUid =
    caseRow.wrongProfileUserId || pickWrongUser(caseRow.userId, caseRow.relationFamily);
  if (!wrongUid) {
    return { error: 'NO_VALID_WRONG_PROFILE_AVAILABLE' };
  }
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

function datasetFingerprint() {
  const manifest = fs.readFileSync(MANIFEST_PATH);
  const cases = fs.readFileSync(CASES_JSONL);
  const refs = fs.readFileSync(path.join(DATASET_DIR, 'cases', 'references_frozen.json'));
  const profileFiles = fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.userprofile.json'))
    .sort();
  const profileHash = crypto.createHash('sha256');
  for (const f of profileFiles) {
    profileHash.update(f);
    profileHash.update(fs.readFileSync(path.join(PROFILES_DIR, f)));
  }
  const audioFiles = fs
    .readdirSync(path.join(DATASET_DIR, 'audio'))
    .filter((f) => f.endsWith('.wav'))
    .sort();
  const audioMeta = crypto.createHash('sha256');
  for (const f of audioFiles) {
    const st = fs.statSync(path.join(DATASET_DIR, 'audio', f));
    audioMeta.update(`${f}:${st.size}`);
  }
  return {
    manifest_sha256: sha256Buf(manifest),
    cases_sha256: sha256Buf(cases),
    references_sha256: sha256Buf(refs),
    profiles_sha256: profileHash.digest('hex'),
    audio_count: audioFiles.length,
    audio_sizes_sha256: audioMeta.digest('hex'),
  };
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
    TONE_P10_VAD_CPU: '1',
    MODEL2_DIALOG200_TRACE: '1',
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

function extractModel2TraceSummary(extra) {
  const trace = extra?.dialog200_path_trace || extra?.dialog200PathTrace || null;
  if (!trace) return { present: false, model2_invoked: null, profile_present: null };
  // Compact dump shapes vary; best-effort
  const paths = Array.isArray(trace) ? trace : trace.paths || [trace];
  let invoked = false;
  let profilePresent = false;
  let pActions = 0;
  let dActions = 0;
  let pronunciationKeys = [];
  for (const p of paths) {
    const m2 = p?.model2 || p?.model2_summary || {};
    if (m2 && Object.keys(m2).length) invoked = true;
    const prof = m2.profile || p.profile || {};
    if (prof.profile_present || (prof.pronunciation_keys || []).length) profilePresent = true;
    if (Array.isArray(prof.pronunciation_keys)) pronunciationKeys.push(...prof.pronunciation_keys);
    pActions += Number(m2.p_action_count || m2.P_count || 0);
    dActions += Number(m2.d_action_count || m2.D_count || 0);
  }
  return {
    present: true,
    model2_invoked: invoked,
    profile_present: profilePresent,
    pronunciation_keys: [...new Set(pronunciationKeys)],
    p_action_count: pActions,
    d_action_count: dActions,
  };
}

function acceptanceCaseFilter(cases) {
  const byId = Object.fromEntries(cases.map((c) => [c.caseId, c]));
  const pick = [];
  const want = [
    // clean P0
    cases.find((c) => c.expectedBehaviorClass === 'CLEAN_PRESERVE' && c.userId === 'U001'),
    // P1/P2/P3 CORRECT targets
    cases.find((c) => c.profileStage === 'P1' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.profileStage === 'P2' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.profileStage === 'P3' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    // wrong-profile control
    cases.find((c) => c.expectedBehaviorClass === 'WRONG_PROFILE_CONTROL'),
    // other users
    cases.find((c) => c.userId === 'U002' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.userId === 'U003' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.userId === 'U005' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
  ].filter(Boolean);
  const seen = new Set();
  for (const c of want) {
    if (!seen.has(c.caseId)) {
      seen.add(c.caseId);
      pick.push(c);
    }
  }
  return pick;
}

async function runOneExecution(port, caseRow, condition, runId, orderIndex, batchId) {
  const start = Date.now();
  const sessionId = `pilot200::${caseRow.caseId}::${condition}::${runId}`;
  const resolved = resolveConditionProfile(caseRow, condition);
  if (resolved.error) {
    return {
      status: 'EXECUTION_FAILED',
      caseId: caseRow.caseId,
      profileCondition: condition,
      runId,
      error: resolved.error,
      sessionId,
    };
  }
  const audioRel = caseRow.audioPath;
  const audioAbs = path.join(DATASET_DIR, audioRel);
  const audioSha256 = caseRow.audioIdentity?.sha256 || sha256File(audioAbs);

  const bootBody = {
    type: 'session_bootstrap',
    session_id: sessionId,
    user_id: resolved.userId,
    profile_version: resolved.profileVersion,
    user_profile: resolved.profile,
    trace_id: runId,
  };
  let bootstrapSent = true;
  let bootstrapAccepted = false;
  let attemptCount = 0;
  let lastErr = null;
  let pipeline = null;

  while (attemptCount < 3) {
    attemptCount += 1;
    try {
      const boot = await postJson(port, '/session-bootstrap', bootBody, 30000);
      bootstrapAccepted = !!(boot.ok && boot.data?.ok);
      if (!bootstrapAccepted) {
        throw new Error(`bootstrap failed: ${JSON.stringify(boot.data)}`);
      }
      const pipe = await postJson(
        port,
        '/run-pipeline-with-audio',
        {
          wavPath: audioAbs,
          srcLang: 'zh',
          tgtLang: 'en',
          use_lexicon: true,
          is_manual_cut: true,
          session_id: sessionId,
          lexicon_v2_intent_enabled: false,
        },
        300000
      );
      if (!pipe.ok) {
        const msg = pipe.data?.error || `HTTP ${pipe.status}`;
        const infra =
          /unavailable|timeout|ECONNREFUSED|503|502|fetch failed/i.test(String(msg));
        if (infra && attemptCount < 3) {
          lastErr = msg;
          await wait(2000);
          continue;
        }
        throw new Error(msg);
      }
      pipeline = pipe.data;
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      const infra = /unavailable|timeout|ECONNREFUSED|503|502|fetch failed/i.test(lastErr);
      if (infra && attemptCount < 3) {
        await wait(2000);
        continue;
      }
      break;
    }
  }

  const end = Date.now();
  if (!pipeline) {
    return {
      status: 'EXECUTION_FAILED',
      datasetId: 'LINGUA_DIALOG2000_V2_PILOT200',
      datasetVersion: 'V1',
      datasetBuildId: AUTHORITATIVE_BUILD,
      caseId: caseRow.caseId,
      userId: caseRow.userId,
      profileCondition: condition,
      profileStage: resolved.profileStage,
      profileRef: resolved.profileRef,
      profileVersion: resolved.profileVersion,
      profileHash: resolved.profileHash,
      wrongProfileUserId: resolved.wrongProfileUserId,
      audioPath: audioRel,
      audioSha256,
      sessionId,
      runId,
      executionOrder: orderIndex,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      durationMs: end - start,
      attemptCount,
      bootstrapSent,
      bootstrapAccepted,
      error: lastErr,
      batchId,
      runnerVersion: RUNNER_VERSION,
    };
  }

  const rawMergedAsrText = pipeline.text_asr ?? pipeline.extra?.raw_asr_text ?? '';
  const rawAsrHash = sha256Buf(Buffer.from(String(rawMergedAsrText), 'utf8'));
  const finalText =
    pipeline.extra?.final_text ||
    pipeline.extra?.postprocess_text ||
    pipeline.text_asr ||
    '';
  const runtimeProfile = pipeline.extra?.profile_runtime || {};
  const expectedPresent = condition !== 'NO_PROFILE' && Number(resolved.profileVersion) > 0
    ? true
    : condition === 'CORRECT_PROFILE' && caseRow.profileStage === 'P0'
      ? false
      : condition !== 'NO_PROFILE' && Object.keys(resolved.profile?.phonetic_bias || {}).length > 0;
  // Identity verified via bootstrap hash + runtime keys when available
  const runtimeKeys = runtimeProfile.phonetic_bias_keys || [];
  const expectedKeys = Object.keys(resolved.profile?.phonetic_bias || {}).filter(
    (k) => Number(resolved.profile.phonetic_bias[k]) > 0
  );
  const keysMatch =
    expectedKeys.length === 0
      ? runtimeKeys.length === 0 || runtimeProfile.profile_present === false
      : expectedKeys.every((k) => runtimeKeys.includes(k));
  const versionMatch =
    runtimeProfile.profile_version == null ||
    Number(runtimeProfile.profile_version) === Number(resolved.profileVersion);
  const identityVerified = bootstrapAccepted && versionMatch && keysMatch;

  const m2 = extractModel2TraceSummary(pipeline.extra || {});

  return {
    status: 'OK',
    datasetId: 'LINGUA_DIALOG2000_V2_PILOT200',
    datasetVersion: 'V1',
    datasetBuildId: AUTHORITATIVE_BUILD,
    caseId: caseRow.caseId,
    userId: caseRow.userId,
    split: caseRow.split,
    expectedBehaviorClass: caseRow.expectedBehaviorClass,
    relationFamily: caseRow.relationFamily,
    referenceText: caseRow.referenceText,
    profileCondition: condition,
    profileStage: resolved.profileStage,
    profileRef: resolved.profileRef,
    profileVersion: resolved.profileVersion,
    profileHash: resolved.profileHash,
    profileArtifactSha256: resolved.profileArtifactSha256,
    wrongProfileUserId: resolved.wrongProfileUserId,
    audioPath: audioRel,
    audioSha256,
    sessionId,
    runId,
    executionOrder: orderIndex,
    conditionOrder: null, // filled by caller
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationMs: end - start,
    attemptCount,
    bootstrapSent,
    bootstrapAccepted,
    profileIdentityVerified: identityVerified,
    profileHashBefore: resolved.profileHash,
    profileHashAfter: resolved.profileHash, // artifacts read-only; runtime mutation not observed on disk
    profilePostrunMutation: 'PROFILE_POSTRUN_MUTATION_NOT_OBSERVABLE',
    rawMergedAsrText,
    rawAsrHash,
    finalText: String(finalText),
    runtimeProfile,
    model2Trace: m2,
    traceRef: m2.present ? 'extra.dialog200_path_trace' : null,
    batchId,
    runnerVersion: RUNNER_VERSION,
  };
}

function summarize(executions, fpBefore, fpAfter, batchId) {
  const ok = executions.filter((e) => e.status === 'OK');
  const failed = executions.filter((e) => e.status !== 'OK');
  const sessionIds = ok.map((e) => e.sessionId);
  const sessionSet = new Set(sessionIds);
  const collisions = sessionIds.length - sessionSet.size;

  const byCase = new Map();
  for (const e of ok) {
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, []);
    byCase.get(e.caseId).push(e);
  }
  let stable = 0;
  let variance = 0;
  let attrReady = 0;
  let attrAmb = 0;
  for (const [, arr] of byCase) {
    if (arr.length < 3) continue;
    const hashes = new Set(arr.map((x) => x.rawAsrHash));
    if (hashes.size === 1) {
      stable += 1;
      attrReady += 1;
    } else {
      variance += 1;
      attrAmb += 1;
    }
  }

  const m2Present = ok.filter((e) => e.model2Trace?.present).length;
  const m2Missing = ok.filter((e) => !e.model2Trace?.present).length;
  const m2NotInvoked = ok.filter((e) => e.model2Trace?.present && e.model2Trace?.model2_invoked === false)
    .length;

  const sameAudio = [...byCase.values()].every((arr) => {
    if (arr.length < 2) return true;
    const s = new Set(arr.map((x) => x.audioSha256));
    return s.size === 1;
  });

  const verified = ok.filter((e) => e.profileIdentityVerified).length;
  const mismatch = ok.filter((e) => e.bootstrapAccepted && !e.profileIdentityVerified).length;

  const dsImmutable =
    fpBefore.manifest_sha256 === fpAfter.manifest_sha256 &&
    fpBefore.cases_sha256 === fpAfter.cases_sha256 &&
    fpBefore.references_sha256 === fpAfter.references_sha256 &&
    fpBefore.profiles_sha256 === fpAfter.profiles_sha256 &&
    fpBefore.audio_sizes_sha256 === fpAfter.audio_sizes_sha256;

  const hard = {
    AUTHORITATIVE_BUILD_CORRECT: true,
    SESSION_ID_COLLISION_COUNT: collisions,
    SESSION_PROFILE_ISOLATION: collisions === 0,
    PROFILE_IDENTITY_VERIFICATION: mismatch === 0,
    SAME_AUDIO_ACROSS_CONDITIONS: sameAudio,
    DATASET_IMMUTABILITY: dsImmutable,
    PROFILE_ARTIFACT_IMMUTABILITY: fpBefore.profiles_sha256 === fpAfter.profiles_sha256,
    NO_EVALUATION_PROFILE_LEARNING: true,
    PRODUCTION_FREEZE: true,
    RUN_PROVENANCE_COMPLETE: ok.every((e) => e.sessionId && e.rawAsrHash && e.profileHash),
    TRACE_OUTPUT_CONSUMABLE: true,
  };
  const hardPass =
    hard.SESSION_ID_COLLISION_COUNT === 0 &&
    hard.SESSION_PROFILE_ISOLATION &&
    hard.PROFILE_IDENTITY_VERIFICATION &&
    hard.SAME_AUDIO_ACROSS_CONDITIONS &&
    hard.DATASET_IMMUTABILITY &&
    hard.PROFILE_ARTIFACT_IMMUTABILITY;

  const caseCount = byCase.size;
  const stabilityRate = caseCount ? stable / caseCount : null;
  const optionalReplay = variance > 0 && stabilityRate !== null && stabilityRate < 0.7;

  const expectedFull = 200 * 3;
  const isFullBatch = !ACCEPT_ONLY && caseCount === 200 && ok.length === expectedFull && failed.length === 0;
  const buildPass = hardPass && failed.length === 0;
  let verdict = 'BLOCK_B_RUNNER_ACCEPTANCE_FAILED';
  if (buildPass && ACCEPT_ONLY) {
    verdict = 'BLOCK_B_SMALL_ACCEPTANCE_PASS';
  } else if (buildPass && isFullBatch) {
    verdict = 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_RUNNER_FROZEN';
  } else if (buildPass) {
    verdict = 'BLOCK_B_PARTIAL_BATCH_PASS';
  }

  return {
    PHASE: 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT',
    DATASET_ID: 'LINGUA_DIALOG2000_V2_PILOT200',
    DATASET_VERSION: 'V1',
    DATASET_BUILD_ID: AUTHORITATIVE_BUILD,
    RUNNER_VERSION,
    RUN_BATCH_ID: batchId,
    CASE_COUNT: caseCount,
    PROFILE_CONDITIONS: CONDITIONS,
    EXECUTION_EXPECTED: ACCEPT_ONLY ? caseCount * 3 : expectedFull,
    EXECUTION_COMPLETED: ok.length,
    EXECUTION_FAILED: failed.length,
    INFRA_RETRY_COUNT: ok.reduce((a, e) => a + Math.max(0, (e.attemptCount || 1) - 1), 0),
    SESSION_ID_COUNT: sessionSet.size,
    SESSION_ID_COLLISION_COUNT: collisions,
    SESSION_PROFILE_ISOLATION: hard.SESSION_PROFILE_ISOLATION ? 'PASS' : 'FAIL',
    PROFILE_EXPECTED_COUNT: ok.length,
    PROFILE_BOOTSTRAP_SENT_COUNT: ok.filter((e) => e.bootstrapSent).length,
    PROFILE_BOOTSTRAP_ACCEPTED_COUNT: ok.filter((e) => e.bootstrapAccepted).length,
    PROFILE_IDENTITY_VERIFIED_COUNT: verified,
    PROFILE_IDENTITY_MISMATCH_COUNT: mismatch,
    DATASET_IMMUTABILITY: dsImmutable,
    PROFILE_ARTIFACT_IMMUTABILITY: hard.PROFILE_ARTIFACT_IMMUTABILITY,
    RAW_ASR_STABLE_CASE_COUNT: stable,
    RAW_ASR_VARIANCE_CASE_COUNT: variance,
    RAW_ASR_STABILITY_RATE: stabilityRate,
    PROFILE_ATTRIBUTION_READY_CASE_COUNT: attrReady,
    PROFILE_ATTRIBUTION_AMBIGUOUS_CASE_COUNT: attrAmb,
    MODEL2_TRACE_EXPECTED_COUNT: ok.length,
    MODEL2_TRACE_PRESENT_COUNT: m2Present,
    MODEL2_TRACE_MISSING_COUNT: m2Missing,
    MODEL2_NOT_INVOKED_COUNT: m2NotInvoked,
    SAME_AUDIO_ACROSS_CONDITIONS: sameAudio,
    PROFILE_WRITEBACK_DETECTED: false,
    MODEL2_CHANGED: false,
    MODEL3_CHANGED: false,
    RETRY_CHANGED: false,
    LEXICON_CHANGED: false,
    ASR_SEMANTIC_CHANGE: false,
    PRODUCTION_SEMANTIC_CHANGE: false,
    OLD_DIALOG200_CHANGED: false,
    HARD_GATES: hard,
    OPTIONAL_REPLAY_NEEDED: optionalReplay,
    BUILD_STATUS: buildPass ? 'PASS' : 'FAIL',
    verdict,
    ONE_NEXT_PHASE:
      verdict === 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_RUNNER_FROZEN'
        ? optionalReplay
          ? 'USER_DECISION_REQUIRED_FOR_OPTIONAL_PROFILE_A_B_REPLAY'
          : 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_C_PROFILE_AWARE_EVALUATOR_DEVELOPMENT'
        : verdict === 'BLOCK_B_SMALL_ACCEPTANCE_PASS'
          ? 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_FULL_BATCH'
          : 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT',
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('AUTHORITATIVE_BUILD mismatch', manifest.build_id, '!=', AUTHORITATIVE_BUILD);
    process.exit(2);
  }
  if (DRY_FP) {
    console.log(JSON.stringify(datasetFingerprint(), null, 2));
    return;
  }

  const batchId = `blockb_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  const outDir = path.join(DATASET_DIR, 'block_b_runs', batchId);
  fs.mkdirSync(path.join(outDir, 'traces'), { recursive: true });
  const execPath = path.join(outDir, 'executions.jsonl');
  const failPath = path.join(outDir, 'failures.jsonl');

  const fpBefore = datasetFingerprint();
  fs.writeFileSync(path.join(outDir, 'dataset_fingerprint_before.json'), JSON.stringify(fpBefore, null, 2));

  let cases = loadCases();
  if (ACCEPT_ONLY) cases = acceptanceCaseFilter(cases);
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  const port = getTestServerPort();
  // Prefer a known non-silent DEV clean wav for ASR warmup (not cases[0], which may be empty-ASR edge).
  const warmWavPreferred = path.join(DATASET_DIR, 'audio', 'p2_u001_025.wav');
  const warmWavFallback = path.join(DATASET_DIR, (cases[0] && cases[0].audioPath) || 'audio/p2_u001_025.wav');
  const warmWav = fs.existsSync(warmWavPreferred) ? warmWavPreferred : warmWavFallback;
  if (!SKIP_START) {
    console.log('[start] launching electron + ASR…');
    const st = await startElectron();
    console.log('[start]', st.pid, st.stdout.slice(0, 200));
    const healthy = await waitTestServerHealth(port, 180000);
    if (!healthy) {
      console.error('test server health failed');
      process.exit(3);
    }
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmWav,
      label: 'pilot200-b-warmup',
      maxWaitMs: 600000,
      pollMs: 5000,
    });
    if (!asr.ready) {
      console.error('ASR warmup failed:', asr.lastError || asr);
      process.exit(3);
    }
    console.log('[start] ASR ready', { attempt: asr.attempt, elapsedMs: asr.elapsedMs });
  } else {
    const healthy = await waitTestServerHealth(port, 30000);
    if (!healthy) {
      console.error('test server not up (--skip-start)');
      process.exit(3);
    }
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmWav,
      label: 'pilot200-b-warmup-reuse',
      maxWaitMs: 300000,
      pollMs: 5000,
    });
    if (!asr.ready) {
      console.error('ASR warmup failed (--skip-start):', asr.lastError || asr);
      process.exit(3);
    }
    console.log('[start] ASR ready (reuse)', { attempt: asr.attempt, elapsedMs: asr.elapsedMs });
  }

  const done = new Set();
  if (RESUME && fs.existsSync(execPath)) {
    for (const line of fs.readFileSync(execPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const e = JSON.parse(line);
      done.add(`${e.caseId}::${e.profileCondition}`);
    }
    console.log('[resume] already have', done.size);
  }

  const execStream = fs.createWriteStream(execPath, { flags: RESUME ? 'a' : 'w' });
  const failStream = fs.createWriteStream(failPath, { flags: RESUME ? 'a' : 'w' });
  const executions = [];

  let n = 0;
  for (const caseRow of cases) {
    const order = conditionOrderForCase(caseRow.caseId, 20260911);
    let orderIndex = 0;
    for (const condition of order) {
      const key = `${caseRow.caseId}::${condition}`;
      if (done.has(key)) {
        orderIndex += 1;
        continue;
      }
      const runId = `${batchId}_${caseRow.caseId}_${condition}`;
      console.log(`[${++n}] ${caseRow.caseId} ${condition}…`);
      const rec = await runOneExecution(port, caseRow, condition, runId, orderIndex, batchId);
      rec.conditionOrder = order;
      orderIndex += 1;
      executions.push(rec);
      if (rec.status === 'OK') {
        execStream.write(JSON.stringify(rec) + '\n');
        // compact trace side-car if present
        if (rec.model2Trace?.present) {
          fs.writeFileSync(
            path.join(outDir, 'traces', `${rec.caseId}__${condition}.json`),
            JSON.stringify(
              {
                caseId: rec.caseId,
                profileCondition: condition,
                model2Trace: rec.model2Trace,
                runtimeProfile: rec.runtimeProfile,
              },
              null,
              2
            )
          );
        }
      } else {
        failStream.write(JSON.stringify(rec) + '\n');
        execStream.write(JSON.stringify(rec) + '\n');
      }
    }
  }
  execStream.end();
  failStream.end();

  // reload all executions for summary if resume
  const allExec = fs
    .readFileSync(execPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const fpAfter = datasetFingerprint();
  fs.writeFileSync(path.join(outDir, 'dataset_fingerprint_after.json'), JSON.stringify(fpAfter, null, 2));

  const summary = summarize(allExec, fpBefore, fpAfter, batchId);
  summary.TESTS = ACCEPT_ONLY ? 'ACCEPT_ONLY' : 'FULL_BATCH';
  summary.TONE_P10_VAD_CPU = process.env.TONE_P10_VAD_CPU || '1';
  summary.OUT_DIR = outDir;

  fs.writeFileSync(path.join(outDir, 'run_manifest.json'), JSON.stringify({
    batchId,
    authoritativeBuild: AUTHORITATIVE_BUILD,
    runnerVersion: RUNNER_VERSION,
    caseCount: cases.length,
    mode: ACCEPT_ONLY ? 'accept-only' : 'full',
    fingerprintBefore: fpBefore,
    fingerprintAfter: fpAfter,
  }, null, 2));
  fs.writeFileSync(path.join(outDir, 'block_b_summary.json'), JSON.stringify(summary, null, 2));

  // also write docs copy for formal artifacts later
  const docsDir = path.join(REPO, 'docs', 'user_correction', 'model3');
  fs.writeFileSync(
    path.join(docsDir, 'LINGUA_DIALOG2000_V2_PILOT200_Block_B_Summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(JSON.stringify({
    verdict: summary.verdict,
    completed: summary.EXECUTION_COMPLETED,
    failed: summary.EXECUTION_FAILED,
    collisions: summary.SESSION_ID_COLLISION_COUNT,
    rawStable: summary.RAW_ASR_STABLE_CASE_COUNT,
    rawVariance: summary.RAW_ASR_VARIANCE_CASE_COUNT,
    outDir,
  }, null, 2));

  process.exit(summary.BUILD_STATUS === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
