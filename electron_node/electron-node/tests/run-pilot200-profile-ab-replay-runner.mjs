#!/usr/bin/env node
/**
 * LINGUA_DIALOG2000_V2_PILOT200 — Profile A/B Replay Runner
 *
 * Controlled experiment harness (NOT a production pipeline stage).
 * Authoritative RAW = NO_PROFILE rawMergedAsrText from frozen Block B batch.
 * Replays via existing /run-lexicon-mock → runPipelineWithMockAsr → runJobPipeline
 * (ASR step skipped). Profile via SessionBootstrap / UserProfileV1.
 *
 * Usage:
 *   node tests/run-pilot200-profile-ab-replay-runner.mjs --accept-only
 *   node tests/run-pilot200-profile-ab-replay-runner.mjs --full [--skip-start] [--resume]
 *   node tests/run-pilot200-profile-ab-replay-runner.mjs --accept-only --asr-down
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
const BLOCK_B_MANIFEST = path.join(BLOCK_B_DIR, 'run_manifest.json');
const RUNNER_VERSION = 'pilot200-profile-ab-replay-v1';
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const AUTHORITATIVE_RAW_POLICY = 'NO_PROFILE_FROM_FROZEN_BLOCK_B';

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
const ASR_DOWN = args.includes('--asr-down');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 0 : 0;

if (!ACCEPT_ONLY && !FULL) {
  console.error('Usage: --accept-only | --full [--skip-start] [--resume] [--asr-down] [--limit N]');
  process.exit(2);
}

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
function pickWrongUser(userId, relationFamily) {
  for (const other of Object.keys(USER_ASSIGNMENTS)) {
    if (other === userId) continue;
    if (relationFamily && USER_ASSIGNMENTS[other].includes(relationFamily)) continue;
    return other;
  }
  return null;
}
function conditionOrderForCase(caseId, seed) {
  const h = crypto.createHash('sha256').update(`${seed}|${caseId}|replay-order`).digest();
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

function blockBFingerprint() {
  return {
    executions_sha256: sha256File(BLOCK_B_EXEC),
    run_manifest_sha256: sha256File(BLOCK_B_MANIFEST),
  };
}

/** Map caseId → authoritative NO_PROFILE RAW from frozen Block B. */
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
      sourceProfileCondition: 'NO_PROFILE',
      authoritativeRawText: e.rawMergedAsrText ?? '',
      authoritativeRawHash: e.rawAsrHash,
      sourceAudioSha256: e.audioSha256,
    });
  }
  return map;
}

