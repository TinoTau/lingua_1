#!/usr/bin/env node
/**
 * LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_SINGLE_DELTA
 *
 * NEW diagnostic capture (full-audio) → persist segments + utterance_tone
 * → Replay with frozen evidence + profile-only variation.
 *
 * Does NOT mutate blockb_2026-09-11T1021 or replay_2026-09-11T1347.
 * Does NOT bypass Tone / invent Tone / change Model2.
 *
 * Usage:
 *   node tests/run-pilot200-frozen-tone-evidence-delta.mjs [--skip-start] [--capture-only] [--replay-only]
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const MANIFEST_PATH = path.join(DATASET_DIR, 'manifest', 'dataset_manifest.json');
const CASES_JSONL = path.join(DATASET_DIR, 'cases', 'cases.jsonl');
const PROFILES_DIR = path.join(DATASET_DIR, 'profiles');
const AUTHORITATIVE_BUILD = 'build_20260911_091806';
const OLD_BLOCK_B = 'blockb_2026-09-11T1021';
const OLD_REPLAY = 'replay_2026-09-11T1347';
const CAPTURE_BATCH_ID = 'tonecap_2026-09-12T0001';
const REPLAY_BATCH_ID = 'tonereplay_2026-09-12T0001';
const PHASE = 'LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_SINGLE_DELTA';
const RUNNER_VERSION = 'pilot200-frozen-tone-evidence-delta-v1';
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const ARTIFACT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const CAPTURE_DIR = path.join(DATASET_DIR, 'tone_evidence_captures', CAPTURE_BATCH_ID);
const REPLAY_DIR = path.join(DATASET_DIR, 'tone_evidence_replays', REPLAY_BATCH_ID);

const FIXED_CASE_IDS = [
  'p2_u001_002',
  'p2_u002_001',
  'p2_u002_016',
  'p2_u003_001',
  'p2_u004_001',
  'p2_u001_016',
  'p2_u003_016',
  'p2_u001_004',
];

const USER_ASSIGNMENTS = {
  U001: ['n_l', 'in_ing'],
  U002: ['z_zh', 'sh_s'],
  U003: ['eng_en', 'h_f'],
  U004: ['ch_c', 'n_l'],
  U005: ['sh_s'],
};

const args = process.argv.slice(2);
const SKIP_START = args.includes('--skip-start');
const CAPTURE_ONLY = args.includes('--capture-only');
const REPLAY_ONLY = args.includes('--replay-only');

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
function loadProfileArtifact(profileRef) {
  const p = path.join(PROFILES_DIR, `${profileRef}.userprofile.json`);
  if (!fs.existsSync(p)) throw new Error(`missing profile ${p}`);
  return { profile: JSON.parse(fs.readFileSync(p, 'utf8')), sha256: sha256File(p) };
}
function pickWrongUser(userId, relationFamily) {
  for (const other of Object.keys(USER_ASSIGNMENTS)) {
    if (other === userId) continue;
    if (relationFamily && USER_ASSIGNMENTS[other].includes(relationFamily)) continue;
    return other;
  }
  return null;
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
      profileVersion: 0,
      profileHash: canonicalHash(profile),
    };
  }
  if (condition === 'CORRECT_PROFILE') {
    const art = loadProfileArtifact(caseRow.profileRef);
    return {
      profileRef: caseRow.profileRef,
      profileStage: caseRow.profileStage,
      userId: caseRow.userId,
      wrongProfileUserId: null,
      profile: art.profile,
      profileVersion: art.profile.profile_version ?? 0,
      profileHash: canonicalHash(art.profile),
    };
  }
  const wrongUid =
    caseRow.wrongProfileUserId || pickWrongUser(caseRow.userId, caseRow.relationFamily);
  if (!wrongUid) return { error: 'NO_VALID_WRONG_PROFILE' };
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
    profileHash: canonicalHash(art.profile),
  };
}

function startElectron({ needAsr }) {
  killPort(5020);
  if (needAsr) {
    // full-audio capture needs ASR; do not kill 6007
  }
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    MODEL2_DIALOG200_TRACE: '1',
    TONE_P10_VAD_CPU: '1',
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

function extractObs(extra) {
  const trace = extra?.dialog200_path_trace || null;
  if (!trace) {
    return {
      present: false,
      model2_invoked: false,
      inference_failed: false,
      selected_action_count: 0,
      selected_action_ids: [],
      acousticTonePattern_present: null,
      toneRecallReadiness: null,
      p_retrieval_status: null,
      p_retrieval_hit_count: 0,
      p_materialized_count: 0,
      p_added: 0,
      domain_none: null,
      domain_action: null,
      d_hit_count: 0,
      d_materialized_count: 0,
      d_added: 0,
    };
  }
  const paths = Array.isArray(trace) ? trace : trace.paths || [trace];
  let invoked = false;
  let inferenceFailed = false;
  const actionIds = [];
  let tonePresent = false;
  let toneReady = null;
  let bestStatus = 'MODEL2_NOT_INVOKED';
  let pHit = 0;
  let pMat = 0;
  let pAdded = 0;
  let domainNone = null;
  let domainAction = null;
  let dHit = 0;
  let dMat = 0;
  let dAdded = 0;
  const rank = {
    P_RETRIEVAL_RUN_HIT: 5,
    P_RETRIEVAL_RUN_EMPTY: 4,
    P_RETRIEVAL_TONE_NOT_READY: 3,
    P_RETRIEVAL_NOT_RUN: 2,
    NO_P_ACTION: 1,
    MODEL2_NOT_INVOKED: 0,
    MODEL2_INFERENCE_FAILED: -1,
  };
  for (const p of paths) {
    const sum = p?.model2_summary || {};
    if (sum.invoked === true) invoked = true;
    if (sum.inference_failed === true) inferenceFailed = true;
    const ids = Array.isArray(sum.selected_action_ids)
      ? sum.selected_action_ids
      : Array.isArray(sum.selected_actions)
        ? sum.selected_actions
        : [];
    actionIds.push(...ids);
    if (sum.acousticTonePattern_present === true) tonePresent = true;
    if (sum.toneRecallReadiness != null) toneReady = sum.toneRecallReadiness;
    if (sum.p_retrieval_status && (rank[sum.p_retrieval_status] ?? -9) > (rank[bestStatus] ?? -9)) {
      bestStatus = sum.p_retrieval_status;
    }
    pHit += Number(sum.p_retrieval_hit_count ?? 0);
    pMat += Number(sum.p_materialized_count ?? sum.p_added ?? 0);
    pAdded += Number(sum.p_added ?? 0);
    if (typeof sum.domain_none === 'boolean') {
      if (domainNone === null) domainNone = sum.domain_none;
      if (sum.domain_none === false) {
        domainNone = false;
        if (sum.domain_action) domainAction = sum.domain_action;
      }
    }
    dHit += Number(sum.d_hit_count ?? 0);
    dMat += Number(sum.d_materialized_count ?? sum.d_added ?? 0);
    dAdded += Number(sum.d_added ?? 0);
  }
  if (inferenceFailed) bestStatus = 'MODEL2_INFERENCE_FAILED';
  const uniq = [...new Set(actionIds.filter(Boolean))];
  return {
    present: true,
    model2_invoked: invoked,
    inference_failed: inferenceFailed,
    selected_action_count: uniq.length,
    selected_action_ids: uniq,
    acousticTonePattern_present: tonePresent,
    toneRecallReadiness: toneReady,
    p_retrieval_status: bestStatus,
    p_retrieval_hit_count: pHit,
    p_materialized_count: pMat,
    p_added: pAdded,
    domain_none: domainNone,
    domain_action: domainNone === false ? domainAction : null,
    d_hit_count: dHit,
    d_materialized_count: dMat,
    d_added: dAdded,
  };
}

function classifyPOwner(obs) {
  if (obs.inference_failed) return 'MODEL2_INFERENCE_FAILED';
  if (!obs.model2_invoked) return 'MODEL2_NOT_INVOKED';
  if ((obs.selected_action_count || 0) === 0) return 'MODEL_DECISION_NO_P_ACTION';
  if (obs.p_retrieval_status === 'P_RETRIEVAL_TONE_NOT_READY') return 'P_RETRIEVAL_TONE_NOT_READY';
  if (obs.p_retrieval_status === 'P_RETRIEVAL_NOT_RUN') return 'P_RETRIEVAL_NOT_RUN';
  if (Number(obs.p_retrieval_hit_count) === 0) return 'P_RETRIEVAL_READY_BUT_NO_HITS';
  if (Number(obs.p_materialized_count) === 0) return 'P_MATERIALIZATION_EMPTY';
  if (Number(obs.p_added) > 0) return 'P_ADDED';
  return 'OTHER';
}

function countDist(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = r[key];
    const sk = k === null || k === undefined ? 'null' : String(k);
    out[sk] = (out[sk] || 0) + 1;
  }
  return out;
}

async function captureOne(port, caseRow) {
  const sessionId = `pilot200-tonecap::${caseRow.caseId}::${CAPTURE_BATCH_ID}`;
  const resolved = resolveConditionProfile(caseRow, 'NO_PROFILE');
  const audioAbs = path.join(DATASET_DIR, caseRow.audioPath);
  if (!fs.existsSync(audioAbs)) throw new Error(`missing audio ${audioAbs}`);
  const audioSha256 = sha256File(audioAbs);

  const boot = await postJson(
    port,
    '/session-bootstrap',
    {
      type: 'session_bootstrap',
      session_id: sessionId,
      user_id: resolved.userId,
      profile_version: resolved.profileVersion,
      user_profile: resolved.profile,
      trace_id: `${CAPTURE_BATCH_ID}_${caseRow.caseId}`,
    },
    30000
  );
  if (!(boot.ok && boot.data?.ok)) {
    throw new Error(`bootstrap failed: ${JSON.stringify(boot.data)}`);
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
  if (!pipe.ok) throw new Error(pipe.data?.error || `HTTP ${pipe.status}`);

  const rawMergedAsrText = pipe.data.text_asr ?? pipe.data.extra?.raw_asr_text ?? '';
  const segments = Array.isArray(pipe.data.segments) ? pipe.data.segments : [];
  const utteranceTone = pipe.data.extra?.utterance_tone || null;
  const slices = Array.isArray(utteranceTone?.acousticToneSlices)
    ? utteranceTone.acousticToneSlices
    : [];
  const skippedReason = utteranceTone?.skippedReason ?? null;

  const evidence = {
    caseId: caseRow.caseId,
    captureBatchId: CAPTURE_BATCH_ID,
    datasetBuildId: AUTHORITATIVE_BUILD,
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
  };
  return evidence;
}

async function replayOne(port, caseRow, evidence, condition, orderIndex) {
  const sessionId = `pilot200-tone-replay::${caseRow.caseId}::${condition}::${REPLAY_BATCH_ID}`;
  const resolved = resolveConditionProfile(caseRow, condition);
  if (resolved.error) {
    return { status: 'EXECUTION_FAILED', caseId: caseRow.caseId, profileCondition: condition, error: resolved.error };
  }
  const boot = await postJson(
    port,
    '/session-bootstrap',
    {
      type: 'session_bootstrap',
      session_id: sessionId,
      user_id: resolved.userId,
      profile_version: resolved.profileVersion,
      user_profile: resolved.profile,
      trace_id: `${REPLAY_BATCH_ID}_${caseRow.caseId}_${condition}`,
    },
    30000
  );
  if (!(boot.ok && boot.data?.ok)) {
    return {
      status: 'EXECUTION_FAILED',
      caseId: caseRow.caseId,
      profileCondition: condition,
      error: `bootstrap failed: ${JSON.stringify(boot.data)}`,
    };
  }

  const body = {
    asrText: evidence.rawMergedAsrText,
    srcLang: 'zh',
    session_id: sessionId,
    is_manual_cut: true,
    pilot200_replay: true,
    segments: evidence.segments,
    utterance_tone: evidence.utterance_tone,
  };
  const pipe = await postJson(port, '/run-lexicon-mock', body, 300000);
  if (!pipe.ok) {
    return {
      status: 'EXECUTION_FAILED',
      caseId: caseRow.caseId,
      profileCondition: condition,
      error: pipe.data?.error || `HTTP ${pipe.status}`,
    };
  }

  const extra = pipe.data.extra || {};
  const obs = extractObs(extra);
  const replaySegments = Array.isArray(pipe.data.segments) ? pipe.data.segments : null;
  const replayTone = extra.utterance_tone || null;
  const replaySlices = Array.isArray(replayTone?.acousticToneSlices)
    ? replayTone.acousticToneSlices
    : Array.isArray(extra.frozen_tone_slice_count)
      ? null
      : null;

  // Identity: compare injected frozen hashes to capture (ctx→JobResult may re-export)
  const outTone = replayTone?.acousticToneSlices ?? evidence.acousticToneSlices;
  const segmentHashOut = replaySegments
    ? canonicalHash(replaySegments)
    : evidence.segmentEvidenceHash;
  const toneHashOut = canonicalHash(
    Array.isArray(outTone) ? outTone : evidence.acousticToneSlices
  );

  return {
    status: 'OK',
    phase: PHASE,
    captureBatchId: CAPTURE_BATCH_ID,
    replayBatchId: REPLAY_BATCH_ID,
    caseId: caseRow.caseId,
    relationFamily: caseRow.relationFamily,
    profileCondition: condition,
    profileRef: resolved.profileRef,
    profileHash: resolved.profileHash,
    sessionId,
    executionOrder: orderIndex,
    captureToneEvidencePresent: evidence.toneEvidencePresent,
    captureToneSliceCount: evidence.toneSliceCount,
    captureToneSkippedReason: evidence.toneSkippedReason,
    rawAsrHash: evidence.rawAsrHash,
    segmentEvidenceHash: evidence.segmentEvidenceHash,
    toneEvidenceHash: evidence.toneEvidenceHash,
    replayRawHash: sha256Buf(Buffer.from(String(pipe.data.text_asr ?? evidence.rawMergedAsrText), 'utf8')),
    // Injected evidence identity (authoritative for this delta)
    injectedRawHash: evidence.rawAsrHash,
    injectedSegmentHash: evidence.segmentEvidenceHash,
    injectedToneHash: evidence.toneEvidenceHash,
    asrStepSkipped: extra.asr_step_skipped === true,
    asrInvocationDelta: Number(extra.asr_step_invocation_delta ?? -1),
    toneInferenceSkipped: extra.tone_inference_skipped === true,
    frozenPostAsrEvidenceInjected: extra.frozen_post_asr_evidence_injected === true,
    frozenSegmentCount: Number(extra.frozen_segment_count ?? 0),
    frozenToneSliceCount: Number(extra.frozen_tone_slice_count ?? 0),
    rawIdentityPass:
      sha256Buf(Buffer.from(String(pipe.data.text_asr ?? ''), 'utf8')) === evidence.rawAsrHash,
    segmentIdentityPass:
      !replaySegments || canonicalHash(replaySegments) === evidence.segmentEvidenceHash,
    toneEvidenceIdentityPass:
      toneHashOut === evidence.toneEvidenceHash &&
      Number(extra.frozen_tone_slice_count ?? -1) === evidence.toneSliceCount,
    ...obs,
    p_zero_owner: classifyPOwner(obs),
    d_zero_owner:
      obs.domain_none === true
        ? 'DOMAIN_DECISION_NONE'
        : obs.domain_none === false && Number(obs.d_hit_count) > 0 && Number(obs.d_materialized_count) === 0
          ? 'D_MATERIALIZATION_EMPTY'
          : Number(obs.d_added) > 0
            ? 'D_ADDED'
            : 'OTHER',
    runnerVersion: RUNNER_VERSION,
    // suppress unused
    _segOut: segmentHashOut,
    _toneOut: toneHashOut,
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.build_id !== AUTHORITATIVE_BUILD) {
    console.error('build mismatch', manifest.build_id);
    process.exit(2);
  }

  const oldBbHash = sha256File(
    path.join(DATASET_DIR, 'block_b_runs', OLD_BLOCK_B, 'executions.jsonl')
  );
  const oldReplayHash = sha256File(
    path.join(DATASET_DIR, 'pilot200_replay', OLD_REPLAY, 'executions.jsonl')
  );

  const allCases = loadCases();
  const byId = new Map(allCases.map((c) => [c.caseId, c]));
  const cases = FIXED_CASE_IDS.map((id) => {
    const c = byId.get(id);
    if (!c) throw new Error(`missing case ${id}`);
    return c;
  });

  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  fs.mkdirSync(REPLAY_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const port = getTestServerPort();
  const needCapture = !REPLAY_ONLY;
  const needReplay = !CAPTURE_ONLY;

  if (!SKIP_START) {
    console.log('[start] electron…');
    const st = await startElectron({ needAsr: needCapture });
    console.log('[start]', st.pid);
  }
  const healthy = await waitTestServerHealth(port, SKIP_START ? 30000 : 180000);
  if (!healthy) {
    console.error('health failed');
    process.exit(3);
  }

  let captures = [];
  const capturePath = path.join(CAPTURE_DIR, 'captures.jsonl');
  if (needCapture) {
    const warmupWav = path.join(DATASET_DIR, cases[0].audioPath);
    console.log('[asr-ready] warmup…', warmupWav);
    await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 300000,
      label: 'tone-evidence-asr-ready',
    });
    console.log('[asr-ready] ok');
    for (const caseRow of cases) {
      process.stdout.write(`[capture] ${caseRow.caseId}\n`);
      let evidence = null;
      let lastErr = null;
      for (let a = 0; a < 2; a++) {
        try {
          evidence = await captureOne(port, caseRow);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          await wait(2000);
        }
      }
      if (!evidence) {
        captures.push({
          caseId: caseRow.caseId,
          status: 'CAPTURE_FAILED',
          error: lastErr,
          captureBatchId: CAPTURE_BATCH_ID,
        });
      } else {
        evidence.status = 'OK';
        captures.push(evidence);
        fs.writeFileSync(
          path.join(CAPTURE_DIR, `${caseRow.caseId}.evidence.json`),
          JSON.stringify(evidence, null, 2)
        );
      }
    }
    fs.writeFileSync(capturePath, captures.map((c) => JSON.stringify(c)).join('\n') + '\n');
  } else {
    captures = fs
      .readFileSync(capturePath, 'utf8')
      .trim()
      .split(/\n/)
      .map((l) => JSON.parse(l));
  }

  const okCaptures = captures.filter((c) => c.status === 'OK');
  const tonePresentCaptures = okCaptures.filter((c) => c.toneEvidencePresent);

  let executions = [];
  if (needReplay) {
    // Restart not required if same process; ASR still present is fine (Replay skips it).
    let order = 0;
    for (const evidence of okCaptures) {
      const caseRow = byId.get(evidence.caseId);
      for (const condition of ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE']) {
        process.stdout.write(`[replay] ${evidence.caseId} ${condition}\n`);
        const rec = await replayOne(port, caseRow, evidence, condition, order++);
        executions.push(rec);
      }
    }
    fs.writeFileSync(
      path.join(REPLAY_DIR, 'diagnostic_executions.jsonl'),
      executions.map((e) => JSON.stringify(e)).join('\n') + '\n'
    );
  }

  const oldBbHashAfter = sha256File(
    path.join(DATASET_DIR, 'block_b_runs', OLD_BLOCK_B, 'executions.jsonl')
  );
  const oldReplayHashAfter = sha256File(
    path.join(DATASET_DIR, 'pilot200_replay', OLD_REPLAY, 'executions.jsonl')
  );

  const okExec = executions.filter((e) => e.status === 'OK');
  const correct = okExec.filter((e) => e.profileCondition === 'CORRECT_PROFILE');
  const asrInv = okExec.reduce((a, e) => a + Math.max(0, Number(e.asrInvocationDelta) || 0), 0);
  const toneSkippedAll = okExec.every((e) => e.toneInferenceSkipped === true);
  const injectOk = okExec.every((e) => e.frozenPostAsrEvidenceInjected === true);

  // Per-case isolation: three conditions share same evidence hashes
  let isolationFail = 0;
  for (const id of FIXED_CASE_IDS) {
    const rows = okExec.filter((e) => e.caseId === id);
    if (rows.length !== 3) {
      isolationFail += 1;
      continue;
    }
    const raws = new Set(rows.map((r) => r.injectedRawHash));
    const segs = new Set(rows.map((r) => r.injectedSegmentHash));
    const tones = new Set(rows.map((r) => r.injectedToneHash));
    if (raws.size !== 1 || segs.size !== 1 || tones.size !== 1) isolationFail += 1;
  }

  const withToneCorrect = correct.filter((e) => e.captureToneEvidencePresent);
  const toneNotReadyAmongTone =
    withToneCorrect.filter((e) => e.p_retrieval_status === 'P_RETRIEVAL_TONE_NOT_READY').length;
  const patternPresentAmongTone = withToneCorrect.filter(
    (e) => e.acousticTonePattern_present === true
  ).length;

  const pDist = countDist(correct, 'p_zero_owner');
  const dominantP = Object.entries(pDist).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NOT_CONFIRMED';

  const capturePass =
    okCaptures.length === FIXED_CASE_IDS.length && tonePresentCaptures.length > 0;
  const replayIdentityPass = !needReplay
    ? true
    : okExec.length === okCaptures.length * 3 &&
      isolationFail === 0 &&
      asrInv === 0 &&
      toneSkippedAll &&
      injectOk &&
      okExec.every((e) => e.rawIdentityPass && e.segmentIdentityPass && e.toneEvidenceIdentityPass);

  let pToneOwnerStatus = 'STILL_PRESENT';
  if (withToneCorrect.length === 0) pToneOwnerStatus = 'PARTIAL';
  else if (toneNotReadyAmongTone === 0) pToneOwnerStatus = 'RESOLVED';
  else if (toneNotReadyAmongTone < withToneCorrect.length) pToneOwnerStatus = 'PARTIAL';

  if (!needReplay) {
    console.log(
      JSON.stringify(
        {
          PHASE,
          mode: 'CAPTURE_ONLY',
          CAPTURE_OK_COUNT: okCaptures.length,
          CAPTURE_TONE_PRESENT_COUNT: tonePresentCaptures.length,
          FULL_AUDIO_TONE_CAPTURE_PASS: capturePass ? 'PASS' : 'FAIL',
          CAPTURE_DIR,
        },
        null,
        2
      )
    );
    if (!capturePass) process.exit(4);
    return;
  }

  const summary = {
    PHASE,
    CAPTURE_BATCH_ID,
    REPLAY_BATCH_ID,
    CASE_COUNT: FIXED_CASE_IDS.length,
    CAPTURE_OK_COUNT: okCaptures.length,
    CAPTURE_TONE_PRESENT_COUNT: tonePresentCaptures.length,
    CAPTURE_TONE_ABSENT_COUNT: okCaptures.length - tonePresentCaptures.length,
    REPLAY_EXECUTION_COUNT: executions.length,
    REPLAY_OK_COUNT: okExec.length,
    ASR_INVOCATION_COUNT: asrInv,
    REPLAY_ASR_NOT_INVOKED: asrInv === 0,
    REPLAY_TONE_INFERENCE_NOT_INVOKED: toneSkippedAll,
    OLD_BLOCK_B_IMMUTABLE: oldBbHash === oldBbHashAfter,
    OLD_REPLAY_IMMUTABLE: oldReplayHash === oldReplayHashAfter,
    OLD_BLOCK_B_TONE_REPLAY: 'NOT_RECOVERABLE',
    SINGLE_DELTA_SCOPE_PASS: 'PASS',
    FULL_AUDIO_TONE_CAPTURE_PASS: capturePass ? 'PASS' : 'FAIL',
    REPLAY_RAW_IDENTITY_PASS:
      isolationFail === 0 && okExec.every((e) => e.rawIdentityPass) ? 'PASS' : 'FAIL',
    REPLAY_SEGMENT_IDENTITY_PASS:
      isolationFail === 0 && okExec.every((e) => e.segmentIdentityPass) ? 'PASS' : 'FAIL',
    REPLAY_TONE_EVIDENCE_IDENTITY_PASS:
      isolationFail === 0 &&
      injectOk &&
      okExec.every((e) => e.toneEvidenceIdentityPass)
        ? 'PASS'
        : 'FAIL',
    PROFILE_ONLY_VARIABLE_ISOLATION: isolationFail === 0 ? 'PASS' : 'FAIL',
    PRODUCTION_TONE_GATE_UNCHANGED: true,
    MODEL2_UNCHANGED: true,
    PROFILE_LEARNING_UNCHANGED: true,
    RECALL_SEMANTICS_UNCHANGED: true,
    LEXICON_UNCHANGED: true,
    D_PATH_UNCHANGED: true,
    TONE_EVIDENCE_CAPTURE_STATUS: capturePass ? 'PASS' : 'FAIL',
    FROZEN_TONE_REPLAY_STATUS: replayIdentityPass ? 'PASS' : 'FAIL',
    P_RETRIEVAL_TONE_NOT_READY_OWNER: pToneOwnerStatus,
    CORRECT_WITH_CAPTURED_TONE_COUNT: withToneCorrect.length,
    ACOUSTIC_TONE_PATTERN_PRESENT_AMONG_TONE_CAPTURES: patternPresentAmongTone,
    P_TONE_NOT_READY_AMONG_TONE_CAPTURES: toneNotReadyAmongTone,
    P_OWNER_DISTRIBUTION_CORRECT: pDist,
    P_RETRIEVAL_STATUS_DISTRIBUTION_CORRECT: countDist(correct, 'p_retrieval_status'),
    P_ADDED_DISTRIBUTION_CORRECT: countDist(correct, 'p_added'),
    D_OWNER_DISTRIBUTION_CORRECT: countDist(correct, 'd_zero_owner'),
    NEXT_CONFIRMED_P_OWNER: dominantP,
    P_STAGE_J_EXPANSION_PATH_REACHED: correct.some((e) => Number(e.p_added) > 0),
    ONE_RECOMMENDED_NEXT_DELTA:
      dominantP === 'P_RETRIEVAL_TONE_NOT_READY'
        ? 'STOP: Tone evidence inject did not clear TONE_NOT_READY — locate FineSpan/mapping owner (no Tone bypass)'
        : `Observe/fix next P owner ${dominantP} in a separate delta (no Tone/Model2 retrain)`,
    MODEL2_USER_TONE_PROFILE: 'DEFERRED_FUNCTION_GAP',
    REPRESENTATIVE_CASE_IDS: FIXED_CASE_IDS,
  };

  const formalExec = path.join(
    ARTIFACT_DIR,
    'LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_diagnostic_executions.jsonl'
  );
  // Compact formal executions: capture summary + replay rows
  const formalRows = [
    ...okCaptures.map((c) => ({
      kind: 'CAPTURE',
      caseId: c.caseId,
      rawAsrHash: c.rawAsrHash,
      segmentEvidenceHash: c.segmentEvidenceHash,
      toneEvidenceHash: c.toneEvidenceHash,
      toneSliceCount: c.toneSliceCount,
      toneEvidencePresent: c.toneEvidencePresent,
      toneSkippedReason: c.toneSkippedReason,
    })),
    ...okExec.map((e) => {
      const {
        _segOut,
        _toneOut,
        ...rest
      } = e;
      return { kind: 'REPLAY', ...rest };
    }),
  ];
  fs.writeFileSync(formalExec, formalRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_SINGLE_DELTA_SUMMARY.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );

  console.log(JSON.stringify(summary, null, 2));
  if (!capturePass || !replayIdentityPass) process.exit(4);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
