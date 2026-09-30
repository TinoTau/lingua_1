#!/usr/bin/env node
/**
 * MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE
 *
 * Requires Phase A freeze PASS (MODEL3_ACCEPTANCE_HARNESS_V1_20260831).
 * Uses ONLY the frozen causal fork:
 *   MODEL3_ACCEPTANCE_CAUSAL_FORK=1
 *   one upstream → BASELINE KEEP + S3 actionable
 *
 * Does NOT train / retune / change Retry / Recall / Assembly / KenLM / JobResult.
 * Does NOT auto-promote.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm } from './lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');
const FREEZE_PATH = path.join(OUT_DIR, 'model3_v2_acceptance_harness_freeze_manifest.json');

const IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
};

const HARNESS_VERSION = 'MODEL3_ACCEPTANCE_HARNESS_V1_20260831';

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 240;
})();

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function levenshtein(a, b) {
  const s = a || '';
  const t = b || '';
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-final-causal-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

/**
 * Analyze one case from frozen causal fork response.
 * Units are explicit (RAW_PATH_RETRY_SPAN, LOGICAL_UNIQUE_RETRY_SPAN, …).
 */
function analyzeCase(caseDef, data) {
  const extra = data.extra || {};
  const trace = extra.dialog200_path_trace || {};
  const causal = trace.acceptance_causal || null;
  const paths = trace.paths || [];
  const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();
  const rawAsr = String(extra.raw_asr_text || '').trim();
  const s3Final = String(data.text_asr || causal?.s3_final_text || '').trim();
  const baselineFinal = String(causal?.baseline_final_text ?? '').trim();
  const nExp = norm(expected);
  const nBase = norm(baselineFinal);
  const nS3 = norm(s3Final);
  const nRaw = norm(rawAsr);

  let baselinePacked = 0;
  let s3Packed = 0;
  let secondVote = 0;
  let anchorRetry = 0;
  let anchorMutation = 0;
  let recursiveModel3 = 0;
  let model3InferenceMs = 0;
  let rawPathRetry = 0;
  let logicalRetryKeys = new Set();
  let retryRegions = 0;
  let retryRoutingAttempts = 0;
  let candidateReturnEvents = 0;
  let zeroCandidateRegions = 0;
  let assemblySentenceTexts = [];
  const pathParity = [];

  for (const p of paths) {
    const m3 = p.model3 || {};
    const ac = m3.acceptance_causal;
    if (ac) {
      pathParity.push({
        pathId: p.path_id,
        upstreamHash: ac.upstream_hash,
        packedHash: ac.packed_hash,
        mutationIsolated: ac.mutation_isolated,
        baselinePostForkMs: ac.baseline_post_fork_ms,
        s3PostForkMs: ac.s3_post_fork_ms,
      });
      baselinePacked += Array.isArray(ac.baseline_inference_input_trace)
        ? ac.baseline_inference_input_trace.length
        : 0;
      s3Packed += Array.isArray(m3.inference_input_trace) ? m3.inference_input_trace.length : 0;
    }
    if ((m3.vote_call_count || 0) > 1) secondVote += 1;
    anchorMutation += Number(m3.anchor_mutation_violations || 0);
    model3InferenceMs += Number(m3.model3_latency_ms || 0);

    for (const d of m3.decisions || []) {
      if (d.isAnchor && d.decision === 'RETRY') anchorRetry += 1;
      if (d.decision === 'RETRY' && !d.isAnchor) {
        rawPathRetry += 1;
        const key = `${d.start ?? d.rawStart ?? ''}|${d.end ?? d.rawEnd ?? ''}|${d.surface || ''}`;
        logicalRetryKeys.add(key);
      }
    }
    for (const a of m3.retry_attempts || []) {
      if (a.attempted) retryRoutingAttempts += 1;
      if (a.attempted && (a.returnedCandidateCount || 0) > 0) candidateReturnEvents += 1;
    }
    for (const r of m3.retry_regions || []) {
      retryRegions += 1;
      if ((r.recallCandidatesReturned || 0) === 0) zeroCandidateRegions += 1;
      if (r.model3Reinvoked) recursiveModel3 += 1;
      if (r.secondDomainVote) secondVote += 1;
    }
    for (const s of p.assembly?.sentences || []) {
      if (s?.text) assemblySentenceTexts.push(String(s.text));
    }
  }

  const pool = extra?.fw_detector?.spanAssemblyV4?.kenlmPoolCandidateCount;
  const kenlmGt16 = pool != null && pool > 16 ? 1 : 0;
  const baselinePoolSize = causal?.baseline_kenlm_pool_size ?? null;
  const s3PoolSize = causal?.s3_kenlm_pool_size ?? pool ?? null;
  const baselinePoolFp = causal?.baseline_kenlm_pool_fingerprint ?? null;
  const s3PoolFp = causal?.s3_kenlm_pool_fingerprint ?? null;
  const poolChanged =
    baselinePoolFp != null && s3PoolFp != null
      ? baselinePoolFp !== s3PoolFp
      : baselinePoolSize != null && s3PoolSize != null
        ? baselinePoolSize !== s3PoolSize
        : false;

  const allMutIsolated = pathParity.length > 0 && pathParity.every((p) => p.mutationIsolated);
  const packedSym =
    baselinePacked > 0 && s3Packed > 0 && baselinePacked === s3Packed;
  const parityPass =
    Boolean(causal) &&
    pathParity.length > 0 &&
    allMutIsolated &&
    packedSym &&
    secondVote === 0 &&
    anchorRetry === 0 &&
    recursiveModel3 === 0 &&
    kenlmGt16 === 0;

  const db = nExp ? levenshtein(nBase, nExp) : null;
  const ds = nExp ? levenshtein(nS3, nExp) : null;
  let outcome = 'INDETERMINATE';
  if (baselineFinal && nExp) {
    if (ds < db) outcome = 'IMPROVED';
    else if (ds > db) outcome = 'REGRESSED';
    else if (nBase === nS3) outcome = 'UNCHANGED';
    else outcome = 'INDETERMINATE';
  }

  const caseWithAnyRetry = rawPathRetry > 0;
  const anyCandidateReturn = candidateReturnEvents > 0;

  // Viable repair candidate: an Assembly sentence closer to reference than baseline final.
  let viableInAssembly = false;
  let bestAssemblyDist = db;
  for (const t of assemblySentenceTexts) {
    const d = nExp ? levenshtein(norm(t), nExp) : null;
    if (d != null && db != null && d < db) {
      viableInAssembly = true;
      if (bestAssemblyDist == null || d < bestAssemblyDist) bestAssemblyDist = d;
    }
  }

  let unchangedSubtype = '';
  if (outcome === 'UNCHANGED') {
    if (!caseWithAnyRetry) unchangedSubtype = 'UNCHANGED_NO_RETRY';
    else if (!anyCandidateReturn) unchangedSubtype = 'UNCHANGED_RETRY_NO_CANDIDATE';
    else if (!poolChanged) unchangedSubtype = 'UNCHANGED_RETRY_CANDIDATE_NO_ASSEMBLY_CHANGE';
    else if (poolChanged && nBase === nS3)
      unchangedSubtype = 'UNCHANGED_RETRY_ASSEMBLY_CHANGED_WINNER_SAME';
    else unchangedSubtype = 'UNCHANGED_RETRY_INTERNAL_CHANGE_FINAL_SAME';
  }

  const baselineAlreadyCorrect = nExp.length > 0 && nBase === nExp;
  // Rescuable: baseline wrong vs reference; Model3/Retry architecture could act (packed non-anchor exists).
  const model3Rescuable =
    Boolean(nExp) && !baselineAlreadyCorrect && s3Packed > 0 && db != null && db > 0;

  // Signal-loss stage for zero-final-change / non-improvement on rescuable cases.
  let signalLossStage = 'NONE';
  let signalLossOwner = 'NONE';
  if (outcome === 'IMPROVED') {
    signalLossStage = 'NONE';
    signalLossOwner = 'NO_BLOCKER';
  } else if (baselineAlreadyCorrect) {
    signalLossStage = 'BASELINE_ALREADY_CORRECT_OR_EQUIVALENT';
    signalLossOwner = 'BASELINE_ALREADY_CORRECT';
  } else if (!caseWithAnyRetry && model3Rescuable) {
    signalLossStage = 'MODEL3_TRIGGER_NO_USEFUL_TARGET';
    signalLossOwner = 'MODEL3_TRIGGER';
  } else if (caseWithAnyRetry && !anyCandidateReturn) {
    signalLossStage = 'RECALL_NO_VIABLE_CANDIDATE';
    // Spec: zero-candidate is NOT automatically Recall failure — mark as mixed evidence.
    signalLossOwner = 'RECALL_OR_NO_VIABLE_SURFACE';
  } else if (caseWithAnyRetry && anyCandidateReturn && !poolChanged) {
    signalLossStage = 'ASSEMBLY_DROPS_VIABLE_CANDIDATE';
    signalLossOwner = poolChanged === false && viableInAssembly ? 'ASSEMBLY' : 'ASSEMBLY_OR_REGION';
    if (!viableInAssembly) {
      signalLossStage = 'RETRY_REGION_NO_USEFUL_REINTERPRETATION';
      signalLossOwner = 'RETRY_REGION';
    }
  } else if (caseWithAnyRetry && poolChanged && viableInAssembly && outcome !== 'IMPROVED') {
    signalLossStage = 'KENLM_REJECTS_VIABLE_CANDIDATE';
    signalLossOwner = 'KENLM';
  } else if (caseWithAnyRetry && poolChanged && !viableInAssembly && outcome === 'UNCHANGED') {
    signalLossStage = 'RETRY_REGION_NO_USEFUL_REINTERPRETATION';
    signalLossOwner = 'RETRY_REGION';
  } else if (outcome === 'UNCHANGED' && !model3Rescuable) {
    signalLossStage = 'TESTSET_HAS_NO_MODEL3_RESCUABLE_CASES';
    signalLossOwner = 'NO_REPAIRABLE_TARGET_OR_BASELINE_OK';
  } else if (outcome === 'REGRESSED') {
    if (viableInAssembly && nS3 !== nExp) {
      signalLossStage = 'KENLM_REJECTS_VIABLE_CANDIDATE';
      signalLossOwner = 'KENLM';
    } else if (!anyCandidateReturn) {
      signalLossStage = 'RECALL_NO_VIABLE_CANDIDATE';
      signalLossOwner = 'UNKNOWN';
    } else {
      signalLossStage = 'MIXED';
      signalLossOwner = 'UNKNOWN';
    }
  } else {
    signalLossStage = 'MIXED';
    signalLossOwner = 'UNKNOWN';
  }

  // False RETRY business impact (case-level summary when any RETRY).
  let falseRetryImpact = 'UNKNOWN';
  if (!caseWithAnyRetry) falseRetryImpact = 'N_A';
  else if (outcome === 'REGRESSED') falseRetryImpact = 'FINAL_REGRESSION';
  else if (outcome === 'IMPROVED') falseRetryImpact = 'ACCIDENTAL_IMPROVEMENT_OR_TRUE_REPAIR';
  else if (outcome === 'UNCHANGED') {
    const retryInc =
      (causal?.s3_post_fork_ms_sum ?? 0) - (causal?.baseline_post_fork_ms_sum ?? 0);
    falseRetryImpact = retryInc > 1 ? 'LATENCY_ONLY_EFFECT' : 'NO_FINAL_EFFECT';
  }

  const baselinePostForkMs = causal?.baseline_post_fork_ms_sum ?? null;
  const s3PostForkMs = causal?.s3_post_fork_ms_sum ?? null;
  const retryIncrementalMs =
    baselinePostForkMs != null && s3PostForkMs != null
      ? s3PostForkMs - baselinePostForkMs
      : null;
  const model3InfMs =
    causal?.model3_inference_ms_sum != null ? causal.model3_inference_ms_sum : model3InferenceMs;
  const totalIncrementMs =
    model3InfMs != null && retryIncrementalMs != null
      ? model3InfMs + Math.max(0, retryIncrementalMs)
      : null;

  return {
    caseId: caseDef.id,
    parityPass,
    snapshotCaptured: Boolean(causal),
    pathCount: pathParity.length,
    mutationIsolated: allMutIsolated,
    baselinePacked,
    s3Packed,
    packedSymmetric: packedSym,
    outcome,
    unchangedSubtype,
    baselineFinal,
    s3Final,
    expected,
    rawAsr,
    distBaseline: db,
    distS3: ds,
    baselineAlreadyCorrect,
    model3Rescuable,
    caseWithAnyRetry,
    rawPathRetrySpans: rawPathRetry,
    logicalUniqueRetrySpans: logicalRetryKeys.size,
    retryRegions,
    retryRoutingAttempts,
    candidateReturnEvents,
    zeroCandidateRegions,
    anyCandidateReturn,
    poolChanged,
    viableInAssembly,
    baselinePoolSize,
    s3PoolSize,
    kenlmGt16,
    secondVote,
    anchorRetry,
    anchorMutation,
    recursiveModel3,
    signalLossStage,
    signalLossOwner,
    falseRetryImpact,
    baselinePostForkMs,
    s3PostForkMs,
    retryIncrementalMs,
    model3InferenceMs: model3InfMs,
    totalModel3MainlineIncrementMs: totalIncrementMs,
    harnessVersion: causal?.harness_version || HARNESS_VERSION,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- Phase A gate ----
  if (!fs.existsSync(FREEZE_PATH)) {
    console.error('HARD STOP A: freeze manifest missing');
    process.exit(2);
  }
  const freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  if (freeze.verdict !== 'ACCEPTANCE_HARNESS_FREEZE_PASS') {
    console.error('HARD STOP A: freeze verdict not PASS', freeze.verdict);
    process.exit(2);
  }
  if (freeze.harnessIdentity?.harnessVersion !== HARNESS_VERSION) {
    console.error('HARD STOP A: harness identity mismatch');
    process.exit(2);
  }

  const weights = path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt');
  const digest = sha256File(weights).toLowerCase();
  if (digest !== IDENTITY.expectedWeightsSha256) {
    console.error('S3 SHA mismatch', digest);
    process.exit(2);
  }

  delete process.env.MODEL3_HARNESS_KEEP_ALL;

  if (!skipStart) {
    console.log('[final-causal] build:main…');
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
    killPort(6007);
    killPort(5020);
  } else {
    console.log('[final-causal] --skip-start: reuse running server');
  }

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));

  if (!skipStart) {
    const env = {
      ...process.env,
      PROJECT_ROOT: REPO,
      TONE_P10_VAD_CPU: '1',
      MODEL3_CHECKPOINT_IDENTITY: IDENTITY.modelId,
      MODEL2_DIALOG200_TRACE: '1',
      MODEL3_ACCEPTANCE_CAUSAL_FORK: '1',
      MODEL3_INFERENCE_INPUT_TRACE: '1',
    };
    delete env.MODEL3_HARNESS_KEEP_ALL;
    spawn(process.execPath, [START_DETACHED, String(port)], {
      cwd: ELECTRON,
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
    await waitTestServerHealth(port, 120000);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asrReady = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'final-causal-asr-warmup',
    });
    if (!asrReady.ready) {
      console.error('ASR FAIL', asrReady.lastError);
      process.exit(1);
    }
    console.log('[preflight] ASR READY', asrReady.elapsedMs, 'ms');
  }

  console.log(`[final-causal] cases=${cases.length} harness=${HARNESS_VERSION}`);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const rows = [];

  for (const caseDef of cases) {
    if (Date.now() >= deadline) break;
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    if (!fs.existsSync(wavPath)) {
      rows.push({ caseId: caseDef.id, error: 'missing_wav', parityPass: false, outcome: 'INDETERMINATE' });
      continue;
    }
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      const row = analyzeCase(caseDef, data);
      row.pipelineMs = Date.now() - t0;
      rows.push(row);
      console.log(
        `[${caseDef.id}] parity=${row.parityPass} outcome=${row.outcome} subtype=${row.unchangedSubtype || '-'} retry=${row.rawPathRetrySpans} ${row.pipelineMs}ms`
      );
    } catch (e) {
      rows.push({
        caseId: caseDef.id,
        error: e.message,
        parityPass: false,
        outcome: 'INDETERMINATE',
      });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  // ---- Aggregates ----
  const parityPassN = rows.filter((r) => r.parityPass).length;
  const capturedN = rows.filter((r) => r.snapshotCaptured).length;
  const packedSymN = rows.filter((r) => r.packedSymmetric).length;
  const parityRows = rows.filter((r) => r.parityPass);

  const outcomes = { IMPROVED: 0, UNCHANGED: 0, REGRESSED: 0, INDETERMINATE: 0 };
  const subtypes = {};
  for (const r of parityRows) {
    outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
    if (r.unchangedSubtype) subtypes[r.unchangedSubtype] = (subtypes[r.unchangedSubtype] || 0) + 1;
  }

  const baselineCorrectN = parityRows.filter((r) => r.baselineAlreadyCorrect).length;
  const rescuable = parityRows.filter((r) => r.model3Rescuable);
  const rescuableN = rescuable.length;
  const rescTriggered = rescuable.filter((r) => r.caseWithAnyRetry);
  const rescCand = rescuable.filter((r) => r.anyCandidateReturn);
  const rescViable = rescuable.filter((r) => r.viableInAssembly);
  const rescPoolChanged = rescuable.filter((r) => r.poolChanged);
  const rescImproved = rescuable.filter((r) => r.outcome === 'IMPROVED');
  // KenLM selected viable repair ≈ IMPROVED (winner changed toward reference).
  const rescKenlmSelected = rescImproved;

  const rawRetryTotal = parityRows.reduce((s, r) => s + (r.rawPathRetrySpans || 0), 0);
  const logicalRetryTotal = parityRows.reduce((s, r) => s + (r.logicalUniqueRetrySpans || 0), 0);
  const regionTotal = parityRows.reduce((s, r) => s + (r.retryRegions || 0), 0);
  const caseAnyRetry = parityRows.filter((r) => r.caseWithAnyRetry).length;
  const candReturnTotal = parityRows.reduce((s, r) => s + (r.candidateReturnEvents || 0), 0);
  const regionsWithCand = parityRows.reduce(
    (s, r) => s + Math.max(0, (r.retryRegions || 0) - (r.zeroCandidateRegions || 0)),
    0
  );

  // Dominant signal-loss among non-improved parity cases (prefer rescuable).
  const lossCounter = {};
  for (const r of parityRows.filter((x) => x.outcome !== 'IMPROVED')) {
    const k = r.signalLossStage || 'MIXED';
    lossCounter[k] = (lossCounter[k] || 0) + 1;
  }
  const dominantLoss = Object.entries(lossCounter).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE';

  const ownerCounter = {};
  for (const r of rescuable.filter((x) => x.outcome !== 'IMPROVED')) {
    const k = r.signalLossOwner || 'UNKNOWN';
    ownerCounter[k] = (ownerCounter[k] || 0) + 1;
  }
  const dominantOwner =
    Object.entries(ownerCounter).sort((a, b) => b[1] - a[1])[0]?.[0] || 'NONE';

  const falseImpact = {};
  for (const r of parityRows.filter((x) => x.caseWithAnyRetry)) {
    falseImpact[r.falseRetryImpact] = (falseImpact[r.falseRetryImpact] || 0) + 1;
  }

  const infMs = parityRows.map((r) => r.model3InferenceMs).filter((x) => x != null);
  const retryMs = parityRows.map((r) => r.retryIncrementalMs).filter((x) => x != null);
  const totalMs = parityRows
    .map((r) => r.totalModel3MainlineIncrementMs)
    .filter((x) => x != null);

  const secondVoteTotal = rows.reduce((s, r) => s + (r.secondVote || 0), 0);
  const anchorRetryTotal = rows.reduce((s, r) => s + (r.anchorRetry || 0), 0);
  const anchorMutTotal = rows.reduce((s, r) => s + (r.anchorMutation || 0), 0);
  const recursiveTotal = rows.reduce((s, r) => s + (r.recursiveModel3 || 0), 0);
  const capViol = rows.reduce((s, r) => s + (r.kenlmGt16 || 0), 0);
  const maxBasePool = Math.max(0, ...parityRows.map((r) => r.baselinePoolSize || 0));
  const maxS3Pool = Math.max(0, ...parityRows.map((r) => r.s3PoolSize || 0));
  const hit16 = parityRows.filter((r) => (r.s3PoolSize || 0) >= 16).length;

  const archPass =
    parityPassN === rows.length &&
    rows.length === 200 &&
    !CASE_FILTER &&
    secondVoteTotal === 0 &&
    anchorRetryTotal === 0 &&
    recursiveTotal === 0 &&
    capViol === 0;

  const qualitySafety =
    outcomes.REGRESSED === 0 && outcomes.INDETERMINATE === 0 ? 'PASS' : 'FAIL';
  const qualityUtility =
    outcomes.IMPROVED > 0 ? 'PASS' : 'NOT_DEMONSTRATED';

  const latencyConcern =
    (pct(totalMs, 0.95) ?? 0) > 200 || (pct(retryMs, 0.95) ?? 0) > 150 ? 'CONCERN' : 'PASS';

  let verdict;
  let nextPhase;
  let primaryOwner = dominantOwner;

  if (!archPass || parityPassN !== 200) {
    verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_ARCHITECTURE_FAILURE';
    nextPhase = 'MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION';
    primaryOwner = 'HARNESS';
  } else if (outcomes.REGRESSED > 0) {
    // Prefer specific owner from regressions
    const regOwners = {};
    for (const r of parityRows.filter((x) => x.outcome === 'REGRESSED')) {
      regOwners[r.signalLossOwner] = (regOwners[r.signalLossOwner] || 0) + 1;
    }
    primaryOwner = Object.entries(regOwners).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
    if (primaryOwner === 'KENLM') verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_KENLM';
    else if (primaryOwner === 'ASSEMBLY' || primaryOwner === 'ASSEMBLY_OR_REGION')
      verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_ASSEMBLY';
    else if (primaryOwner.includes('RECALL'))
      verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_RECALL';
    else if (primaryOwner === 'RETRY_REGION')
      verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_RETRY_REGION';
    else if (primaryOwner === 'MODEL3_TRIGGER')
      verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_MODEL3_TRIGGER';
    else verdict = 'STOP_AND_REVIEW';
    nextPhase =
      primaryOwner === 'KENLM'
        ? 'MODEL3_V2_KENLM_SIGNAL_LOSS_AUDIT'
        : primaryOwner.includes('RECALL')
          ? 'MODEL3_V2_RECALL_SIGNAL_LOSS_AUDIT'
          : primaryOwner === 'ASSEMBLY' || primaryOwner === 'ASSEMBLY_OR_REGION'
            ? 'MODEL3_V2_ASSEMBLY_SIGNAL_LOSS_AUDIT'
            : 'MODEL3_V2_TRIGGER_UTILITY_AUDIT';
  } else if (qualityUtility === 'PASS' && qualitySafety === 'PASS' && latencyConcern === 'PASS') {
    verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_PASS_READY_FOR_PROMOTION';
    nextPhase = 'MODEL3_V2_S3_PRODUCTION_PROMOTION_AND_RUNTIME_FREEZE';
    primaryOwner = 'NO_BLOCKER';
  } else if (qualitySafety === 'PASS' && qualityUtility === 'NOT_DEMONSTRATED') {
    verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_SAFE_BUT_UTILITY_NOT_DEMONSTRATED';
    // Map dominant owner → next phase
    if (dominantOwner === 'KENLM') nextPhase = 'MODEL3_V2_KENLM_SIGNAL_LOSS_AUDIT';
    else if (dominantOwner.includes('RECALL')) nextPhase = 'MODEL3_V2_RECALL_SIGNAL_LOSS_AUDIT';
    else if (dominantOwner === 'ASSEMBLY' || dominantOwner === 'ASSEMBLY_OR_REGION')
      nextPhase = 'MODEL3_V2_ASSEMBLY_SIGNAL_LOSS_AUDIT';
    else if (dominantOwner === 'RETRY_REGION') nextPhase = 'MODEL3_V2_RETRY_REGION_SIGNAL_LOSS_AUDIT';
    else nextPhase = 'MODEL3_V2_TRIGGER_UTILITY_AUDIT';
    primaryOwner = dominantOwner;
  } else if (latencyConcern === 'CONCERN') {
    verdict = 'S3_FINAL_CAUSAL_ACCEPTANCE_BLOCKED_BY_LATENCY';
    nextPhase = 'MODEL3_V2_TRIGGER_UTILITY_AUDIT';
  } else {
    verdict = 'STOP_AND_REVIEW';
    nextPhase = 'MODEL3_V2_TRIGGER_UTILITY_AUDIT';
  }

  // ---- Artifacts (Phase B only; freeze already written) ----
  const caseCsv = [
    [
      'caseId',
      'outcome',
      'unchangedSubtype',
      'parityPass',
      'baselineAlreadyCorrect',
      'model3Rescuable',
      'rawPathRetrySpans',
      'logicalUniqueRetrySpans',
      'retryRegions',
      'candidateReturnEvents',
      'poolChanged',
      'viableInAssembly',
      'signalLossStage',
      'signalLossOwner',
      'falseRetryImpact',
      'distBaseline',
      'distS3',
      'model3InferenceMs',
      'retryIncrementalMs',
      'totalIncrementMs',
    ].join(','),
  ];
  for (const r of rows) {
    caseCsv.push(
      [
        r.caseId,
        r.outcome,
        r.unchangedSubtype || '',
        r.parityPass,
        r.baselineAlreadyCorrect,
        r.model3Rescuable,
        r.rawPathRetrySpans ?? '',
        r.logicalUniqueRetrySpans ?? '',
        r.retryRegions ?? '',
        r.candidateReturnEvents ?? '',
        r.poolChanged,
        r.viableInAssembly,
        r.signalLossStage || '',
        r.signalLossOwner || '',
        r.falseRetryImpact || '',
        r.distBaseline ?? '',
        r.distS3 ?? '',
        r.model3InferenceMs ?? '',
        r.retryIncrementalMs ?? '',
        r.totalModel3MainlineIncrementMs ?? '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_s3_final_case_outcomes.csv'), caseCsv.join('\n'));

  const funnelCsv = [
    'stage,unit,count,notes',
    `utterances,CASE,${parityRows.length},parity-pass denominator`,
    `CASE_WITH_ANY_RETRY,CASE_WITH_ANY_RETRY,${caseAnyRetry},`,
    `LOGICAL_UNIQUE_RETRY_SPANS,LOGICAL_UNIQUE_RETRY_SPAN,${logicalRetryTotal},`,
    `RETRY_REGIONS,RETRY_REGION,${regionTotal},`,
    `regions_with_candidate_return,RETRY_REGION,${regionsWithCand},`,
    `CANDIDATE_RETURN_EVENTS,CANDIDATE_RETURN_EVENT,${candReturnTotal},`,
    `MODEL3_RESCUABLE_CASES,CASE,${rescuableN},baseline wrong + packed spans`,
    `rescuable_triggered,CASE,${rescTriggered.length},`,
    `rescuable_any_candidate_return,CASE,${rescCand.length},`,
    `rescuable_viable_in_assembly,CASE,${rescViable.length},sentence closer to ref than baseline`,
    `rescuable_pool_changed,CASE,${rescPoolChanged.length},`,
    `rescuable_kenlm_selected_repair,CASE,${rescKenlmSelected.length},approx IMPROVED`,
    `final_IMPROVED,CASE,${outcomes.IMPROVED},`,
    `final_REGRESSED,CASE,${outcomes.REGRESSED},`,
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_s3_rescuable_case_funnel.csv'), funnelCsv);

  const lossCsv = ['caseId,model3Rescuable,outcome,signalLossStage,signalLossOwner,falseRetryImpact'];
  for (const r of parityRows) {
    lossCsv.push(
      [r.caseId, r.model3Rescuable, r.outcome, r.signalLossStage, r.signalLossOwner, r.falseRetryImpact]
        .map(csvEscape)
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_s3_signal_loss_ownership.csv'), lossCsv.join('\n'));

  const latCsv = [
    'caseId,model3InferenceMs,retryIncrementalMs,totalModel3MainlineIncrementMs,baselinePostForkMs,s3PostForkMs',
  ];
  for (const r of parityRows) {
    latCsv.push(
      [
        r.caseId,
        r.model3InferenceMs ?? '',
        r.retryIncrementalMs ?? '',
        r.totalModel3MainlineIncrementMs ?? '',
        r.baselinePostForkMs ?? '',
        r.s3PostForkMs ?? '',
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_s3_final_latency.csv'), latCsv.join('\n'));

  const invariants = {
    phase: 'MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE',
    harnessVersion: HARNESS_VERSION,
    checks: {
      snapshotParity: `${parityPassN}/${rows.length}`,
      packedSymmetry: `${packedSymN}/${rows.length}`,
      secondDomainVote: secondVoteTotal,
      effectiveAnchorRetry: anchorRetryTotal,
      anchorMutation: anchorMutTotal,
      recursiveModel3: recursiveTotal,
      candidateCapViolations: capViol,
      baselineMaxPool: maxBasePool,
      s3MaxPool: maxS3Pool,
      casesHitting16: hit16,
      multipathPreserved: parityRows.every((r) => (r.pathCount || 0) >= 1),
      jobResultUnchanged: true,
      productionDualChain: false,
      model3StageSemantics:
        'ONE_MAINLINE_DECISION_STAGE_PER_UTTERANCE_MAY_EVALUATE_MULTIPLE_RETAINED_PATHS',
    },
    pass: archPass,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_acceptance_invariants.json'),
    JSON.stringify(invariants, null, 2)
  );

  const summary = {
    phase: 'MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE',
    timestamp: new Date().toISOString(),
    harnessFreeze: 'ACCEPTANCE_HARNESS_FREEZE_PASS',
    harnessVersion: HARNESS_VERSION,
    verdict,
    nextPhase,
    primaryOwner,
    s3Identity: {
      verified: true,
      modelId: IDENTITY.modelId,
      sha256: digest,
      datasetId: 'MODEL3_V2_PRODUCTION_CORE_S3',
      buildId: 'prod_core_s3_build_20260830_v1',
    },
    denominator: {
      requested: 200,
      completed: rows.length,
      parityPass: parityPassN,
      reportedAsDialog200: !CASE_FILTER && rows.length === 200 && parityPassN === 200,
    },
    quality: {
      IMPROVED: outcomes.IMPROVED,
      REGRESSED: outcomes.REGRESSED,
      UNCHANGED: outcomes.UNCHANGED,
      INDETERMINATE: outcomes.INDETERMINATE,
      unchangedSubtypes: subtypes,
    },
    baselineAlreadyCorrect: baselineCorrectN,
    rescuable: {
      total: rescuableN,
      triggered: rescTriggered.length,
      candidateReturn: rescCand.length,
      viableInAssembly: rescViable.length,
      poolChanged: rescPoolChanged.length,
      kenlmSelectedRepair: rescKenlmSelected.length,
      finalImproved: rescImproved.length,
    },
    retryDistribution: {
      RAW_PATH_RETRY_SPAN: rawRetryTotal,
      LOGICAL_UNIQUE_RETRY_SPAN: logicalRetryTotal,
      RETRY_REGION: regionTotal,
      CASE_WITH_ANY_RETRY: caseAnyRetry,
      CASE_WITH_ANY_RETRY_rate: parityRows.length ? caseAnyRetry / parityRows.length : 0,
      logicalRetryRateApprox:
        s3PackedApproxRate(parityRows, logicalRetryTotal),
    },
    falseRetryBusinessImpact: falseImpact,
    dominantSignalLossStage: dominantLoss,
    signalLossCounts: lossCounter,
    latency: {
      model3InferenceMs: {
        p50: pct(infMs, 0.5),
        p90: pct(infMs, 0.9),
        p95: pct(infMs, 0.95),
        max: infMs.length ? Math.max(...infMs) : null,
      },
      retryIncrementalMs: {
        p50: pct(retryMs, 0.5),
        p90: pct(retryMs, 0.9),
        p95: pct(retryMs, 0.95),
        max: retryMs.length ? Math.max(...retryMs) : null,
      },
      totalModel3MainlineIncrementMs: {
        p50: pct(totalMs, 0.5),
        p90: pct(totalMs, 0.9),
        p95: pct(totalMs, 0.95),
        max: totalMs.length ? Math.max(...totalMs) : null,
      },
    },
    acceptanceMatrix: {
      QUALITY_SAFETY: qualitySafety,
      QUALITY_UTILITY: qualityUtility,
      ARCHITECTURE: archPass ? 'PASS' : 'FAIL',
      LATENCY: latencyConcern,
      PROMOTION:
        verdict === 'S3_FINAL_CAUSAL_ACCEPTANCE_PASS_READY_FOR_PROMOTION'
          ? 'READY'
          : 'NOT_READY',
    },
    previousAcceptance: 'HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE',
    governance: {
      s3Changed: false,
      training: false,
      dataset: false,
      feature: false,
      threshold: false,
      retry: false,
      recall: false,
      assembly: false,
      kenlm: false,
      jobResult: false,
      asr: false,
      productionDualChain: false,
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_s3_final_causal_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        verdict,
        nextPhase,
        primaryOwner,
        outcomes,
        rescuableN,
        parityPassN,
        dominantLoss,
      },
      null,
      2
    )
  );
  process.exit(archPass ? 0 : 1);
}

function s3PackedApproxRate(parityRows, logicalRetryTotal) {
  // Approximate logical rate vs packed non-anchor spans if available via packed counts.
  const packed = parityRows.reduce((s, r) => s + (r.s3Packed || 0), 0);
  return packed > 0 ? logicalRetryTotal / packed : null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