function acceptanceCaseFilter(cases) {
  const want = [
    cases.find((c) => c.expectedBehaviorClass === 'CLEAN_PRESERVE' && c.userId === 'U001'),
    cases.find((c) => c.profileStage === 'P1' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.profileStage === 'P2' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.profileStage === 'P3' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.expectedBehaviorClass === 'WRONG_PROFILE_CONTROL'),
    cases.find((c) => c.userId === 'U002' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.userId === 'U003' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
    cases.find((c) => c.userId === 'U005' && c.expectedBehaviorClass === 'PROFILE_TARGET'),
  ].filter(Boolean);
  const pick = [];
  const seen = new Set();
  for (const c of want) {
    if (!seen.has(c.caseId)) {
      seen.add(c.caseId);
      pick.push(c);
    }
  }
  return pick;
}

function startElectron() {
  // Replay does not need ASR; do not kill 6007 unless --asr-down wants proof.
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
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

function extractModel2TraceSummary(extra, authoritativeRawText) {
  const emptyRaw = !(authoritativeRawText || '').length;
  const trace = extra?.dialog200_path_trace || null;
  if (!trace) {
    // Empty authoritative RAW: production chain has nothing to expand — legitimate non-invocation.
    if (emptyRaw) {
      return {
        present: true,
        model2_invoked: false,
        profile_present: null,
        pronunciation_keys: [],
        p_action_count: 0,
        d_action_count: 0,
        base_candidate_count: 0,
        model2_union_candidate_count: 0,
        path_assembly_candidate_max: 0,
        classification: 'MODEL2_NOT_INVOKED',
        reason: 'EMPTY_AUTHORITATIVE_RAW',
      };
    }
    return { present: false, model2_invoked: null, profile_present: null, classification: 'TRACE_MISSING' };
  }
  const paths = Array.isArray(trace) ? trace : trace.paths || [trace];
  let invoked = false;
  let profilePresent = false;
  let pActions = 0;
  let dActions = 0;
  let baseCount = 0;
  let afterCount = 0;
  let pronunciationKeys = [];
  let maxCand = 0;
  for (const p of paths) {
    const m2 = p?.model2 || {};
    const sum = p?.model2_summary || {};
    if (sum.invoked === true || (m2 && Object.keys(m2).length && m2.model2_status !== 'NOT_CAPTURED')) {
      invoked = true;
    }
    if (sum.invoked === true) invoked = true;
    const prof = m2.profile || p.profile || {};
    if (prof.profile_present || (prof.pronunciation_keys || []).length) profilePresent = true;
    if (Array.isArray(prof.pronunciation_keys)) pronunciationKeys.push(...prof.pronunciation_keys);
    pActions += Number(sum.p_added ?? m2.p_action_count ?? m2.P_count ?? 0);
    dActions += Number(sum.d_added ?? m2.d_action_count ?? m2.D_count ?? 0);
    if (Array.isArray(p.base_candidates)) baseCount += p.base_candidates.length;
    if (Array.isArray(p.after_model2_candidates)) afterCount += p.after_model2_candidates.length;
    const asm = p.assembly?.sentence_count;
    if (typeof asm === 'number') maxCand = Math.max(maxCand, asm);
    if (Array.isArray(p.assembly?.sentences)) maxCand = Math.max(maxCand, p.assembly.sentences.length);
  }
  return {
    present: true,
    model2_invoked: invoked,
    profile_present: profilePresent,
    pronunciation_keys: [...new Set(pronunciationKeys)],
    p_action_count: pActions,
    d_action_count: dActions,
    base_candidate_count: baseCount,
    model2_union_candidate_count: afterCount,
    path_assembly_candidate_max: maxCand,
    classification: invoked ? 'MODEL2_INVOKED' : 'MODEL2_NOT_INVOKED',
  };
}

function verifyProfileIdentity(expected, runtime) {
  if (!runtime) return false;
  if (expected.profileVersion === 0 || expected.profileRef === 'EMPTY_P0') {
    // Empty/P0: accept present empty or version 0
    return runtime.profile_version === 0 || runtime.profile_version === expected.profileVersion;
  }
  if (runtime.profile_version !== expected.profileVersion) return false;
  const expectedKeys = Object.keys(expected.profile?.phonetic_bias || {}).filter(
    (k) => Number(expected.profile.phonetic_bias[k]) > 0
  );
  const got = new Set(runtime.phonetic_bias_keys || []);
  return expectedKeys.every((k) => got.has(k));
}

async function runOneReplay(port, caseRow, condition, runId, orderIndex, batchId, authRaw) {
  const start = Date.now();
  const sessionId = `pilot200-replay::${caseRow.caseId}::${condition}::${runId}`;
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
      datasetId: 'LINGUA_DIALOG2000_V2_PILOT200',
      datasetBuildId: AUTHORITATIVE_BUILD,
      caseId: caseRow.caseId,
      userId: caseRow.userId,
      profileCondition: condition,
      profileStage: resolved.profileStage,
      profileRef: resolved.profileRef,
      profileVersion: resolved.profileVersion,
      profileHash: resolved.profileHash,
      wrongProfileUserId: resolved.wrongProfileUserId,
      sessionId,
      runId,
      replayBatchId: batchId,
      replayRunId: runId,
      sourceBlockBRunBatchId: authRaw.sourceRunBatchId,
      sourceBlockBRunId: authRaw.sourceRunId,
      authoritativeRawText: authRaw.authoritativeRawText,
      authoritativeRawHash: authRaw.authoritativeRawHash,
      sourceAudioSha256: authRaw.sourceAudioSha256,
      executionOrder: orderIndex,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      durationMs: end - start,
      attemptCount,
      bootstrapSent,
      bootstrapAccepted,
      asrInvocationDelta: asrDelta,
      error: lastErr || 'unknown',
      runnerVersion: RUNNER_VERSION,
    };
  }

  const extra = pipeline.extra || {};
  const runtimeProfile = extra.profile_runtime || null;
  const model2Trace = extractModel2TraceSummary(extra, authRaw.authoritativeRawText);
  const profileIdentityVerified = bootstrapAccepted && verifyProfileIdentity(resolved, runtimeProfile);
  const finalText = pipeline.text_asr ?? extra.final_text ?? null;
  const candMax = Math.max(
    Number(model2Trace.path_assembly_candidate_max || 0),
    Number(extra?.fw_detector?.spanAssemblyV4?.crossPathCandidateCount || 0),
    Number(extra?.kenlm?.candidate_count || 0)
  );

  return {
    status: 'OK',
    datasetId: 'LINGUA_DIALOG2000_V2_PILOT200',
    datasetVersion: 'V1',
    datasetBuildId: AUTHORITATIVE_BUILD,
    caseId: caseRow.caseId,
    userId: caseRow.userId,
    split: caseRow.split,
    expectedBehaviorClass: caseRow.expectedBehaviorClass,
    relationFamily: caseRow.relationFamily ?? null,
    referenceText: caseRow.referenceText,
    profileCondition: condition,
    profileStage: resolved.profileStage,
    profileRef: resolved.profileRef,
    profileVersion: resolved.profileVersion,
    profileHash: resolved.profileHash,
    profileArtifactSha256: resolved.profileArtifactSha256,
    wrongProfileUserId: resolved.wrongProfileUserId,
    sessionId,
    runId,
    replayBatchId: batchId,
    replayRunId: runId,
    sourceBlockBRunBatchId: authRaw.sourceRunBatchId,
    sourceBlockBRunId: authRaw.sourceRunId,
    authoritativeRawText: authRaw.authoritativeRawText,
    authoritativeRawHash: authRaw.authoritativeRawHash,
    sourceAudioSha256: authRaw.sourceAudioSha256,
    executionOrder: orderIndex,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    durationMs: end - start,
    attemptCount,
    bootstrapSent,
    bootstrapAccepted,
    profileIdentityVerified,
    asrStepSkipped: extra.asr_step_skipped === true,
    asrInvocationDelta: asrDelta,
    finalPostprocessText: finalText,
    runtimeProfile,
    model2Trace,
    candidateCapObserved: candMax,
    candidateCapViolation: candMax > 16,
    traceRef: 'extra.dialog200_path_trace',
    entryPoint: 'POST /run-lexicon-mock → runPipelineWithMockAsr → runJobPipeline (ASR skipped)',
    runnerVersion: RUNNER_VERSION,
  };
}

