#!/usr/bin/env node
/**
 * Tone Model V2 Candidate — Business Validation (read-only).
 * Deploy candidate via TONE_MODEL_PATH; compare against frozen Phase 1.5 baseline.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from '../lib/wait-asr-ready.mjs';
import { loadDialog200Manifest } from '../lib/load-dialog200-manifest.mjs';
import { getFwFrozenPort, resolveProjectRoot } from '../lib/fw-port-ssot.mjs';
import { classifyFwHealthResponse } from '../lib/fw-health-identity.mjs';
import { runPhase15Preflight } from '../lib/phase15-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || resolveProjectRoot(__dirname);
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav/dialog_200');
const RUN_ID = process.env.V2_CANDIDATE_RUN_ID || 'run_20260712_v2_candidate';
const OUT_ROOT = path.join(PROJECT_ROOT, 'tmp/tone_v2_candidate_business_validation', RUN_ID);
const FW_PORT = getFwFrozenPort(PROJECT_ROOT);
const CANDIDATE_ARTIFACT = path.join(
  PROJECT_ROOT,
  'electron_node/services/faster_whisper_vad/tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz'
);
const BASELINE_FROZEN_PATH = path.join(__dirname, 'tone_v2_phase15_baseline_frozen.json');
const PY = path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad/.venv/Scripts/python.exe');
const EXPECTED_TRAINING_VERSION = 'production_cnn_v2_candidate_20260712';
const EXPECTED_ARCHITECTURE = 'conv1d_production_v2';

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function probeArtifact(artifactPath) {
  if (!fs.existsSync(PY)) {
    return { error: 'python venv missing', path: artifactPath };
  }
  const script = `
import json, os, numpy as np
from tone_module.loader_v1 import ToneModelLoaderV1
p = os.environ.get('ARTIFACT_PATH')
d = np.load(p, allow_pickle=True)
loader = ToneModelLoaderV1()
r = loader.load(p)
meta = r.metadata
arch = d['modelArchitecture'].item() if 'modelArchitecture' in d else getattr(meta, 'architecture', None)
print(json.dumps({
  'artifactPath': p,
  'exists': os.path.isfile(p),
  'trainingVersion': d['trainingVersion'].item() if 'trainingVersion' in d else None,
  'modelArchitecture': arch,
  'featureVersion': d['featureVersion'].item() if 'featureVersion' in d else None,
  'backend': meta.backend if meta else None,
  'loaderReady': r.ready,
  'modelVersion': d['modelVersion'].item() if 'modelVersion' in d else None,
  'val_acc': (d['metrics'].item().get('val_acc') if 'metrics' in d else None),
}, ensure_ascii=False))
`;
  const r = spawnSync(PY, ['-c', script], {
    cwd: path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad'),
    encoding: 'utf8',
    env: { ...process.env, ARTIFACT_PATH: artifactPath },
    timeout: 120000,
  });
  try {
    return JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    return { error: r.stderr || r.stdout, path: artifactPath };
  }
}

async function probeFw() {
  try {
    const res = await fetch(`http://127.0.0.1:${FW_PORT}/health`, { signal: AbortSignal.timeout(10000) });
    const body = await res.json();
    const identity = classifyFwHealthResponse(body, res.status);
    if (identity.code === 'WRONG_SERVICE_ON_FW_PORT') {
      return { ok: false, identity, error: identity.detail };
    }
    return { ok: res.ok, identity, ...body };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function classifyBusinessEffect(row, caseDef) {
  const expected = norm(caseDef.expectedText || caseDef.utterance || '');
  const final = norm(row.text_asr || '');
  const raw = norm(row.raw_asr_text || row.text_asr || '');
  if (!expected || !final) return 'unknown';
  const finalMatch = final === expected;
  const rawMatch = raw === expected;
  if (finalMatch && !rawMatch) return 'corrected';
  if (!finalMatch && rawMatch) return 'regressed';
  if (finalMatch) return 'no_effect_exact';
  return 'no_effect_inexact';
}

function aggregateDialog200(rows) {
  const ok = rows.filter((r) => !r.error && !r.skip);
  const toneTrigger = ok.filter((r) => r.tone?.asr_payload?.toneEnabled === true && (r.tone?.asr_payload?.sliceCount ?? 0) > 0);
  const toneExact = ok.filter((r) => (r.tone?.recall?.toneExactHitCount ?? 0) > 0);
  const tonePenalty = ok.filter((r) => {
    const compat = r.tone?.recall?.recallToneCompatibleCount ?? 0;
    const fallback = r.tone?.recall?.recallToneFallbackCount ?? 0;
    return compat > 0 || fallback > 0;
  });
  const candidateRerank = ok.filter(
    (r) => (r.fw_applied_count ?? 0) > 0 || r.text_changed || r.sentence_rerank?.pickedIsRaw === false
  );
  const exactMatch = ok.filter((r) => r.exact_match);
  const modelError = ok.filter((r) => r.tone?.asr_payload?.model_error === true);
  const pipelineMs = ok.map((r) => r.pipeline_ms).filter((n) => typeof n === 'number');
  const fwMs = ok.map((r) => r.fw_detector_step_ms).filter((n) => typeof n === 'number');
  const caseMs = ok.map((r) => r.case_elapsed_ms).filter((n) => typeof n === 'number');
  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
    return s[Math.max(0, idx)];
  };
  return {
    caseCount: rows.length,
    successCount: ok.length,
    errorCount: rows.filter((r) => r.error).length,
    toneTriggerRate: ok.length ? toneTrigger.length / ok.length : 0,
    toneTriggerCount: toneTrigger.length,
    toneExactHitRate: ok.length ? toneExact.length / ok.length : 0,
    toneExactHitCount: toneExact.reduce((s, r) => s + (r.tone?.recall?.toneExactHitCount ?? 0), 0),
    tonePatternHitTotal: ok.reduce((s, r) => s + (r.tone?.recall?.ngramTonePatternHitCount ?? 0), 0),
    tonePenaltyTriggerRate: ok.length ? tonePenalty.length / ok.length : 0,
    candidateRerankRate: ok.length ? candidateRerank.length / ok.length : 0,
    exactMatchRate: ok.length ? exactMatch.length / ok.length : 0,
    meanCer: ok.length ? ok.reduce((s, r) => s + (r.cer ?? 0), 0) / ok.length : null,
    modelErrorCount: modelError.length,
    meanPipelineMs: pipelineMs.length ? pipelineMs.reduce((a, b) => a + b, 0) / pipelineMs.length : null,
    p50PipelineMs: pct(pipelineMs, 50),
    p95PipelineMs: pct(pipelineMs, 95),
    meanFwDetectorMs: fwMs.length ? fwMs.reduce((a, b) => a + b, 0) / fwMs.length : null,
    meanCaseMs: caseMs.length ? caseMs.reduce((a, b) => a + b, 0) / caseMs.length : null,
  };
}

function aggregateAB(fixtures) {
  const changed = fixtures.filter((f) => f.compareAB?.finalCandidateChanged);
  const ranking = fixtures.filter((f) => f.compareAB?.rankingTop1A !== f.compareAB?.rankingTop1B);
  const kenlm = fixtures.filter((f) => f.compareAB?.kenlmTop1A !== f.compareAB?.kenlmTop1B);
  const penalty = fixtures.filter((f) =>
    f.variantA?.recallPreFilterSample?.some((h) => h.tonePenalty != null && h.tonePenalty < 1)
  );
  const posterior = fixtures.filter((f) => (f.variantA?.sliceCount ?? 0) > 0);
  const noEffect = fixtures.filter((f) => !f.compareAB?.finalCandidateChanged);
  const lowMargin = fixtures.filter((f) =>
    (f.variantA?.posteriorSummary || []).some((p) => (p.confidence ?? 1) < 0.5)
  );
  return {
    fixtureCount: fixtures.length,
    posteriorPresentRate: fixtures.length ? posterior.length / fixtures.length : 0,
    lowMarginPosteriorRate: fixtures.length ? lowMargin.length / fixtures.length : 0,
    tonePenaltyTriggeredRate: fixtures.length ? penalty.length / fixtures.length : 0,
    rankingReorderedRate: fixtures.length ? ranking.length / fixtures.length : 0,
    kenlmTopChangedRate: fixtures.length ? kenlm.length / fixtures.length : 0,
    finalCandidateChangedRate: fixtures.length ? changed.length / fixtures.length : 0,
    finalCandidateChangedCount: changed.length,
    noEffectRate: fixtures.length ? noEffect.length / fixtures.length : 0,
    changedFixtureIds: changed.map((f) => f.fixtureId),
  };
}

function classifyAbVsExpected(fixtures, caseMap) {
  let improvement = 0;
  let regression = 0;
  let lateral = 0;
  let noEffect = 0;
  const details = [];
  for (const f of fixtures) {
    const expected = norm(caseMap.get(f.fixtureId)?.expectedText || '');
    const a = norm(f.variantA?.finalCandidate || '');
    const b = norm(f.variantB?.finalCandidate || '');
    if (!expected) continue;
    const cer = (s) => {
      if (!s) return 1;
      if (s === expected) return 0;
      const m = s.length;
      const n = expected.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = s[i - 1] === expected[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      return dp[m][n] / Math.max(n, 1);
    };
    const cerA = cer(a);
    const cerB = cer(b);
    let effect = 'no_effect';
    if (!f.compareAB?.finalCandidateChanged) {
      noEffect += 1;
      effect = 'no_effect';
    } else if (cerA < cerB - 1e-9) {
      improvement += 1;
      effect = 'improvement';
    } else if (cerB < cerA - 1e-9) {
      regression += 1;
      effect = 'regression';
    } else {
      lateral += 1;
      effect = 'lateral';
    }
    details.push({ fixtureId: f.fixtureId, effect, cerA, cerB });
  }
  const n = fixtures.length || 1;
  return {
    improvementCount: improvement,
    improvementRate: improvement / n,
    regressionCount: regression,
    regressionRate: regression / n,
    lateralChangeCount: lateral,
    noEffectCount: noEffect,
    noEffectRate: noEffect / n,
    details,
  };
}

function pickCaseStudies(dialogRows, abFixtures, baselineFrozen) {
  const studies = [];
  const byId = new Map(dialogRows.filter((r) => r.id).map((r) => [r.id, r]));
  const abMap = new Map((abFixtures || []).map((f) => [f.fixtureId, f]));

  const add = (id, category, abRow) => {
    const d = byId.get(id);
    if (!d && !abRow) return;
    studies.push({
      id,
      category,
      candidate: {
        rawAsr: d?.raw_asr_text || abRow?.variantA?.rawAsrText,
        posterior: abRow?.variantA?.posteriorSummary?.slice(0, 3) || null,
        tonePattern: abRow?.variantA?.exampleWindows?.slice(0, 2) || null,
        penalty: abRow?.variantA?.recallPreFilterSample?.filter((h) => h.tonePenalty < 1).slice(0, 3) || [],
        candidate: abRow?.variantA?.rankingBeforeKenLM?.slice(0, 3) || null,
        kenlm: abRow?.variantA?.kenlmTop?.slice(0, 3) || null,
        final: d?.text_asr || abRow?.variantA?.finalCandidate,
        toneExact: d?.tone?.recall?.toneExactHitCount ?? 0,
        ngramHits: d?.tone?.recall?.ngramTonePatternHitCount ?? 0,
        abCompare: abRow?.compareAB || null,
      },
      baselineNote: 'See Phase 1.5 report for baseline trace on same fixture',
    });
  };

  const abEffects = classifyAbVsExpected(abFixtures || [], new Map());
  const improved = (abFixtures || []).filter((f) => {
    const d = abEffects.details.find((x) => x.fixtureId === f.fixtureId);
    return d?.effect === 'improvement';
  });
  const regressed = (abFixtures || []).filter((f) => {
    const d = abEffects.details.find((x) => x.fixtureId === f.fixtureId);
    return d?.effect === 'regression';
  });
  const noEffect = (abFixtures || []).filter((f) => !f.compareAB?.finalCandidateChanged);

  if (improved[0]) add(improved[0].fixtureId, 'improvement', improved[0]);
  if (improved[1]) add(improved[1].fixtureId, 'improvement', improved[1]);
  if (regressed[0]) add(regressed[0].fixtureId, 'regression', regressed[0]);
  if (regressed[1]) add(regressed[1].fixtureId, 'regression', regressed[1]);
  add('d001', 'tone_lookup_miss', abMap.get('d001'));
  add('d043', 'tone_lookup_hit', abMap.get('d043'));
  if (noEffect[0]) add(noEffect[0].fixtureId, 'no_effect', noEffect[0]);
  if (noEffect[1]) add(noEffect[1].fixtureId, 'no_effect', noEffect[1]);
  for (const f of (abFixtures || []).filter((x) => x.compareAB?.kenlmTop1A !== x.compareAB?.kenlmTop1B).slice(0, 2)) {
    add(f.fixtureId, 'kenlm_override', f);
  }

  const seen = new Set();
  return studies
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, 10);
}

function compareMetrics(candidate, baseline) {
  const d = candidate.dialog200.aggregate;
  const b = baseline.dialog200;
  const abC = candidate.abCounterfactual;
  const abB = baseline.abCounterfactual;
  const delta = (c, base) => (c == null || base == null ? null : c - base);
  return {
    toneExactHitCaseRate: { baseline: b.toneExactHitCaseRate, candidate: d.toneExactHitRate, delta: delta(d.toneExactHitRate, b.toneExactHitCaseRate) },
    candidateRerankRate: { baseline: b.candidateRerankRate, candidate: d.candidateRerankRate, delta: delta(d.candidateRerankRate, b.candidateRerankRate) },
    finalCandidateChangedRate: { baseline: abB.finalCandidateChangedRate, candidate: abC.finalCandidateChangedRate, delta: delta(abC.finalCandidateChangedRate, abB.finalCandidateChangedRate) },
    improvementRate: { baseline: abB.improvementRate, candidate: candidate.abEffects?.improvementRate, delta: delta(candidate.abEffects?.improvementRate, abB.improvementRate) },
    regressionRate: { baseline: abB.regressionRate, candidate: candidate.abEffects?.regressionRate, delta: delta(candidate.abEffects?.regressionRate, abB.regressionRate) },
    noEffectRate: { baseline: abB.noEffectRate, candidate: candidate.abEffects?.noEffectRate, delta: delta(candidate.abEffects?.noEffectRate, abB.noEffectRate) },
    exactMatchRate: { baseline: b.exactMatchRate, candidate: d.exactMatchRate, delta: delta(d.exactMatchRate, b.exactMatchRate) },
    meanCer: { baseline: b.meanCer, candidate: d.meanCer, delta: delta(d.meanCer, b.meanCer) },
    meanPipelineMs: { baseline: b.meanPipelineMs, candidate: d.meanPipelineMs, delta: delta(d.meanPipelineMs, b.meanPipelineMs) },
    meanFwDetectorMs: { baseline: b.meanFwDetectorMs, candidate: d.meanFwDetectorMs, delta: delta(d.meanFwDetectorMs, b.meanFwDetectorMs) },
  };
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const port = getTestServerPort();
  const baselineFrozen = JSON.parse(fs.readFileSync(BASELINE_FROZEN_PATH, 'utf8'));

  const preflight = await runPhase15Preflight({ projectRoot: PROJECT_ROOT });
  if (!preflight.ok) {
    console.error('Phase 1.5 preflight failed:');
    for (const e of preflight.errors) console.error(' ', e);
    process.exit(4);
  }
  for (const w of preflight.warnings) console.warn('[preflight]', w);

  const deployment = {
    timestamp: new Date().toISOString(),
    runId: RUN_ID,
    fwFrozenPort: FW_PORT,
    toneModelPathEnv: process.env.TONE_MODEL_PATH || null,
    expectedArtifact: CANDIDATE_ARTIFACT,
    artifactProbe: probeArtifact(CANDIDATE_ARTIFACT),
    fwHealth: await probeFw(),
    nodePort: port,
    preflight,
    baselineReference: baselineFrozen.source,
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'deployment.json'), JSON.stringify(deployment, null, 2));

  if (deployment.fwHealth?.identity?.code === 'WRONG_SERVICE_ON_FW_PORT') {
    console.error('WRONG_SERVICE_ON_FW_PORT', deployment.fwHealth);
    process.exit(5);
  }

  const probe = deployment.artifactProbe || {};
  if (probe.trainingVersion !== EXPECTED_TRAINING_VERSION) {
    console.error('Artifact probe failed or wrong trainingVersion:', probe);
    process.exit(3);
  }
  if (probe.modelArchitecture !== EXPECTED_ARCHITECTURE) {
    console.error('Artifact probe failed or wrong modelArchitecture:', probe);
    process.exit(3);
  }
  if (!probe.loaderReady) {
    console.error('Loader not ready for candidate:', probe);
    process.exit(3);
  }

  if (!(await waitTestServerHealth(port, 300000))) {
    console.error('Node test server not ready on', port);
    process.exit(2);
  }

  console.log('Waiting for ASR warmup...');
  const ready = await waitAsrReady(port, {
    warmupWavPath: path.join(DIALOG_DIR, 'dialog_d001.wav'),
    maxWaitMs: 600000,
    label: 'v2-candidate',
  });
  if (!ready.ready) {
    console.warn('ASR warmup not confirmed; continuing:', ready.lastError);
  }

  const batchScript = path.join(__dirname, '../tone-v2-dialog200-batch.js');
  const batchOut = path.join(OUT_ROOT, 'dialog200_batch.json');
  console.log('Running dialog_200 batch (Tone ON, V2 candidate)...');
  const batchRun = spawnSync(
    process.execPath,
    [
      batchScript,
      '--session',
      'v2_candidate_d200',
      '--out',
      batchOut,
      '--max-minutes',
      String(process.env.V2_MAX_MINUTES || '30'),
      '--wait-fw',
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, PROJECT_ROOT, TONE_MODEL_PATH: CANDIDATE_ARTIFACT },
      timeout: 45 * 60 * 1000,
    }
  );
  if (batchRun.status !== 0) {
    console.error('dialog200 batch failed', batchRun.stderr?.slice(-1200));
  }

  let dialogBatch = { cases: [] };
  if (fs.existsSync(batchOut)) {
    dialogBatch = JSON.parse(fs.readFileSync(batchOut, 'utf8'));
  }

  console.log('Running tone-sensitive A/B audit...');
  const auditScript = path.join(__dirname, 'tone_p10_business_effect_acceptance_audit.mjs');
  const auditRun = spawnSync(process.execPath, [auditScript], {
    cwd: path.dirname(auditScript),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT },
    timeout: 60 * 60 * 1000,
  });
  if (auditRun.status !== 0) {
    console.error('A/B audit stderr tail:', auditRun.stderr?.slice(-800));
  }

  let abReport = { fixtures: [], aggregate: {} };
  const abPath = path.join(PROJECT_ROOT, 'tmp/tone_p10_business_acceptance/business_effect_audit.json');
  if (fs.existsSync(abPath)) {
    abReport = JSON.parse(fs.readFileSync(abPath, 'utf8'));
    fs.copyFileSync(abPath, path.join(OUT_ROOT, 'business_effect_audit.json'));
  }

  const { cases } = loadDialog200Manifest(path.join(DIALOG_DIR, 'cases.manifest.json'));
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const dialogRows = dialogBatch.cases || [];
  const businessEffects = dialogRows.map((r) => ({
    id: r.id,
    effect: classifyBusinessEffect(r, caseMap.get(r.id) || {}),
  }));
  const abEffects = classifyAbVsExpected(abReport.fixtures || [], caseMap);

  const report = {
    timestamp: new Date().toISOString(),
    phase: 'v2_candidate_business_validation',
    runId: RUN_ID,
    deployment,
    baselineFrozen,
    dialog200: {
      ...dialogBatch.summary,
      aggregate: aggregateDialog200(dialogRows),
      businessEffects,
      correctedCount: businessEffects.filter((e) => e.effect === 'corrected').length,
      regressedCount: businessEffects.filter((e) => e.effect === 'regressed').length,
      noEffectCount: businessEffects.filter((e) => e.effect.startsWith('no_effect')).length,
    },
    abCounterfactual: aggregateAB(abReport.fixtures || []),
    abEffects,
    caseStudies: pickCaseStudies(dialogRows, abReport.fixtures || [], baselineFrozen),
    comparison: null,
  };
  report.comparison = compareMetrics(report, baselineFrozen);

  const outJson = path.join(OUT_ROOT, 'v2_candidate_report.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ comparison: report.comparison, deployment: probe }, null, 2));
  console.log('Wrote', outJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
