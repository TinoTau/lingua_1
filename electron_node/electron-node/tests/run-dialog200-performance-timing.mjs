#!/usr/bin/env node
/**
 * READ-ONLY performance timing dump for MODEL3_RETRY_PERFORMANCE_CAUSAL_BREAKDOWN_AUDIT.
 * Captures already-emitted timing fields from pipeline responses.
 * Does NOT change production code.
 *
 * Modes:
 *   --mode production  (default): single Model3 path; NO causal/dual fork
 *   --mode acceptance: same dual-weight causal fork as Delta2 Acceptance
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

const BASELINE = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
};
const A1 = {
  modelId: 'MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_exp_class_weight_a1_rerun1/seed_2026083013',
  expectedWeightsSha256:
    '2d1c763249d5fca5c7586ea41868e391cc70e495069b5bab5f2e5905982e1bd0',
};

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
const modeIdx = args.indexOf('--mode');
const MODE = modeIdx >= 0 ? String(args[modeIdx + 1] || 'production') : 'production';
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 360;
})();
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function verifyCheckpoint(spec) {
  const weights = path.join(REPO, spec.checkpointDirRelative, 'weights.pt');
  const digest = sha256File(weights).toLowerCase();
  if (digest !== spec.expectedWeightsSha256) throw new Error(`sha_mismatch:${spec.modelId}`);
  return digest;
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-perf-${MODE}-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function extractTiming(caseDef, data, wallMs) {
  const extra = data.extra || {};
  const trace = extra.dialog200_path_trace || {};
  const causal = trace.acceptance_causal || null;
  const paths = trace.paths || [];
  let model3Sum = 0;
  let retrySum = 0;
  let regionCount = 0;
  let recallInv = 0;
  let pathCount = paths.length;
  for (const p of paths) {
    const m3 = p.model3 || {};
    if (typeof m3.model3_latency_ms === 'number') model3Sum += m3.model3_latency_ms;
    if (typeof m3.retry_path_latency_ms === 'number') retrySum += m3.retry_path_latency_ms;
    regionCount += (m3.retry_regions || []).length;
    recallInv += (m3.retry_recall_invocations || []).length;
  }
  const fw = extra.fw_detector || {};
  const kenlmMs =
    typeof fw.kenlmVetoMs === 'number'
      ? fw.kenlmVetoMs
      : typeof fw.kenlmTiming?.batchMs === 'number'
        ? fw.kenlmTiming.batchMs
        : null;
  return {
    phase: 'MODEL3_RETRY_PERFORMANCE_CAUSAL_BREAKDOWN_AUDIT',
    mode: MODE,
    caseId: caseDef.id,
    wall_harness_ms: wallMs,
    pipeline_ms: extra.pipeline_ms ?? null,
    fw_detector_step_ms: extra.fw_detector_step_ms ?? null,
    asr_service_id: extra.asr_service_id ?? null,
    raw_asr_len: String(extra.raw_asr_text || '').length,
    model3_latency_ms_sum: model3Sum,
    retry_path_latency_ms_sum: retrySum,
    kenlm_ms: kenlmMs,
    kenlm_query_count: fw.kenlmVetoQueryCount ?? fw.kenlmTiming?.queryCount ?? null,
    path_count: pathCount,
    retry_region_count: regionCount,
    retry_recall_invocation_count: recallInv,
    baseline_post_fork_ms_sum: causal?.baseline_post_fork_ms_sum ?? null,
    s3_post_fork_ms_sum: causal?.s3_post_fork_ms_sum ?? null,
    model3_inference_ms_sum_causal: causal?.model3_inference_ms_sum ?? null,
    dual_fork_active: Boolean(causal),
    snapshot_ok: paths.length > 0,
  };
}

async function startServer(port) {
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    TONE_P10_VAD_CPU: '1',
    MODEL3_CHECKPOINT_IDENTITY: BASELINE.modelId,
    MODEL2_DIALOG200_TRACE: '1',
    MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
  };
  delete env.MODEL3_HARNESS_KEEP_ALL;
  if (MODE === 'acceptance') {
    env.MODEL3_BASELINE_CHECKPOINT_IDENTITY = BASELINE.modelId;
    env.MODEL3_CANDIDATE_CHECKPOINT_IDENTITY = A1.modelId;
    env.MODEL3_ACCEPTANCE_CAUSAL_FORK = '1';
    env.MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT = '1';
    env.MODEL3_INFERENCE_INPUT_TRACE = '1';
  } else {
    // production-equivalent single pass
    delete env.MODEL3_ACCEPTANCE_CAUSAL_FORK;
    delete env.MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT;
    delete env.MODEL3_BASELINE_CHECKPOINT_IDENTITY;
    delete env.MODEL3_CANDIDATE_CHECKPOINT_IDENTITY;
  }
  spawn(process.execPath, [START_DETACHED, String(port)], {
    cwd: ELECTRON,
    env,
    detached: true,
    stdio: 'ignore',
  }).unref();
  await waitTestServerHealth(port, 120000);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  verifyCheckpoint(BASELINE);
  if (MODE === 'acceptance') verifyCheckpoint(A1);
  console.log(JSON.stringify({ mode: MODE }, null, 2));

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  if (!skipStart) {
    if (!skipBuild) {
      const b = spawnSync('npm', ['run', 'build:main'], {
        cwd: ELECTRON,
        stdio: 'inherit',
        shell: true,
      });
      if (b.status !== 0) process.exit(1);
    }
    await startServer(port);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: `perf-${MODE}-asr`,
    });
    if (!asr.ready) {
      console.error('ASR FAIL', asr.lastError);
      process.exit(1);
    }
  }

  const outJsonl = path.join(OUT_DIR, 'model3_retry_performance_timing_raw.jsonl');
  fs.writeFileSync(outJsonl, '');
  console.log(`[perf] cases=${cases.length} mode=${MODE} → ${outJsonl}`);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  let n = 0;
  for (const caseDef of cases) {
    if (Date.now() >= deadline) break;
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      const rec = extractTiming(caseDef, data, Date.now() - t0);
      fs.appendFileSync(outJsonl, JSON.stringify(rec) + '\n');
      n += 1;
      console.log(
        `[${caseDef.id}] pipe=${rec.pipeline_ms} fw=${rec.fw_detector_step_ms} m3=${rec.model3_latency_ms_sum} retry=${rec.retry_path_latency_ms_sum} kenlm=${rec.kenlm_ms} fork=${rec.dual_fork_active} q=${rec.retry_recall_invocation_count}`
      );
    } catch (e) {
      fs.appendFileSync(
        outJsonl,
        JSON.stringify({ caseId: caseDef.id, error: String(e.message || e), snapshot_ok: false }) +
          '\n'
      );
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }
  console.log(`[perf] done n=${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
