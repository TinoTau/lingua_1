#!/usr/bin/env node
/**
 * MODEL3_V2_RETRY_RECALL_QUERY_PARITY_AUDIT — DIAGNOSTIC_REPLAY trace collector
 * Saves per-invocation retry_recall_invocations for historical 84 cohort.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');
const POP_CSV = path.join(DOCS, 'model3_v2_local_reseg_population.csv');
const OUT_JSONL = path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl');
const MANIFEST = path.join(REPO, 'test wav', 'dialog_200', 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const FREEZE_PATH = path.join(DOCS, 'model3_v2_acceptance_harness_freeze_manifest.json');

const IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
};

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const skipBuild = args.includes('--skip-build');
const traceOff = args.includes('--trace-off');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER = new Set(
  caseIdsIdx >= 0
    ? String(args[caseIdsIdx + 1] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fs
        .readFileSync(POP_CSV, 'utf8')
        .trim()
        .split('\n')
        .slice(1)
        .map((l) => l.split(',')[0])
);

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex').toLowerCase();
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-query-parity-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

async function main() {
  fs.mkdirSync(DOCS, { recursive: true });
  const freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  if (freeze.verdict !== 'ACCEPTANCE_HARNESS_FREEZE_PASS') process.exit(2);
  const digest = sha256File(path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt'));
  if (digest !== IDENTITY.expectedWeightsSha256) process.exit(2);

  if (!skipBuild) {
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
  }

  const port = getTestServerPort();
  if (!skipStart) {
    killPort(6007);
    killPort(5020);
    const env = {
      ...process.env,
      PROJECT_ROOT: REPO,
      TONE_P10_VAD_CPU: '1',
      MODEL3_CHECKPOINT_IDENTITY: IDENTITY.modelId,
      MODEL3_ACCEPTANCE_CAUSAL_FORK: '1',
      MODEL3_INFERENCE_INPUT_TRACE: '1',
    };
    if (!traceOff) env.MODEL2_DIALOG200_TRACE = '1';
    delete env.MODEL3_HARNESS_KEEP_ALL;
    spawn(process.execPath, [START_DETACHED, String(port)], {
      cwd: ELECTRON,
      env,
      detached: true,
      stdio: 'ignore',
    }).unref();
    await waitTestServerHealth(port, 120000);
    const { cases: casesAll } = loadDialog200Manifest(MANIFEST);
    const warmupWav = path.join(
      REPO,
      'test wav',
      'dialog_200',
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asrReady = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'query-parity-replay-asr',
    });
    if (!asrReady.ready) process.exit(1);
  }

  const { cases: casesAll } = loadDialog200Manifest(MANIFEST);
  const byId = new Map(casesAll.map((c) => [c.id, c]));
  const out = fs.createWriteStream(OUT_JSONL, { flags: traceOff ? 'a' : 'w' });
  for (const id of CASE_FILTER) {
    const caseDef = byId.get(id);
    if (!caseDef) continue;
    const wavPath = path.join(
      REPO,
      'test wav',
      'dialog_200',
      resolveDialog200AudioFile(caseDef) || caseDef.file
    );
    if (!fs.existsSync(wavPath)) continue;
    try {
      const data = await runCase(port, wavPath, `${id}-${Date.now()}`);
      const extra = data.extra || {};
      const trace = extra.dialog200_path_trace || {};
      const causal =
        extra.fw_detector?.spanAssemblyV4?.model2PathTrace?.acceptance_causal ||
        trace.acceptance_causal ||
        {};
      const paths = (trace.paths || []).map((p) => ({
        path_id: p.path_id,
        retained_domains: p.domain_vote?.retained_domains || p.model3?.retained_domains || [],
        retry_regions: p.model3?.retry_regions || [],
        retry_recall_invocations: p.model3?.retry_recall_invocations || [],
      }));
      const rec = {
        label: traceOff ? 'DIAGNOSTIC_REPLAY_TRACE_OFF' : 'DIAGNOSTIC_REPLAY',
        caseId: id,
        expected: String(caseDef.expectedText || caseDef.utterance || '').trim(),
        raw_asr: String(extra.raw_asr_text || '').trim(),
        final_text: String(data.text_asr || '').trim(),
        baseline_final: String(causal.baseline_final_text ?? '').trim(),
        s3_final: String(causal.s3_final_text ?? data.text_asr ?? '').trim(),
        baseline_kenlm_fp: causal.baseline_kenlm_pool_fingerprint ?? null,
        s3_kenlm_fp: causal.s3_kenlm_pool_fingerprint ?? null,
        paths,
      };
      out.write(`${JSON.stringify(rec)}\n`);
      console.log(`[${id}] invocations=${paths.reduce((s, p) => s + (p.retry_recall_invocations?.length || 0), 0)}`);
    } catch (e) {
      out.write(`${JSON.stringify({ caseId: id, error: e.message, label: 'DIAGNOSTIC_REPLAY_ERROR' })}\n`);
      console.error(`[${id}] ${e.message}`);
    }
  }
  out.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
