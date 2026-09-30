#!/usr/bin/env node
/**
 * MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION — single-upstream causal fork validation.
 *
 * ONE /run-pipeline-with-audio per case with:
 *   MODEL3_ACCEPTANCE_CAUSAL_FORK=1
 *   MODEL2_DIALOG200_TRACE=1
 *   MODEL3_CHECKPOINT_IDENTITY=MODEL3_V2_S3_RANDOM_INIT_V1
 *
 * Does NOT set MODEL3_HARNESS_KEEP_ALL (retired for causal A/B).
 * Does NOT promote. Does NOT tune Model3 / Retry / Assembly / KenLM.
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

const IDENTITY = {
  modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
  checkpointDirRelative:
    'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
  expectedWeightsSha256:
    'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
  expectedConfigHash: '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221',
};

const HARNESS_VERSION = 'MODEL3_ACCEPTANCE_HARNESS_V1_20260831';

/** Deterministic subset covering harness mechanics (not Model3 quality cherry-picks). */
const SUBSET_IDS = [
  'd001', 'd002', 'd003', 'd004', 'd005', 'd007', 'd008', 'd009', 'd010', 'd011',
  'd016', 'd019', 'd025', 'd026', 'd031', 'd044', 'd052', 'd064', 'd071', 'd084',
  'd100', 'd120', 'd140', 'd160', 'd176', 'd180', 'd190', 'd195', 'd198', 'd200',
];

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const subsetOnly = args.includes('--subset');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : subsetOnly
      ? new Set(SUBSET_IDS)
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

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-causal-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function extractCausal(extra) {
  const trace = extra?.dialog200_path_trace || null;
  const causal = trace?.acceptance_causal || null;
  const paths = trace?.paths || [];
  const pathParity = [];
  let baselinePacked = 0;
  let s3Packed = 0;
  let secondVote = 0;
  let anchorRetry = 0;
  let kenlmGt16 = 0;
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
      const bTrace = ac.baseline_inference_input_trace || [];
      const sTrace = m3.inference_input_trace || [];
      baselinePacked += Array.isArray(bTrace) ? bTrace.length : 0;
      s3Packed += Array.isArray(sTrace) ? sTrace.length : 0;
    }
    if ((m3.vote_call_count || 0) > 1) secondVote += 1;
    for (const d of m3.decisions || []) {
      if (d.isAnchor && d.decision === 'RETRY') anchorRetry += 1;
    }
  }
  const pool = extra?.fw_detector?.spanAssemblyV4?.kenlmPoolCandidateCount;
  if (pool != null && pool > 16) kenlmGt16 += 1;
  return {
    causal,
    pathParity,
    baselinePacked,
    s3Packed,
    secondVote,
    anchorRetry,
    kenlmGt16,
    baselineFinal: causal?.baseline_final_text ?? null,
    s3Final: causal?.s3_final_text ?? extra?.fw_detector
      ? String(/* filled below */ '')
      : null,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const weights = path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt');
  const digest = sha256File(weights);
  if (digest !== IDENTITY.expectedWeightsSha256) {
    console.error('S3 SHA mismatch', digest);
    process.exit(2);
  }

  // Ensure KEEP_ALL is not set — causal fork replaces that design.
  delete process.env.MODEL3_HARNESS_KEEP_ALL;

  // Rebuild only when starting a fresh Electron — avoid wiping dist under a live process.
  if (!skipStart) {
    console.log('[harness] build:main…');
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
    console.log('[harness] --skip-start: reuse running server (no rebuild)');
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
      label: 'acceptance-harness-asr-warmup',
    });
    if (!asrReady.ready) {
      console.error('ASR FAIL', asrReady.lastError);
      process.exit(1);
    }
    console.log('[preflight] ASR READY', asrReady.elapsedMs, 'ms');
  }

  console.log(`[harness] cases=${cases.length} subset=${Boolean(CASE_FILTER)} fork=ON`);

  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const rows = [];
  const determinism = [];

  // Determinism probe on first 3 cases: A1/A2
  const detCases = cases.slice(0, Math.min(3, cases.length));

  for (const caseDef of cases) {
    if (Date.now() >= deadline) break;
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    if (!fs.existsSync(wavPath)) {
      rows.push({ caseId: caseDef.id, error: 'missing_wav', parityPass: false });
      continue;
    }
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `causal-${caseDef.id}-${Date.now()}`);
      const extra = data.extra || {};
      const raw = String(extra.raw_asr_text || '').trim();
      const s3Final = String(data.text_asr || '').trim();
      const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();
      const extracted = extractCausal(extra);
      const causal = extracted.causal;
      const baselineFinal = causal?.baseline_final_text ?? null;
      const pathParity = extracted.pathParity;
      const allMutIsolated = pathParity.length > 0 && pathParity.every((p) => p.mutationIsolated);
      const packedSym =
        extracted.baselinePacked > 0 &&
        extracted.s3Packed > 0 &&
        extracted.baselinePacked === extracted.s3Packed;
      const parityPass =
        Boolean(causal) &&
        pathParity.length > 0 &&
        allMutIsolated &&
        packedSym &&
        extracted.secondVote === 0 &&
        extracted.anchorRetry === 0;

      let outcome = 'INDETERMINATE';
      if (baselineFinal != null && expected) {
        const db = levenshtein(norm(baselineFinal), norm(expected));
        const ds = levenshtein(norm(s3Final), norm(expected));
        if (ds < db) outcome = 'IMPROVED';
        else if (ds > db) outcome = 'REGRESSED';
        else if (norm(baselineFinal) === norm(s3Final)) outcome = 'UNCHANGED';
        else outcome = 'INDETERMINATE';
      }

      rows.push({
        caseId: caseDef.id,
        parityPass,
        snapshotCaptured: Boolean(causal),
        pathCount: pathParity.length,
        mutationIsolated: allMutIsolated,
        baselinePacked: extracted.baselinePacked,
        s3Packed: extracted.s3Packed,
        packedSymmetric: packedSym,
        upstreamHashes: pathParity.map((p) => p.upstreamHash).join('|'),
        packedHashes: pathParity.map((p) => p.packedHash).join('|'),
        baselineFinal,
        s3Final,
        expected,
        rawAsr: raw,
        outcome,
        baselinePostForkMs: causal?.baseline_post_fork_ms_sum ?? null,
        s3PostForkMs: causal?.s3_post_fork_ms_sum ?? null,
        secondVote: extracted.secondVote,
        anchorRetry: extracted.anchorRetry,
        kenlmGt16: extracted.kenlmGt16,
        pipelineMs: Date.now() - t0,
      });
      console.log(
        `[${caseDef.id}] parity=${parityPass} packed=${extracted.baselinePacked}/${extracted.s3Packed} ${Date.now() - t0}ms`
      );

      if (detCases.some((c) => c.id === caseDef.id)) {
        // Repeat for determinism (S3 final + baseline final + hashes)
        const data2 = await runCase(port, wavPath, `causal-det-${caseDef.id}-${Date.now()}`);
        const e2 = extractCausal(data2.extra || {});
        const s3_2 = String(data2.text_asr || '').trim();
        const b2 = e2.causal?.baseline_final_text ?? null;
        const h1 = pathParity.map((p) => p.upstreamHash).join('|');
        const h2 = (e2.pathParity || []).map((p) => p.upstreamHash).join('|');
        // Note: independent ASR may differ — for determinism of REPLAY we compare
        // within same run's dual branch; cross-run ASR may change. Mark as
        // same-run branch determinism separately.
        determinism.push({
          caseId: caseDef.id,
          sameRunBaselineVsS3PackedEqual: packedSym,
          sameRunMutationIsolated: allMutIsolated,
          crossRunUpstreamHashEqual: h1 === h2 && h1.length > 0,
          crossRunBaselineFinalEqual: baselineFinal === b2,
          crossRunS3FinalEqual: s3Final === s3_2,
          note:
            h1 === h2
              ? 'cross_run_hash_equal'
              : 'cross_run_asr_may_differ_expected_until_snapshot_persist',
        });
      }
    } catch (e) {
      rows.push({ caseId: caseDef.id, error: e.message, parityPass: false });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  const parityPassN = rows.filter((r) => r.parityPass).length;
  const capturedN = rows.filter((r) => r.snapshotCaptured).length;
  const packedSymN = rows.filter((r) => r.packedSymmetric).length;
  const outcomes = {};
  for (const r of rows) {
    if (!r.parityPass) continue;
    outcomes[r.outcome || 'INDETERMINATE'] = (outcomes[r.outcome || 'INDETERMINATE'] || 0) + 1;
  }

  const verdict =
    parityPassN === rows.length && rows.length > 0
      ? 'ACCEPTANCE_HARNESS_CORRECTION_PASS'
      : capturedN === 0
        ? 'ACCEPTANCE_HARNESS_CORRECTION_BLOCKED_BY_FORK_BOUNDARY'
        : parityPassN / Math.max(1, rows.length) >= 0.95
          ? 'ACCEPTANCE_HARNESS_CORRECTION_PASS_WITH_NONBLOCKING_TRACE_LIMITATION'
          : 'ACCEPTANCE_HARNESS_CORRECTION_BLOCKED_BY_STATE_SERIALIZATION';

  const nextPhase =
    verdict.startsWith('ACCEPTANCE_HARNESS_CORRECTION_PASS')
      ? 'MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE'
      : 'MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION';

  // Write artifacts
  const parityCsv = [
    'caseId,parityPass,snapshotCaptured,pathCount,mutationIsolated,baselinePacked,s3Packed,packedSymmetric,outcome,baselinePostForkMs,s3PostForkMs,error',
  ];
  for (const r of rows) {
    parityCsv.push(
      [
        r.caseId,
        r.parityPass,
        r.snapshotCaptured,
        r.pathCount ?? '',
        r.mutationIsolated,
        r.baselinePacked ?? '',
        r.s3Packed ?? '',
        r.packedSymmetric,
        r.outcome ?? '',
        r.baselinePostForkMs ?? '',
        r.s3PostForkMs ?? '',
        r.error ?? '',
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_acceptance_parity_results.csv'), parityCsv.join('\n'));

  const detCsv = [
    'caseId,sameRunBaselineVsS3PackedEqual,sameRunMutationIsolated,crossRunUpstreamHashEqual,crossRunBaselineFinalEqual,crossRunS3FinalEqual,note',
  ];
  for (const d of determinism) {
    detCsv.push(
      [
        d.caseId,
        d.sameRunBaselineVsS3PackedEqual,
        d.sameRunMutationIsolated,
        d.crossRunUpstreamHashEqual,
        d.crossRunBaselineFinalEqual,
        d.crossRunS3FinalEqual,
        d.note,
      ].join(',')
    );
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_acceptance_determinism_results.csv'),
    detCsv.join('\n')
  );

  const latCsv = ['caseId,baselinePostForkMs,s3PostForkMs,deltaMs'];
  for (const r of rows) {
    if (r.baselinePostForkMs == null) continue;
    latCsv.push(
      [
        r.caseId,
        r.baselinePostForkMs,
        r.s3PostForkMs,
        (r.s3PostForkMs || 0) - (r.baselinePostForkMs || 0),
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_acceptance_harness_latency_probe.csv'), latCsv.join('\n'));

  const summary = {
    phase: 'MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    harnessVersion: HARNESS_VERSION,
    s3Identity: {
      verified: true,
      modelId: IDENTITY.modelId,
      sha256: digest,
      datasetId: 'MODEL3_V2_PRODUCTION_CORE_S3',
      buildId: 'prod_core_s3_build_20260830_v1',
    },
    previousAcceptance: 'HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE',
    previousAssemblyKenlmOwnership: 'REJECTED',
    denominator: {
      requested: cases.length,
      completed: rows.length,
      reportedAsDialog200: !CASE_FILTER && rows.length === 200,
      subset: Boolean(CASE_FILTER),
    },
    parity: {
      snapshotCaptured: capturedN,
      parityPass: parityPassN,
      packedSymmetric: packedSymN,
      parityPassRate: rows.length ? parityPassN / rows.length : 0,
    },
    preliminaryCausalOutcomesOnParityCases: outcomes,
    governance: {
      businessArchitectureChanged: false,
      s3Changed: false,
      training: false,
      features: false,
      threshold: false,
      retry: false,
      recall: false,
      assembly: false,
      kenlm: false,
      jobResult: false,
      productionDualChain: false,
    },
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_acceptance_harness_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(JSON.stringify({ verdict, parityPassN, capturedN, rows: rows.length }, null, 2));
  process.exit(verdict.startsWith('ACCEPTANCE_HARNESS_CORRECTION_PASS') ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