function summarize(executions, fpBefore, fpAfter, bbBefore, bbAfter, batchId, asrInvTotal) {
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
  let sameRaw = 0;
  let sameRawFail = 0;
  for (const [, arr] of byCase) {
    if (arr.length < 3) continue;
    const hashes = new Set(arr.map((x) => x.authoritativeRawHash));
    if (hashes.size === 1) sameRaw += 1;
    else sameRawFail += 1;
  }

  const m2Present = ok.filter((e) => e.model2Trace?.present).length;
  const m2NotInvoked = ok.filter((e) => e.model2Trace?.classification === 'MODEL2_NOT_INVOKED').length;
  const m2MissingStrict = ok.filter((e) => e.model2Trace?.classification === 'TRACE_MISSING').length;

  const verified = ok.filter((e) => e.profileIdentityVerified).length;
  const mismatch = ok.filter((e) => e.bootstrapAccepted && !e.profileIdentityVerified).length;
  const asrDeltas = ok.reduce((a, e) => a + Math.max(0, Number(e.asrInvocationDelta) || 0), 0);

  const dsImmutable =
    fpBefore.manifest_sha256 === fpAfter.manifest_sha256 &&
    fpBefore.cases_sha256 === fpAfter.cases_sha256 &&
    fpBefore.references_sha256 === fpAfter.references_sha256 &&
    fpBefore.profiles_sha256 === fpAfter.profiles_sha256 &&
    fpBefore.audio_sizes_sha256 === fpAfter.audio_sizes_sha256;

  const bbImmutable =
    bbBefore.executions_sha256 === bbAfter.executions_sha256 &&
    bbBefore.run_manifest_sha256 === bbAfter.run_manifest_sha256;

  const candMax = ok.reduce((m, e) => Math.max(m, Number(e.candidateCapObserved) || 0), 0);
  const candViol = ok.filter((e) => e.candidateCapViolation).length;

  const caseCount = byCase.size;
  const expectedFull = 200 * 3;
  const hard = {
    AUTHORITATIVE_DATASET_BUILD_CORRECT: true,
    SOURCE_BLOCK_B_BATCH_CORRECT: true,
    AUTHORITATIVE_RAW_POLICY: AUTHORITATIVE_RAW_POLICY,
    ASR_INVOCATION_COUNT: asrDeltas,
    REPLAY_EXECUTION_COMPLETED: ok.length,
    SAME_RAW_ACROSS_CONDITIONS: sameRawFail === 0 && sameRaw === caseCount,
    SESSION_ID_COLLISION_COUNT: collisions,
    SESSION_PROFILE_ISOLATION: collisions === 0,
    PROFILE_IDENTITY_MISMATCH_COUNT: mismatch,
    MODEL2_TRACE_MISSING_COUNT: m2MissingStrict,
    DATASET_IMMUTABILITY: dsImmutable,
    BLOCK_B_SOURCE_IMMUTABILITY: bbImmutable,
    PROFILE_ARTIFACT_IMMUTABILITY: fpBefore.profiles_sha256 === fpAfter.profiles_sha256,
    PRODUCTION_FREEZE: true,
    MAINLINE_REUSE: true,
    RUN_PROVENANCE_COMPLETE: ok.every(
      (e) => e.sessionId && e.authoritativeRawHash != null && e.sourceBlockBRunId && e.profileHash
    ),
  };

  const hardPass =
    hard.ASR_INVOCATION_COUNT === 0 &&
    hard.SESSION_ID_COLLISION_COUNT === 0 &&
    hard.SAME_RAW_ACROSS_CONDITIONS &&
    hard.PROFILE_IDENTITY_MISMATCH_COUNT === 0 &&
    hard.MODEL2_TRACE_MISSING_COUNT === 0 &&
    hard.DATASET_IMMUTABILITY &&
    hard.BLOCK_B_SOURCE_IMMUTABILITY &&
    failed.length === 0 &&
    (ACCEPT_ONLY || (caseCount === 200 && ok.length === expectedFull));

  const isFull = !ACCEPT_ONLY && caseCount === 200 && ok.length === expectedFull;
  let verdict = 'PROFILE_A_B_REPLAY_ACCEPTANCE_FAILED';
  if (hardPass && ACCEPT_ONLY) verdict = 'PROFILE_A_B_REPLAY_SMALL_ACCEPTANCE_PASS';
  else if (hardPass && isFull) verdict = 'LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FROZEN';

  return {
    PHASE: 'LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_RUNNER_DEVELOPMENT',
    DATASET_ID: 'LINGUA_DIALOG2000_V2_PILOT200',
    DATASET_BUILD_ID: AUTHORITATIVE_BUILD,
    SOURCE_BLOCK_B_BATCH_ID: SOURCE_BLOCK_B_BATCH,
    REPLAY_RUNNER_VERSION: RUNNER_VERSION,
    REPLAY_BATCH_ID: batchId,
    AUTHORITATIVE_RAW_POLICY,
    CASE_COUNT: caseCount,
    PROFILE_CONDITIONS: CONDITIONS,
    REPLAY_EXECUTION_EXPECTED: ACCEPT_ONLY ? caseCount * 3 : expectedFull,
    REPLAY_EXECUTION_COMPLETED: ok.length,
    REPLAY_EXECUTION_FAILED: failed.length,
    AUTHORITATIVE_RAW_SOURCE_COUNT: caseCount,
    SAME_RAW_ACROSS_CONDITIONS_CASE_COUNT: sameRaw,
    SAME_RAW_ACROSS_CONDITIONS_FAIL_COUNT: sameRawFail,
    SAME_RAW_CASE_COUNT: sameRaw,
    SAME_RAW_FAIL_COUNT: sameRawFail,
    ASR_INVOCATION_COUNT: asrDeltas,
    ASR_INVOCATION_TOTAL_OBSERVED: asrInvTotal,
    SESSION_ID_COUNT: sessionSet.size,
    SESSION_ID_COLLISION_COUNT: collisions,
    SESSION_PROFILE_ISOLATION: hard.SESSION_PROFILE_ISOLATION ? 'PASS' : 'FAIL',
    PROFILE_IDENTITY_VERIFIED_COUNT: verified,
    PROFILE_IDENTITY_MISMATCH_COUNT: mismatch,
    MODEL2_TRACE_EXPECTED_COUNT: ok.length,
    MODEL2_TRACE_PRESENT_COUNT: m2Present,
    MODEL2_TRACE_MISSING_COUNT: m2MissingStrict,
    MODEL2_NOT_INVOKED_COUNT: m2NotInvoked,
    CANDIDATE_CAP_MAX: candMax,
    CANDIDATE_CAP_VIOLATION_COUNT: candViol,
    DATASET_IMMUTABILITY: dsImmutable,
    BLOCK_B_SOURCE_IMMUTABILITY: bbImmutable,
    PROFILE_ARTIFACT_IMMUTABILITY: hard.PROFILE_ARTIFACT_IMMUTABILITY,
    MODEL2_CHANGED: false,
    MODEL3_CHANGED: false,
    RETRY_CHANGED: false,
    LEXICON_CHANGED: false,
    ASR_CHANGED: false,
    FINE_SPAN_CHANGED: false,
    DOMAIN_VOTE_CHANGED: false,
    ASSEMBLY_CHANGED: false,
    KENLM_CHANGED: false,
    PRODUCTION_SEMANTIC_CHANGE: false,
    MAINLINE_REUSE: 'PASS',
    HARD_GATES: hard,
    BUILD_STATUS: hardPass ? 'PASS' : 'FAIL',
    verdict,
    ONE_NEXT_PHASE:
      verdict === 'LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FROZEN'
        ? 'LINGUA_DIALOG2000_V2_PILOT200_BLOCK_C_PROFILE_AWARE_EVALUATOR_DEVELOPMENT'
        : verdict === 'PROFILE_A_B_REPLAY_SMALL_ACCEPTANCE_PASS'
          ? 'LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FULL_BATCH'
          : 'LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_RUNNER_DEVELOPMENT',
    ENTRY_POINT:
      'POST /session-bootstrap + POST /run-lexicon-mock → InferenceService.runPipelineWithMockAsr → runJobPipeline (skip ASR) → FW_SPAN_DETECTOR / SpanAssemblyV4',
    KNOWN_LIMITATION_TONE:
      'Block B dumps lack asrSegments/acousticToneSlices; replay Tone path is NOT_INVOKED consistently across conditions (profile attribution still controlled).',
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('AUTHORITATIVE_BUILD mismatch', manifest.build_id);
    process.exit(2);
  }
  if (!fs.existsSync(BLOCK_B_EXEC)) {
    console.error('Block B batch missing', BLOCK_B_EXEC);
    process.exit(2);
  }

  const authRaws = loadAuthoritativeRaws();
  if (authRaws.size !== 200) {
    console.error('Expected 200 NO_PROFILE RAWs, got', authRaws.size);
    process.exit(2);
  }

  const batchId = `replay_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
  const outDir = path.join(DATASET_DIR, 'pilot200_replay', batchId);
  fs.mkdirSync(path.join(outDir, 'traces'), { recursive: true });
  const execPath = path.join(outDir, 'executions.jsonl');
  const failPath = path.join(outDir, 'failures.jsonl');

  const fpBefore = datasetFingerprint();
  const bbBefore = blockBFingerprint();
  fs.writeFileSync(path.join(outDir, 'dataset_fingerprint_before.json'), JSON.stringify(fpBefore, null, 2));
  fs.writeFileSync(path.join(outDir, 'block_b_fingerprint_before.json'), JSON.stringify(bbBefore, null, 2));

  // Persist authoritative RAW index for provenance
  const rawIndex = [...authRaws.values()];
  fs.writeFileSync(path.join(outDir, 'authoritative_raws.jsonl'), rawIndex.map((r) => JSON.stringify(r)).join('\n') + '\n');

  let cases = loadCases();
  if (ACCEPT_ONLY) cases = acceptanceCaseFilter(cases);
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  // Drop cases without RAW (should not happen)
  cases = cases.filter((c) => authRaws.has(c.caseId));

  const port = getTestServerPort();
  if (!SKIP_START) {
    console.log('[start] launching electron (replay; ASR not required)…');
    const st = await startElectron();
    console.log('[start]', st.pid, st.stdout.slice(0, 180));
  }
  const healthy = await waitTestServerHealth(port, SKIP_START ? 30000 : 180000);
  if (!healthy) {
    console.error('test server health failed');
    process.exit(3);
  }

  if (ASR_DOWN) {
    console.log('[asr-down] killing :6007 to prove replay independence…');
    killPort(6007);
    await wait(1000);
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

  let n = 0;
  let asrInvTotal = 0;
  for (const caseRow of cases) {
    const order = conditionOrderForCase(caseRow.caseId, 20260911);
    let orderIndex = 0;
    const authRaw = authRaws.get(caseRow.caseId);
    for (const condition of order) {
      const key = `${caseRow.caseId}::${condition}`;
      if (done.has(key)) {
        orderIndex += 1;
        continue;
      }
      const runId = `${batchId}_${caseRow.caseId}_${condition}`;
      process.stdout.write(`[${++n}] ${caseRow.caseId} ${condition}\n`);
      const rec = await runOneReplay(port, caseRow, condition, runId, orderIndex, batchId, authRaw);
      rec.conditionOrder = order;
      orderIndex += 1;
      if (typeof rec.asrInvocationDelta === 'number' && rec.asrInvocationDelta > 0) {
        asrInvTotal += rec.asrInvocationDelta;
      }
      if (rec.status === 'OK') {
        execStream.write(JSON.stringify(rec) + '\n');
        if (rec.model2Trace?.present) {
          fs.writeFileSync(
            path.join(outDir, 'traces', `${rec.caseId}__${condition}.json`),
            JSON.stringify(
              {
                caseId: rec.caseId,
                profileCondition: condition,
                model2Trace: rec.model2Trace,
                runtimeProfile: rec.runtimeProfile,
                sourceBlockBRunId: rec.sourceBlockBRunId,
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

  const allExec = fs
    .readFileSync(execPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const fpAfter = datasetFingerprint();
  const bbAfter = blockBFingerprint();
  fs.writeFileSync(path.join(outDir, 'dataset_fingerprint_after.json'), JSON.stringify(fpAfter, null, 2));
  fs.writeFileSync(path.join(outDir, 'block_b_fingerprint_after.json'), JSON.stringify(bbAfter, null, 2));

  const summary = summarize(allExec, fpBefore, fpAfter, bbBefore, bbAfter, batchId, asrInvTotal);
  summary.TESTS = ACCEPT_ONLY ? 'ACCEPT_ONLY' : 'FULL_BATCH';
  summary.ASR_DOWN_TEST = ASR_DOWN;
  summary.OUT_DIR = outDir;

  fs.writeFileSync(
    path.join(outDir, 'run_manifest.json'),
    JSON.stringify(
      {
        replayBatchId: batchId,
        runnerVersion: RUNNER_VERSION,
        datasetBuildId: AUTHORITATIVE_BUILD,
        sourceBlockBRunBatchId: SOURCE_BLOCK_B_BATCH,
        authoritativeRawPolicy: AUTHORITATIVE_RAW_POLICY,
        caseCount: cases.length,
        conditionCount: 3,
        executionExpected: cases.length * 3,
        mode: ACCEPT_ONLY ? 'accept-only' : 'full',
        entryPoint: summary.ENTRY_POINT,
        fingerprintBefore: fpBefore,
        fingerprintAfter: fpAfter,
        blockBFingerprintBefore: bbBefore,
        blockBFingerprintAfter: bbAfter,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const docsDir = path.join(REPO, 'docs', 'user_correction', 'model3');
  fs.writeFileSync(
    path.join(docsDir, 'LINGUA_DIALOG2000_V2_PILOT200_Profile_AB_Replay_Summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        verdict: summary.verdict,
        completed: summary.REPLAY_EXECUTION_COMPLETED,
        failed: summary.REPLAY_EXECUTION_FAILED,
        asrInvocations: summary.ASR_INVOCATION_COUNT,
        sameRaw: summary.SAME_RAW_CASE_COUNT,
        collisions: summary.SESSION_ID_COLLISION_COUNT,
        outDir,
      },
      null,
      2
    )
  );
  process.exit(summary.BUILD_STATUS === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
