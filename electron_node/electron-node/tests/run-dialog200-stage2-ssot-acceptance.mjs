#!/usr/bin/env node
/**
 * MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE — AFTER provenance dump.
 * Writes to a NEW jsonl; does NOT overwrite frozen BEFORE provenance.
 * READ-ONLY acceptance harness: no production logic change.
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
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 360;
})();

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
      sessionId: `m3-s2acc-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function extractProvenanceRecord(caseDef, data) {
  const extra = data.extra || {};
  const trace = extra.dialog200_path_trace || {};
  const causal = trace.acceptance_causal || null;
  const paths = trace.paths || [];
  const pathProv = paths.map((p) => ({
    path_id: p.path_id,
    candidate_provenance: p.model3?.candidate_provenance ?? null,
    baseline_candidate_provenance: p.model3?.acceptance_causal?.baseline_candidate_provenance ?? null,
    decisions: p.model3?.decisions ?? null,
    retry_regions: p.model3?.retry_regions ?? null,
    retry_recall_invocations: p.model3?.retry_recall_invocations ?? null,
    assembly_sentences: (p.assembly?.sentences || []).map((s) => s.text || s),
  }));
  return {
    phase: 'MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE',
    caseId: caseDef.id,
    expected: String(caseDef.expectedText || caseDef.utterance || '').trim(),
    raw_asr: String(extra.raw_asr_text || '').trim(),
    baseline_final: String(causal?.baseline_final_text ?? '').trim(),
    s3_final: String(data.text_asr || causal?.s3_final_text || '').trim(),
    baseline_kenlm_fp: causal?.baseline_kenlm_pool_fingerprint ?? null,
    s3_kenlm_fp: causal?.s3_kenlm_pool_fingerprint ?? null,
    candidate_provenance_utterance: trace.candidate_provenance_utterance ?? null,
    paths: pathProv,
    snapshot_ok: Boolean(causal) && pathProv.length > 0,
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
    MODEL3_BASELINE_CHECKPOINT_IDENTITY: BASELINE.modelId,
    MODEL3_CANDIDATE_CHECKPOINT_IDENTITY: A1.modelId,
    MODEL2_DIALOG200_TRACE: '1',
    MODEL3_ACCEPTANCE_CAUSAL_FORK: '1',
    MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT: '1',
    MODEL3_INFERENCE_INPUT_TRACE: '1',
    MODEL3_CANDIDATE_PROVENANCE_TRACE: '1',
  };
  delete env.MODEL3_HARNESS_KEEP_ALL;
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
  const baseSha = verifyCheckpoint(BASELINE);
  const a1Sha = verifyCheckpoint(A1);
  console.log(JSON.stringify({ baselineSha: baseSha, a1Sha }, null, 2));

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));

  if (!skipStart) {
    console.log('[s2acc] build…');
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
    await startServer(port);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 's2acc-asr',
    });
    if (!asr.ready) {
      console.error('ASR FAIL', asr.lastError);
      process.exit(1);
    }
  }

  const outJsonl = path.join(OUT_DIR, 'model3_retry_stage2_acceptance_after_raw.jsonl');
  fs.writeFileSync(outJsonl, '');
  console.log(`[s2acc] cases=${cases.length} → ${outJsonl}`);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  let n = 0;
  for (const caseDef of cases) {
    if (Date.now() >= deadline) break;
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      const rec = extractProvenanceRecord(caseDef, data);
      rec.pipelineMs = Date.now() - t0;
      fs.appendFileSync(outJsonl, JSON.stringify(rec) + '\n');
      n += 1;
      const rr = (rec.paths || []).flatMap((p) => p.retry_regions || []);
      const inv = (rec.paths || []).flatMap((p) => p.retry_recall_invocations || []);
      console.log(
        `[${caseDef.id}] ok=${rec.snapshot_ok} regions=${rr.length} recalls=${inv.length} ${rec.pipelineMs}ms`
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
  console.log(`[s2acc] done n=${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
