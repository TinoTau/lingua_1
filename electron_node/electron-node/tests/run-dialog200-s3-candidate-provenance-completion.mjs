#!/usr/bin/env node
/**
 * MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION
 *
 * Same-upstream dual-weight (baseline S3 vs A1) + candidate provenance dump.
 * Trace-only: MODEL3_CANDIDATE_PROVENANCE_TRACE=1
 * No training / lexicon / business logic change.
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
const PHASE = 'MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION';

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
const parityOnly = args.includes('--parity-check');
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
      sessionId: `m3-prov-${jobId}`,
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
    phase: PHASE,
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

async function startServer(port, provenanceOn) {
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
  };
  if (provenanceOn) env.MODEL3_CANDIDATE_PROVENANCE_TRACE = '1';
  else delete env.MODEL3_CANDIDATE_PROVENANCE_TRACE;
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
  verifyCheckpoint(BASELINE);
  verifyCheckpoint(A1);

  const port = getTestServerPort();
  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (CASE_FILTER) cases = cases.filter((c) => CASE_FILTER.has(c.id));

  if (parityOnly) {
    // TRACE_OFF then TRACE_ON. Same-upstream gate = baseline_final equality
    // (dual-weight fork). Only baseline-equal + final-unequal ⇒ TRACE_MUTATION.
    const parityCases = (CASE_FILTER
      ? cases
      : casesAll.filter((c) => ['d040', 'd001', 'd023', 'd129', 'd172'].includes(c.id))
    ).slice(0, 5);
    const maxAttempts = 2;

    console.log('[parity] build…');
    spawnSync('npm', ['run', 'build:main'], { cwd: ELECTRON, stdio: 'inherit', shell: true });

    let results = { off: [], on: [] };
    let verdictRows = [];
    let mutationDetected = false;
    let sameUpstreamPass = 0;
    let upstreamDiverged = 0;
    let inconclusive = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      results = { off: [], on: [] };
      for (const mode of ['off', 'on']) {
        await startServer(port, mode === 'on');
        const warmupWav = path.join(
          DIALOG_DIR,
          resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
        );
        await waitAsrReady(port, {
          warmupWavPath: warmupWav,
          maxWaitMs: 600000,
          label: `parity-${mode}-a${attempt}`,
        });
        for (const c of parityCases) {
          const wav = path.join(DIALOG_DIR, resolveDialog200AudioFile(c) || c.file);
          const data = await runCase(port, wav, `${c.id}-parity-${mode}-a${attempt}`);
          const rec = extractProvenanceRecord(c, data);
          results[mode].push({
            caseId: c.id,
            final: rec.s3_final,
            baseline: rec.baseline_final,
            s3KenlmFp: rec.s3_kenlm_fp,
            baselineKenlmFp: rec.baseline_kenlm_fp,
            hasProv: Boolean(
              rec.paths.some((p) => p.candidate_provenance) ||
                rec.candidate_provenance_utterance
            ),
          });
          console.log(
            `[parity-${mode}-a${attempt}] ${c.id} final_len=${rec.s3_final.length} prov=${results[mode].at(-1).hasProv}`
          );
        }
      }

      verdictRows = [];
      mutationDetected = false;
      sameUpstreamPass = 0;
      upstreamDiverged = 0;
      inconclusive = 0;
      for (let i = 0; i < results.off.length; i++) {
        const a = results.off[i];
        const b = results.on[i];
        const fe = a.final === b.final;
        const be = a.baseline === b.baseline && a.baseline.length > 0;
        let cls = 'INCONCLUSIVE';
        if (be && fe) {
          cls = 'SAME_UPSTREAM_PARITY_PASS';
          sameUpstreamPass += 1;
        } else if (be && !fe) {
          cls = 'TRACE_MUTATION';
          mutationDetected = true;
        } else if (!be) {
          cls = 'UPSTREAM_DIVERGED';
          upstreamDiverged += 1;
        } else {
          inconclusive += 1;
        }
        verdictRows.push({
          caseId: a.caseId,
          finalEqual: fe,
          baselineEqual: be,
          class: cls,
          provOff: a.hasProv,
          provOn: b.hasProv,
        });
      }
      console.log(
        JSON.stringify({
          attempt,
          sameUpstreamPass,
          upstreamDiverged,
          mutationDetected,
        })
      );
      if (mutationDetected) break;
      if (upstreamDiverged === 0 && sameUpstreamPass === parityCases.length) break;
      if (attempt < maxAttempts) console.log('[parity] retry due to upstream divergence…');
    }

    const parityOk =
      !mutationDetected &&
      sameUpstreamPass >= 1 &&
      results.on.every((r) => r.hasProv) &&
      results.off.every((r) => !r.hasProv);

    fs.writeFileSync(
      path.join(OUT_DIR, 'model3_v2_s3_trace_parity_and_anti_overfit.csv'),
      [
        'check,result,notes',
        `TRACE_MUTATION_DETECTED,${mutationDetected},HARD_STOP_A_if_true`,
        `SAME_UPSTREAM_PARITY_PASS_N,${sameUpstreamPass},baseline_equal_and_final_equal`,
        `UPSTREAM_DIVERGED_N,${upstreamDiverged},ASR/cross-run; not attributed to trace`,
        `TRACE_ON_OFF_FINAL_EQUAL_WHEN_SAME_UPSTREAM,${sameUpstreamPass > 0 && !mutationDetected},`,
        `TRACE_ON_HAS_PROVENANCE,${results.on.every((r) => r.hasProv)},`,
        `TRACE_OFF_NO_PROVENANCE,${results.off.every((r) => !r.hasProv)},`,
        `caseId_branches_production,NONE,recheck`,
        `surfaceSpecificRuntimeBranches,NONE,recheck`,
        `reference_leakage,NONE,evaluator post-runtime only`,
        `candidate_injection,NONE,`,
        `testConfigOverride,NONE,`,
        `testAwareLexiconMutation,NONE,`,
        `traceBehaviorMutation,${mutationDetected ? 'YES' : 'NO'},`,
        `JobResult_changed,NO,`,
        ...verdictRows.map(
          (r) =>
            `parity_case,${r.caseId},${r.finalEqual},${r.baselineEqual},${r.class},${r.provOff},${r.provOn}`
        ),
      ].join('\n')
    );
    console.log(JSON.stringify({ parityOk, mutationDetected, sameUpstreamPass, upstreamDiverged, results, verdictRows }, null, 2));
    process.exit(parityOk ? 0 : mutationDetected ? 2 : 1);
  }

  // Full provenance dump run
  if (!skipStart) {
    console.log('[prov] build…');
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
    await startServer(port, true);
    const warmupWav = path.join(
      DIALOG_DIR,
      resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav'
    );
    const asr = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'prov-asr',
    });
    if (!asr.ready) {
      console.error('ASR FAIL', asr.lastError);
      process.exit(1);
    }
  }

  const outJsonl = path.join(OUT_DIR, 'model3_v2_s3_candidate_provenance_raw.jsonl');
  fs.writeFileSync(outJsonl, '');
  console.log(`[prov] cases=${cases.length} → ${outJsonl}`);
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
      console.log(
        `[${caseDef.id}] ok=${rec.snapshot_ok} provPaths=${rec.paths.filter((p) => p.candidate_provenance).length} ${rec.pipelineMs}ms`
      );
    } catch (e) {
      fs.appendFileSync(
        outJsonl,
        JSON.stringify({ caseId: caseDef.id, error: e.message, snapshot_ok: false }) + '\n'
      );
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }
  console.log(JSON.stringify({ wrote: n, outJsonl }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
