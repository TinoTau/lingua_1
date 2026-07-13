#!/usr/bin/env node
/**
 * Phase 1.5 — Production Baseline Business Validation (read-only).
 * Deploy production artifact via TONE_MODEL_PATH; collect dialog_200 + A/B traces.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
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
const OUT_ROOT = path.join(PROJECT_ROOT, 'tmp/tone_phase1_5_business_baseline');
const FW_PORT = getFwFrozenPort(PROJECT_ROOT);
const PRODUCTION_ARTIFACT = path.join(
  PROJECT_ROOT,
  'electron_node/services/faster_whisper_vad/tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz'
);
const PY = path.join(PROJECT_ROOT, 'electron_node/services/faster_whisper_vad/.venv/Scripts/python.exe');

function isToneSensitive(caseDef) {
  const s = caseDef.scenario || '';
  const u = caseDef.utterance || caseDef.text || '';
  return (
    caseDef.id === 'd001' ||
    s === 'lexicon_homophone' ||
    s === 'cafe' ||
    /少糖|马芬|问一下|中杯|蓝莓/.test(u)
  );
}

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function probeArtifact() {
  if (!fs.existsSync(PY)) {
    return { error: 'python venv missing', path: PRODUCTION_ARTIFACT };
  }
  const script = `
import json, os, numpy as np
from tone_module.loader_v1 import ToneModelLoaderV1
p = os.environ.get('ARTIFACT_PATH')
d = np.load(p, allow_pickle=True)
loader = ToneModelLoaderV1()
r = loader.load(p)
meta = r.metadata
print(json.dumps({
  'artifactPath': p,
  'exists': os.path.isfile(p),
  'trainingVersion': d['trainingVersion'].item() if 'trainingVersion' in d else None,
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
    env: { ...process.env, ARTIFACT_PATH: PRODUCTION_ARTIFACT },
    timeout: 120000,
  });
  try {
    return JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    return { error: r.stderr || r.stdout, path: PRODUCTION_ARTIFACT };
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
  const candidateRerank = ok.filter((r) => (r.fw_applied_count ?? 0) > 0 || r.text_changed);
  const exactMatch = ok.filter((r) => r.exact_match);
  return {
    caseCount: rows.length,
    successCount: ok.length,
    errorCount: rows.filter((r) => r.error).length,
    toneTriggerRate: ok.length ? toneTrigger.length / ok.length : 0,
    toneTriggerCount: toneTrigger.length,
    toneExactHitRate: ok.length ? toneExact.length / ok.length : 0,
    toneExactHitCount: toneExact.reduce((s, r) => s + (r.tone?.recall?.toneExactHitCount ?? 0), 0),
    tonePenaltyTriggerRate: ok.length ? tonePenalty.length / ok.length : 0,
    candidateRerankRate: ok.length ? candidateRerank.length / ok.length : 0,
    exactMatchRate: ok.length ? exactMatch.length / ok.length : 0,
    meanCer: ok.length ? ok.reduce((s, r) => s + (r.cer ?? 0), 0) / ok.length : null,
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
  return {
    fixtureCount: fixtures.length,
    posteriorPresentRate: fixtures.length ? posterior.length / fixtures.length : 0,
    tonePenaltyTriggeredRate: fixtures.length ? penalty.length / fixtures.length : 0,
    rankingReorderedRate: fixtures.length ? ranking.length / fixtures.length : 0,
    kenlmTopChangedRate: fixtures.length ? kenlm.length / fixtures.length : 0,
    finalCandidateChangedRate: fixtures.length ? changed.length / fixtures.length : 0,
    finalCandidateChangedCount: changed.length,
    noEffectRate: fixtures.length ? noEffect.length / fixtures.length : 0,
    changedFixtureIds: changed.map((f) => f.fixtureId),
  };
}

function pickCaseStudies(dialogRows, abFixtures) {
  const studies = [];
  const byId = new Map(dialogRows.filter((r) => r.id).map((r) => [r.id, r]));

  const add = (id, category, abRow) => {
    const d = byId.get(id);
    if (!d && !abRow) return;
    studies.push({
      id,
      category,
      asr: d?.raw_asr_text || d?.text_asr || abRow?.variantA?.rawAsrText,
      posterior: abRow?.variantA?.posteriorSummary?.slice(0, 3) || null,
      tonePattern: abRow?.variantA?.exampleWindows?.slice(0, 2) || null,
      penalty: abRow?.variantA?.recallPreFilterSample?.filter((h) => h.tonePenalty < 1).slice(0, 3) || [],
      candidate: abRow?.variantA?.rankingBeforeKenLM?.slice(0, 3) || null,
      kenlm: abRow?.variantA?.kenlmTop?.slice(0, 3) || null,
      final: d?.text_asr || abRow?.variantA?.finalCandidate,
      toneExact: d?.tone?.recall?.toneExactHitCount ?? 0,
      ngramHits: d?.tone?.recall?.ngramTonePatternHitCount ?? 0,
      abCompare: abRow?.compareAB || null,
    });
  };

  const abMap = new Map((abFixtures || []).map((f) => [f.fixtureId, f]));
  const changed = (abFixtures || []).filter((f) => f.compareAB?.finalCandidateChanged);
  if (changed[0]) add(changed[0].fixtureId, 'tone_final_changed', changed[0]);
  if (changed[1]) add(changed[1].fixtureId, 'tone_final_changed', changed[1]);
  add('d001', 'tone_lookup_miss', abMap.get('d001'));
  add('d043', 'tone_lookup_hit', abMap.get('d043'));
  for (const f of (abFixtures || []).filter((x) => (x.variantA?.recallPreFilterSample || []).some((h) => h.tonePenalty < 1)).slice(0, 2)) {
    add(f.fixtureId, 'tone_penalty', f);
  }
  for (const f of (abFixtures || []).filter((x) => x.compareAB?.kenlmTop1A !== x.compareAB?.kenlmTop1B).slice(0, 2)) {
    add(f.fixtureId, 'kenlm_override', f);
  }
  const noEffect = (abFixtures || []).filter((f) => !f.compareAB?.finalCandidateChanged);
  if (noEffect[0]) add(noEffect[0].fixtureId, 'tone_no_effect', noEffect[0]);

  const seen = new Set();
  return studies.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  }).slice(0, 10);
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const port = getTestServerPort();

  const preflight = await runPhase15Preflight({ projectRoot: PROJECT_ROOT });
  if (!preflight.ok) {
    console.error('Phase 1.5 preflight failed:');
    for (const e of preflight.errors) console.error(' ', e);
    process.exit(4);
  }
  for (const w of preflight.warnings) console.warn('[preflight]', w);

  const deployment = {
    timestamp: new Date().toISOString(),
    fwFrozenPort: FW_PORT,
    toneModelPathEnv: process.env.TONE_MODEL_PATH || null,
    expectedArtifact: PRODUCTION_ARTIFACT,
    artifactProbe: probeArtifact(),
    fwHealth: await probeFw(),
    nodePort: port,
    preflight,
  };
  fs.writeFileSync(path.join(OUT_ROOT, 'deployment.json'), JSON.stringify(deployment, null, 2));

  if (deployment.fwHealth?.identity?.code === 'WRONG_SERVICE_ON_FW_PORT') {
    console.error('WRONG_SERVICE_ON_FW_PORT', deployment.fwHealth);
    process.exit(5);
  }

  const tv = deployment.artifactProbe?.trainingVersion;
  if (tv !== 'production_baseline_20260712') {
    console.error('Artifact probe failed or not production baseline:', deployment.artifactProbe);
    process.exit(3);
  }

  if (!(await waitTestServerHealth(port, 300000))) {
    console.error('Node test server not ready on', port);
    process.exit(2);
  }

  console.log('Waiting for ASR warmup (may take several minutes after Electron start)...');
  const ready = await waitAsrReady(port, {
    warmupWavPath: path.join(DIALOG_DIR, 'dialog_d001.wav'),
    maxWaitMs: 600000,
    label: 'phase15-baseline',
  });
  if (!ready.ready) {
    console.warn('ASR warmup not confirmed; continuing — batch script will wait for FW:', ready.lastError);
  }

  const batchScript = path.join(__dirname, '../tone-v2-dialog200-batch.js');
  const batchOut = path.join(OUT_ROOT, 'dialog200_batch.json');
  console.log('Running dialog_200 batch (tone ON)...');
  const batchRun = spawnSync(
    process.execPath,
    [
      batchScript,
      '--session',
      'phase1_5_baseline_d200',
      '--out',
      batchOut,
      '--max-minutes',
      String(process.env.PHASE15_MAX_MINUTES || '22'),
      '--wait-fw',
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PROJECT_ROOT,
        TONE_MODEL_PATH: PRODUCTION_ARTIFACT,
      },
      timeout: 30 * 60 * 1000,
    }
  );
  if (batchRun.status !== 0) {
    console.error('dialog200 batch failed', batchRun.stderr?.slice(-800));
  }

  let dialogBatch = { cases: [] };
  if (fs.existsSync(batchOut)) {
    dialogBatch = JSON.parse(fs.readFileSync(batchOut, 'utf8'));
  }

  console.log('Running tone-sensitive A/B audit...');
  const auditScript = path.join(__dirname, 'tone_p10_business_effect_acceptance_audit.mjs');
  const auditEnv = { ...process.env, PROJECT_ROOT };
  const auditRun = spawnSync(process.execPath, [auditScript], {
    cwd: path.dirname(auditScript),
    encoding: 'utf8',
    env: auditEnv,
    timeout: 60 * 60 * 1000,
  });

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

  const report = {
    timestamp: new Date().toISOString(),
    phase: '1.5_production_baseline_business_validation',
    deployment,
    dialog200: {
      ...dialogBatch.summary,
      aggregate: aggregateDialog200(dialogRows),
      businessEffects,
      correctedCount: businessEffects.filter((e) => e.effect === 'corrected').length,
      regressedCount: businessEffects.filter((e) => e.effect === 'regressed').length,
      noEffectCount: businessEffects.filter((e) => e.effect.startsWith('no_effect')).length,
    },
    abCounterfactual: aggregateAB(abReport.fixtures || []),
    caseStudies: pickCaseStudies(dialogRows, abReport.fixtures || []),
    baseline: {},
  };

  report.baseline = {
    toneTriggerRate: report.dialog200.aggregate.toneTriggerRate,
    toneExactHitFixtureRate: report.dialog200.aggregate.toneExactHitRate,
    tonePenaltyTriggerRate: report.abCounterfactual.tonePenaltyTriggeredRate,
    finalCandidateChangedRate: report.abCounterfactual.finalCandidateChangedRate,
    exactMatchRate: report.dialog200.aggregate.exactMatchRate,
    meanCer: report.dialog200.aggregate.meanCer,
    correctedVsExpected: report.dialog200.correctedCount,
    regressedVsExpected: report.dialog200.regressedCount,
    noEffectVsExpected: report.dialog200.noEffectCount,
  };

  const outJson = path.join(OUT_ROOT, 'phase1_5_baseline_report.json');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.baseline, null, 2));
  console.log('Wrote', outJson);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
