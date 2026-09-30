#!/usr/bin/env node
/**
 * MODEL3_V2_RETRY_REINTERPRETATION_SIGNAL_LOSS_AUDIT �?READ-ONLY
 *
 * Uses frozen causal harness (MODEL3_ACCEPTANCE_HARNESS_V1_20260831).
 * No training / no business-logic changes.
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
import {
  norm,
  deriveCorrectionUnits,
  evaluateMaterializableTargetV1,
  candidateLexicalMatchesUnit,
  collectAssemblyTexts,
  collectKenlmTexts,
} from './lib/materializable-target-v1.mjs';

function finespanCoversUnit(span, unit) {
  if (!span || unit.source_range.rawStart == null) return false;
  const s = span.start ?? span.rawStart;
  const e = span.end ?? span.rawEnd;
  if (unit.operation === 'INSERT') {
    return s <= unit.source_range.rawStart && e >= unit.source_range.rawEnd;
  }
  if (unit.source_range.rawStart === unit.source_range.rawEnd) {
    return s <= unit.source_range.rawStart && e >= unit.source_range.rawEnd;
  }
  return s <= unit.source_range.rawStart && e >= unit.source_range.rawEnd;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const DIST = path.join(ELECTRON, 'dist', 'main', 'electron-node', 'main', 'src');
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

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_FILTER =
  caseIdsIdx >= 0
    ? new Set(String(args[caseIdsIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean))
    : null;

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex').toLowerCase();
}

function csvEsc(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

function rangeOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return false;
  return aStart < bEnd && bStart < aEnd;
}

function spanRawRange(span) {
  return {
    start: span?.start ?? span?.rawStart ?? null,
    end: span?.end ?? span?.rawEnd ?? null,
    surface: span?.surface || '',
  };
}

function anchorSpanIds(trace) {
  const ids = new Set();
  for (const p of trace?.paths || []) {
    for (const a of p.model3?.anchors || []) ids.add(a.spanId);
    for (const d of p.model3?.decisions || []) {
      if (d.isAnchor) ids.add(d.spanId);
    }
  }
  return ids;
}

function logicalRetryDecisions(trace) {
  const byKey = new Map();
  for (const p of trace?.paths || []) {
    const m3 = p.model3 || {};
    for (const d of m3.decisions || []) {
      if (d.decision !== 'RETRY' || d.isAnchor) continue;
      const r = spanRawRange(d);
      const key = `${r.start}|${r.end}|${r.surface}`;
      if (!byKey.has(key)) {
        byKey.set(key, { ...r, spanId: d.spanId, pathId: p.path_id, decision: d });
      }
    }
  }
  return [...byKey.values()];
}

function errorRegionFromUnits(units) {
  const req = units.filter((u) => u.operation !== 'UNCHANGED');
  if (!req.length) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const u of req) {
    if (u.source_range.rawStart != null) start = Math.min(start, u.source_range.rawStart);
    if (u.source_range.rawEnd != null) end = Math.max(end, u.source_range.rawEnd);
  }
  if (!Number.isFinite(start)) return null;
  return { rawStart: start, rawEnd: end, units: req };
}

function classifyRepairability({ expected, rawAsr, baselineFinal, trace }) {
  const nBase = norm(baselineFinal);
  const nExp = norm(expected);
  if (nBase === nExp) {
    return { repairabilityClass: 'BASELINE_ALREADY_CORRECT', confidence: 'HIGH' };
  }
  const derived = deriveCorrectionUnits(rawAsr, expected);
  const required = derived.required_units;
  if (!required.length) {
    return { repairabilityClass: 'REFERENCE_OR_ALIGNMENT_AMBIGUOUS', confidence: 'LOW' };
  }

  const paths = trace?.paths || [];
  const finespans = paths.flatMap((p) =>
    (p.finespans || []).map((fs) => ({ ...fs, path_id: p.path_id }))
  );
  const anchorIds = anchorSpanIds(trace);
  const nonAnchor = finespans.filter((fs) => !anchorIds.has(fs.span_id));

  const lexicalUnits = required.filter((u) => u.is_reference_diff_hunk);
  const localLexical = lexicalUnits.filter((u) => nonAnchor.some((fs) => finespanCoversUnit(fs, u)));
  const allInsertMissing = required.every((u) => u.operation === 'INSERT') && lexicalUnits.length > 0;
  if (allInsertMissing && localLexical.length === 0) {
    return { repairabilityClass: 'NO_REPAIRABLE_TARGET', confidence: 'HIGH' };
  }

  const deleteOnly = required.every((u) => u.operation === 'DELETE');
  if (deleteOnly && !nonAnchor.some((fs) => required.some((u) => finespanCoversUnit(fs, u)))) {
    return { repairabilityClass: 'NO_REPAIRABLE_TARGET', confidence: 'MEDIUM' };
  }

  if (lexicalUnits.length > 0 && localLexical.length === 0) {
    return { repairabilityClass: 'NO_REPAIRABLE_TARGET', confidence: 'MEDIUM' };
  }

  if (localLexical.length > 0) {
    const conf =
      localLexical.length === lexicalUnits.length
        ? 'HIGH'
        : localLexical.length >= lexicalUnits.length / 2
          ? 'MEDIUM'
          : 'LOW';
    return { repairabilityClass: 'MODEL3_RESCUABLE', confidence: conf, required, errorRegion: errorRegionFromUnits(required) };
  }

  if (required.some((u) => nonAnchor.some((fs) => finespanCoversUnit(fs, u)))) {
    return {
      repairabilityClass: 'MODEL3_RESCUABLE',
      confidence: 'MEDIUM',
      required,
      errorRegion: errorRegionFromUnits(required),
    };
  }

  return { repairabilityClass: 'INSUFFICIENT_EVIDENCE', confidence: 'LOW', required };
}

function model3TriggerClass(retrySpans, errorRegion) {
  if (!errorRegion) return 'NO_ERROR_REGION';
  if (!retrySpans.length) return 'NO_RETRY';
  let overlap = 0;
  let adjacent = 0;
  for (const r of retrySpans) {
    if (rangeOverlap(r.start, r.end, errorRegion.rawStart, errorRegion.rawEnd)) overlap += 1;
    else if (
      Math.abs((r.end ?? 0) - errorRegion.rawStart) <= 2 ||
      Math.abs((errorRegion.rawEnd ?? 0) - (r.start ?? 0)) <= 2
    ) {
      adjacent += 1;
    }
  }
  if (overlap > 0) return 'TARGET_OVERLAP';
  if (adjacent > 0) return 'TARGET_ADJACENT_SAME_LOCAL_REGION';
  return 'UNRELATED_RETRY_ONLY';
}

function regionCoverage(region, errorRegion) {
  if (!region || !errorRegion) return 'UNKNOWN';
  const rs = region.rawStart;
  const re = region.rawEnd;
  const es = errorRegion.rawStart;
  const ee = errorRegion.rawEnd;
  if (rs <= es && re >= ee) return 'FULLY_COVERS_EXPECTED_ERROR';
  if (rangeOverlap(rs, re, es, ee)) return 'PARTIALLY_COVERS_EXPECTED_ERROR';
  return 'MISSES_EXPECTED_ERROR';
}

function collectReturnedSurfaces(trace) {
  const surfaces = [];
  for (const p of trace?.paths || []) {
    for (const a of p.model3?.retry_attempts || []) {
      if (a.attempted && (a.returnedCandidateCount || 0) > 0) surfaces.push({ pathId: p.path_id, ...a });
    }
  }
  return surfaces;
}

function targetInReturnedCandidates(trace, units, rawNorm, expNorm) {
  const hits = [];
  for (const p of trace?.paths || []) {
    const pool = [
      ...(p.after_model2_candidates?.items || []),
      ...(p.base_candidates?.items || []),
    ];
    for (const c of pool) {
      for (const u of units.filter((x) => x.is_reference_diff_hunk)) {
        if (candidateLexicalMatchesUnit(c, u, rawNorm, expNorm)) hits.push({ unit: u, candidate: c, pathId: p.path_id });
      }
    }
  }
  return hits;
}

function assemblyCloserProxy(baselineFinal, assemblyTexts, expected) {
  const db = levenshtein(norm(baselineFinal), norm(expected));
  let best = null;
  for (const t of assemblyTexts) {
    const d = levenshtein(norm(t), norm(expected));
    if (d < db && (!best || d < best.dist)) best = { text: t, dist: d };
  }
  return best;
}

function assignFirstFailOwner(stages) {
  const order = [
    'MODEL3_TRIGGER',
    'RETRY_REGION',
    'LOCAL_RESEGMENTATION',
    'LEXICON_COVERAGE',
    'RECALL_QUERY',
    'RECALL_FILTERING',
    'CANDIDATE_ELIGIBILITY',
    'CANDIDATE_BUDGET',
    'PATH_BINDING',
    'ASSEMBLY_MATERIALIZATION',
    'KENLM_SELECTION',
    'NO_REPAIRABLE_TARGET',
    'OUTSIDE_MODEL3_SCOPE',
    'EVALUATION_AMBIGUITY',
    'UNKNOWN',
  ];
  for (const o of order) {
    if (stages[o] === 'FAIL') return o;
  }
  if (stages.FINAL_IMPROVED === 'PASS') return 'NO_BLOCKER';
  return 'UNKNOWN';
}

function analyzeCase(caseDef, data, lexiconExists) {
  const extra = data.extra || {};
  const trace = extra.dialog200_path_trace || {};
  const causal =
    extra.fw_detector?.spanAssemblyV4?.model2PathTrace?.acceptance_causal ||
    trace.acceptance_causal ||
    {};
  const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();
  const rawAsr = String(extra.raw_asr_text || '').trim();
  const baselineFinal = String(causal.baseline_final_text ?? '').trim();
  const s3Final = String(causal.s3_final_text ?? data.text_asr ?? '').trim();
  const nBase = norm(baselineFinal);
  const nExp = norm(expected);
  const nS3 = norm(s3Final);
  const outcome =
    nExp && levenshtein(nS3, nExp) < levenshtein(nBase, nExp)
      ? 'IMPROVED'
      : nExp && levenshtein(nS3, nExp) > levenshtein(nBase, nExp)
        ? 'REGRESSED'
        : nBase === nS3
          ? 'UNCHANGED'
          : 'INDETERMINATE';

  const repair = classifyRepairability({ expected, rawAsr, baselineFinal, trace });
  const derived = deriveCorrectionUnits(rawAsr, expected);
  const retryLogical = logicalRetryDecisions(trace);
  const triggerClass = model3TriggerClass(retryLogical, repair.errorRegion);
  const regions = (trace?.paths || []).flatMap((p) =>
    (p.model3?.retry_regions || []).map((r) => ({ ...r, pathId: p.path_id }))
  );

  let bestRegionCoverage = 'NO_TARGET_REGION';
  let anchorCross = 0;
  for (const reg of regions) {
    const cov = regionCoverage(reg, repair.errorRegion);
    if (cov === 'FULLY_COVERS_EXPECTED_ERROR') bestRegionCoverage = cov;
    else if (cov === 'PARTIALLY_COVERS_EXPECTED_ERROR' && bestRegionCoverage !== 'FULLY_COVERS_EXPECTED_ERROR') {
      bestRegionCoverage = cov;
    } else if (bestRegionCoverage === 'NO_TARGET_REGION' && cov === 'MISSES_EXPECTED_ERROR') {
      bestRegionCoverage = cov;
    }
  }

  const resegmentOk = regions.some((r) => r.resegmentOk === true);
  const newSurfacesDiffer = regions.some(
    (r) =>
      JSON.stringify(r.newLocalSpanSurfaces || []) !== JSON.stringify(r.oldLocalSpanSurfaces || [])
  );

  const lexicalUnits = (repair.required || derived.required_units).filter((u) => u.is_reference_diff_hunk);
  const lexStatuses = lexicalUnits.map((u) => {
    const hit = lexiconExists(u.expected_text);
    return { unit: u, ...hit };
  });
  const targetInLex = lexStatuses.filter((x) => x.exists).length;
  const targetMissingLex = lexStatuses.filter((x) => !x.exists).length;

  const anyCandReturn = (trace?.paths || []).some((p) =>
    (p.model3?.retry_attempts || []).some((a) => a.attempted && (a.returnedCandidateCount || 0) > 0)
  );
  const targetReturns = targetInReturnedCandidates(
    trace,
    repair.required || derived.required_units,
    derived.raw_norm,
    derived.expected_norm
  );

  const matEval = evaluateMaterializableTargetV1(
    {
      dialog_id: caseDef.id,
      expectedText: expected,
      asr: { raw_text: rawAsr },
      final_text: s3Final,
      correct: nS3 === nExp,
      path_trace: trace,
    },
    { lexiconHit: targetInLex === lexicalUnits.length && lexicalUnits.length > 0 }
  );

  const assemblyTexts = collectAssemblyTexts(trace);
  const kenlmTexts = collectKenlmTexts(trace);
  const closerAsm = assemblyCloserProxy(baselineFinal, assemblyTexts, expected);
  const baselinePoolFp = causal.baseline_kenlm_pool_fingerprint ?? null;
  const s3PoolFp = causal.s3_kenlm_pool_fingerprint ?? null;
  const poolChanged = baselinePoolFp && s3PoolFp ? baselinePoolFp !== s3PoolFp : false;

  const stages = {};
  if (repair.repairabilityClass === 'BASELINE_ALREADY_CORRECT') {
    stages.BASELINE = 'PASS';
  } else if (repair.repairabilityClass === 'NO_REPAIRABLE_TARGET') {
    stages.NO_REPAIRABLE_TARGET = 'PASS';
  } else if (repair.repairabilityClass === 'MODEL3_RESCUABLE') {
    stages.MODEL3_RESCUABLE = 'PASS';
    stages.MODEL3_TRIGGER =
      triggerClass === 'TARGET_OVERLAP' || triggerClass === 'TARGET_ADJACENT_SAME_LOCAL_REGION'
        ? 'PASS'
        : triggerClass === 'NO_RETRY'
          ? 'FAIL'
          : 'FAIL';
    stages.RETRY_REGION =
      bestRegionCoverage === 'FULLY_COVERS_EXPECTED_ERROR' ||
      bestRegionCoverage === 'PARTIALLY_COVERS_EXPECTED_ERROR'
        ? 'PASS'
        : bestRegionCoverage === 'MISSES_EXPECTED_ERROR'
          ? 'FAIL'
          : 'UNKNOWN';
    stages.LOCAL_RESEGMENTATION =
      resegmentOk && newSurfacesDiffer ? 'PASS' : regions.length > 0 && !resegmentOk ? 'FAIL' : 'UNKNOWN';
    stages.LEXICON_COVERAGE =
      lexicalUnits.length === 0
        ? 'N_A'
        : targetInLex === lexicalUnits.length
          ? 'PASS'
          : targetMissingLex > 0
            ? 'FAIL'
            : 'UNKNOWN';
    stages.RECALL_QUERY =
      targetReturns.length > 0 ? 'PASS' : anyCandReturn && targetReturns.length === 0 ? 'FAIL' : 'UNKNOWN';
    stages.TARGET_CANDIDATE_RETURN = targetReturns.length > 0 ? 'PASS' : anyCandReturn ? 'FAIL' : 'UNKNOWN';
    stages.CANDIDATE_ELIGIBILITY = matEval.dialog.path_recoverable ? 'PASS' : matEval.dialog.lexical_recoverable ? 'FAIL' : 'UNKNOWN';
    stages.ASSEMBLY_MATERIALIZATION = matEval.dialog.actually_assembled ? 'PASS' : closerAsm ? 'PARTIAL_PROXY' : 'FAIL';
    stages.KENLM_SELECTION =
      matEval.dialog.kenlm_available && outcome !== 'IMPROVED'
        ? 'FAIL'
        : outcome === 'IMPROVED'
          ? 'PASS'
          : poolChanged && closerAsm
            ? 'FAIL'
            : 'UNKNOWN';
    stages.FINAL_IMPROVED = outcome === 'IMPROVED' ? 'PASS' : 'FAIL';
  } else {
    stages.EVALUATION_AMBIGUITY = 'PASS';
  }

  const firstFail = assignFirstFailOwner({
    MODEL3_TRIGGER: stages.MODEL3_TRIGGER,
    RETRY_REGION: stages.RETRY_REGION,
    LOCAL_RESEGMENTATION: stages.LOCAL_RESEGMENTATION,
    LEXICON_COVERAGE: stages.LEXICON_COVERAGE,
    RECALL_QUERY: stages.RECALL_QUERY,
    RECALL_FILTERING: stages.RECALL_FILTERING,
    CANDIDATE_ELIGIBILITY: stages.CANDIDATE_ELIGIBILITY,
    CANDIDATE_BUDGET: stages.CANDIDATE_BUDGET,
    PATH_BINDING: stages.PATH_BINDING,
    ASSEMBLY_MATERIALIZATION:
      stages.ASSEMBLY_MATERIALIZATION === 'PARTIAL_PROXY' ? 'FAIL' : stages.ASSEMBLY_MATERIALIZATION,
    KENLM_SELECTION: stages.KENLM_SELECTION,
    NO_REPAIRABLE_TARGET: repair.repairabilityClass === 'NO_REPAIRABLE_TARGET' ? 'PASS' : undefined,
    OUTSIDE_MODEL3_SCOPE: repair.repairabilityClass === 'OUTSIDE_MODEL3_SCOPE' ? 'PASS' : undefined,
    EVALUATION_AMBIGUITY:
      repair.repairabilityClass === 'REFERENCE_OR_ALIGNMENT_AMBIGUOUS' ||
      repair.repairabilityClass === 'INSUFFICIENT_EVIDENCE'
        ? 'PASS'
        : undefined,
    FINAL_IMPROVED: stages.FINAL_IMPROVED,
  });

  return {
    caseId: caseDef.id,
    outcome,
    baselineFinal,
    s3Final,
    expected,
    repairabilityClass: repair.repairabilityClass,
    repairabilityConfidence: repair.confidence,
    baselineWrong: nBase !== nExp,
    triggerClass,
    logicalRetryCount: retryLogical.length,
    retryRegionCount: regions.length,
    bestRegionCoverage,
    resegmentOk,
    targetInLexicon: targetInLex,
    lexicalUnitCount: lexicalUnits.length,
    anyCandidateReturn: anyCandReturn,
    targetCandidateReturn: targetReturns.length > 0,
    targetReturnCount: targetReturns.length,
    assemblyCloserProxy: Boolean(closerAsm),
    assemblyCloserDist: closerAsm?.dist ?? null,
    matPathRecoverable: matEval.dialog.path_recoverable,
    matLexicalRecoverable: matEval.dialog.lexical_recoverable,
    matAssembled: matEval.dialog.actually_assembled,
    matKenlmAvailable: matEval.dialog.kenlm_available,
    matFirstDivergence: matEval.dialog.first_divergence?.class ?? null,
    poolChanged,
    firstFailOwner: firstFail,
    stages,
    parityPass: Boolean(causal.path_parity?.length || trace?.paths?.length),
  };
}

function uLen(s) {
  return (s || '').length;
}

async function runCase(port, wavPath, jobId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      jobId,
      sessionId: `m3-signal-audit-${jobId}`,
      utteranceIndex: 0,
    }),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

function loadLexiconChecker() {
  try {
    const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
    const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
    const { textToSyllables, syllablesKey } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
    const runtime = new LexiconRuntimeV2();
    const st = runtime.loadFromBundleDir(path.join(REPO, 'node_runtime/lexicon/v3'));
    if (st.status !== 'ok') return null;
    const profile = defaultGeneralProfile();
    return (term) => {
      const syl = textToSyllables(term);
      if (!syl.length) return { exists: false, ambiguous: false };
      const key = syllablesKey(syl);
      const len = syl.length;
      const base = runtime.lookupBaseByExactSurfaceAndPinyin(key, term, len);
      const domainIds = profile.enabledDomains || [];
      let domainHits = [];
      if (len >= 2 && len <= 5) domainHits = runtime.lookupDomainsByPinyinKeyMulti(domainIds, key, len);
      const all = [...base, ...domainHits].filter((h) => h.word === term);
      return { exists: all.length > 0, ambiguous: all.length > 1 };
    };
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const freeze = JSON.parse(fs.readFileSync(FREEZE_PATH, 'utf8'));
  if (freeze.verdict !== 'ACCEPTANCE_HARNESS_FREEZE_PASS') {
    console.error('Harness freeze not PASS');
    process.exit(2);
  }
  const digest = sha256File(path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt'));
  if (digest !== IDENTITY.expectedWeightsSha256) {
    console.error('S3 SHA mismatch');
    process.exit(2);
  }

  if (!skipStart) {
    const b = spawnSync('npm', ['run', 'build:main'], {
      cwd: ELECTRON,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    if (b.status !== 0) process.exit(1);
    killPort(6007);
    killPort(5020);
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
    const warmupWav = path.join(DIALOG_DIR, resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav');
    const asrReady = await waitAsrReady(port, {
      warmupWavPath: warmupWav,
      maxWaitMs: 600000,
      label: 'signal-loss-audit-asr',
    });
    if (!asrReady.ready) process.exit(1);
  }

  const lexiconExists = loadLexiconChecker() || (() => ({ exists: null, ambiguous: true }));

  const rows = [];
  for (const caseDef of cases) {
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    if (!fs.existsSync(wavPath)) continue;
    try {
      const data = await runCase(port, wavPath, `${caseDef.id}-${Date.now()}`);
      rows.push(analyzeCase(caseDef, data, lexiconExists));
      console.log(`[${caseDef.id}] ${rows.at(-1).repairabilityClass} firstFail=${rows.at(-1).firstFailOwner}`);
    } catch (e) {
      rows.push({ caseId: caseDef.id, error: e.message, firstFailOwner: 'UNKNOWN' });
    }
  }

  // Aggregates
  const baselineWrong = rows.filter((r) => r.baselineWrong);
  const rescuable = rows.filter((r) => r.repairabilityClass === 'MODEL3_RESCUABLE');
  const prev17 = new Set(
    fs
      .readFileSync(path.join(OUT_DIR, 'model3_v2_s3_final_case_outcomes.csv'), 'utf8')
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .filter((l) => l.split(',')[11] === 'true')
      .map((l) => l.split(',')[0])
  );

  const ownerCounts = {};
  for (const r of rescuable) {
    ownerCounts[r.firstFailOwner] = (ownerCounts[r.firstFailOwner] || 0) + 1;
  }
  const primaryOwner =
    Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';

  const assembly17 = rows.filter((r) => prev17.has(r.caseId));
  let asmConfirmed = 0;
  let asmNot = 0;
  let asmTraceErr = 0;
  for (const r of assembly17) {
    if (r.targetCandidateReturn && !r.matAssembled && r.assemblyCloserProxy) asmConfirmed += 1;
    else if (r.assemblyCloserProxy && r.matAssembled) asmNot += 1;
    else if (r.assemblyCloserProxy && !r.targetCandidateReturn) asmTraceErr += 1;
    else asmNot += 1;
  }

  const verdict =
    primaryOwner === 'MODEL3_TRIGGER'
      ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_MODEL3_TRIGGER'
      : primaryOwner === 'RETRY_REGION'
        ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_RETRY_REGION'
        : primaryOwner === 'LOCAL_RESEGMENTATION'
          ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_LOCAL_RESEGMENTATION'
          : primaryOwner === 'LEXICON_COVERAGE'
            ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_LEXICON_COVERAGE'
            : primaryOwner === 'RECALL_QUERY' || primaryOwner === 'RECALL_FILTERING'
              ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_RECALL'
              : primaryOwner === 'CANDIDATE_ELIGIBILITY' || primaryOwner === 'CANDIDATE_BUDGET' || primaryOwner === 'PATH_BINDING'
                ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_CANDIDATE_ELIGIBILITY'
                : primaryOwner === 'ASSEMBLY_MATERIALIZATION'
                  ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_ASSEMBLY'
                  : primaryOwner === 'KENLM_SELECTION'
                    ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_PRIMARY_KENLM'
                    : Object.keys(ownerCounts).length >= 3
                      ? 'RETRY_SIGNAL_LOSS_AUDIT_PASS_MULTI_STAGE'
                      : 'RETRY_SIGNAL_LOSS_AUDIT_EVIDENCE_INSUFFICIENT';

  const nextPhase =
    primaryOwner === 'RETRY_REGION'
      ? 'MODEL3_V2_RETRY_REGION_CORRECTION_DESIGN_AUDIT'
      : primaryOwner === 'LOCAL_RESEGMENTATION'
        ? 'MODEL3_V2_LOCAL_RESEGMENTATION_CORRECTION_DESIGN_AUDIT'
        : primaryOwner === 'LEXICON_COVERAGE'
          ? 'MODEL3_V2_LEXICON_COVERAGE_CORRECTION_DESIGN_AUDIT'
          : primaryOwner === 'RECALL_QUERY' || primaryOwner === 'RECALL_FILTERING'
            ? 'MODEL3_V2_RECALL_TARGET_REACHABILITY_CORRECTION_DESIGN_AUDIT'
            : primaryOwner === 'ASSEMBLY_MATERIALIZATION'
              ? 'MODEL3_V2_ASSEMBLY_MATERIALIZATION_CORRECTION_DESIGN_AUDIT'
              : primaryOwner === 'KENLM_SELECTION'
                ? 'MODEL3_V2_KENLM_SELECTION_CORRECTION_DESIGN_AUDIT'
                : verdict.includes('MULTI_STAGE')
                  ? 'MODEL3_V2_MULTI_STAGE_SIGNAL_LOSS_PRIORITIZATION'
                  : 'STOP_AND_REVIEW';

  // Artifacts
  const repCsv = [
    'caseId,baselineWrong,repairabilityClass,confidence,baselineFinal,expected,outcome,firstFailOwner',
  ];
  for (const r of rows) {
    repCsv.push(
      [r.caseId, r.baselineWrong, r.repairabilityClass, r.repairabilityConfidence, r.baselineFinal, r.expected, r.outcome, r.firstFailOwner]
        .map(csvEsc)
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_repairability_classification.csv'), repCsv.join('\n'));

  const geomCsv = [
    'caseId,rescuable,triggerClass,logicalRetryCount,retryRegionCount,bestRegionCoverage,resegmentOk,firstFailOwner',
  ];
  for (const r of rescuable) {
    geomCsv.push(
      [r.caseId, true, r.triggerClass, r.logicalRetryCount, r.retryRegionCount, r.bestRegionCoverage, r.resegmentOk, r.firstFailOwner]
        .map(csvEsc)
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_retry_region_geometry.csv'), geomCsv.join('\n'));

  const recallCsv = [
    'caseId,rescuable,targetInLexicon,lexicalUnitCount,anyCandidateReturn,targetCandidateReturn,targetReturnCount,matLexicalRecoverable,matPathRecoverable,firstFailOwner',
  ];
  for (const r of rescuable) {
    recallCsv.push(
      [
        r.caseId,
        true,
        r.targetInLexicon,
        r.lexicalUnitCount,
        r.anyCandidateReturn,
        r.targetCandidateReturn,
        r.targetReturnCount,
        r.matLexicalRecoverable,
        r.matPathRecoverable,
        r.firstFailOwner,
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_recall_target_reachability.csv'), recallCsv.join('\n'));

  const funnelStages = [
    ['BASELINE_WRONG', baselineWrong.length],
    ['MODEL3_RESCUABLE', rescuable.length],
    ['TARGET_OVERLAP_OR_ADJACENT', rescuable.filter((r) => r.triggerClass !== 'UNRELATED_RETRY_ONLY' && r.triggerClass !== 'NO_RETRY').length],
    ['RETRY_REGION_COVERS', rescuable.filter((r) => r.bestRegionCoverage.includes('COVERS')).length],
    ['LOCAL_RESEGMENTATION_OK', rescuable.filter((r) => r.resegmentOk).length],
    ['TARGET_IN_LEXICON', rescuable.filter((r) => r.targetInLexicon === r.lexicalUnitCount && r.lexicalUnitCount > 0).length],
    ['ANY_CANDIDATE_RETURN', rescuable.filter((r) => r.anyCandidateReturn).length],
    ['TARGET_CANDIDATE_RETURN', rescuable.filter((r) => r.targetCandidateReturn).length],
    ['PATH_RECOVERABLE', rescuable.filter((r) => r.matPathRecoverable).length],
    ['ASSEMBLY_MATERIALIZED', rescuable.filter((r) => r.matAssembled).length],
    ['ASSEMBLY_CLOSER_PROXY', rescuable.filter((r) => r.assemblyCloserProxy).length],
    ['KENLM_AVAILABLE', rescuable.filter((r) => r.matKenlmAvailable).length],
    ['FINAL_IMPROVED', rows.filter((r) => r.outcome === 'IMPROVED').length],
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, 'model3_v2_candidate_survival_funnel.csv'),
    ['stage,count', ...funnelStages.map(([s, c]) => `${s},${c}`)].join('\n')
  );

  const failCsv = [
    'caseId,repairabilityClass,triggerClass,bestRegionCoverage,anyCandidateReturn,targetCandidateReturn,assemblyCloserProxy,matFirstDivergence,firstFailOwner,outcome',
  ];
  for (const r of rows) {
    failCsv.push(
      [
        r.caseId,
        r.repairabilityClass,
        r.triggerClass || '',
        r.bestRegionCoverage || '',
        r.anyCandidateReturn,
        r.targetCandidateReturn,
        r.assemblyCloserProxy,
        r.matFirstDivergence || '',
        r.firstFailOwner,
        r.outcome || '',
      ].join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_signal_loss_first_fail.csv'), failCsv.join('\n'));

  const asm17Csv = [
    'caseId,prevAssemblyCloserProxy,targetCandidateReturn,matAssembled,matKenlmAvailable,poolChanged,revalidation,outcome',
  ];
  for (const r of assembly17) {
    let rev = 'UNKNOWN';
    if (r.targetCandidateReturn && !r.matAssembled && r.assemblyCloserProxy) rev = 'CONFIRMED_ASSEMBLY_LOSS';
    else if (r.assemblyCloserProxy && !r.targetCandidateReturn) rev = 'TRACE_CLASSIFICATION_ERROR';
    else if (r.assemblyCloserProxy && r.matAssembled) rev = 'NOT_ASSEMBLY_LOSS';
    else rev = 'NOT_ASSEMBLY_LOSS';
    asm17Csv.push(
      [r.caseId, r.assemblyCloserProxy, r.targetCandidateReturn, r.matAssembled, r.matKenlmAvailable, r.poolChanged, rev, r.outcome]
        .join(',')
    );
  }
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_assembly17_revalidation.csv'), asm17Csv.join('\n'));

  const summary = {
    phase: 'MODEL3_V2_RETRY_REINTERPRETATION_SIGNAL_LOSS_AUDIT',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    primaryOwner,
    s3Identity: { verified: true, sha256: digest, modelId: IDENTITY.modelId },
    harnessVersion: 'MODEL3_ACCEPTANCE_HARNESS_V1_20260831',
    populations: {
      P0_all: rows.length,
      P1_baselineWrong: baselineWrong.length,
      P2_provenRescuable: rescuable.length,
      P3_targetRelevantRetry: rescuable.filter((r) => r.triggerClass === 'TARGET_OVERLAP' || r.triggerClass === 'TARGET_ADJACENT_SAME_LOCAL_REGION').length,
      P4_regionCovers: rescuable.filter((r) => r.bestRegionCoverage.includes('COVERS')).length,
      P5_targetReachable: rescuable.filter((r) => r.targetCandidateReturn).length,
      P6_targetReturned: rescuable.filter((r) => r.targetCandidateReturn).length,
      P7_assemblyViable: rescuable.filter((r) => r.assemblyCloserProxy || r.matAssembled).length,
      P8_kenlmViable: rescuable.filter((r) => r.matKenlmAvailable).length,
    },
    repairability: {
      BASELINE_ALREADY_CORRECT: rows.filter((r) => r.repairabilityClass === 'BASELINE_ALREADY_CORRECT').length,
      BASELINE_WRONG: baselineWrong.length,
      MODEL3_RESCUABLE: rescuable.length,
      NO_REPAIRABLE_TARGET: rows.filter((r) => r.repairabilityClass === 'NO_REPAIRABLE_TARGET').length,
      OUTSIDE_MODEL3_SCOPE: rows.filter((r) => r.repairabilityClass === 'OUTSIDE_MODEL3_SCOPE').length,
      REFERENCE_OR_ALIGNMENT_AMBIGUOUS: rows.filter((r) => r.repairabilityClass === 'REFERENCE_OR_ALIGNMENT_AMBIGUOUS').length,
      INSUFFICIENT_EVIDENCE: rows.filter((r) => r.repairabilityClass === 'INSUFFICIENT_EVIDENCE').length,
    },
    previousClassificationCorrection: {
      priorRescuable170: 'NOT_FROZEN_RECOMPUTED',
      priorRetryRegion131: 'NOT_FROZEN_RECOMPUTED',
      priorAssembly17: { total: assembly17.length, confirmedAssemblyLoss: asmConfirmed, notAssemblyLoss: asmNot, traceClassificationError: asmTraceErr },
    },
    firstFailOwnerDistribution: ownerCounts,
    unchangedDecomposition: {
      IMPROVED: rows.filter((r) => r.outcome === 'IMPROVED').length,
      REGRESSED: rows.filter((r) => r.outcome === 'REGRESSED').length,
      UNCHANGED: rows.filter((r) => r.outcome === 'UNCHANGED').length,
    },
    governance: {
      model3Changed: false,
      retryChanged: false,
      recallChanged: false,
      lexiconChanged: false,
      assemblyChanged: false,
      kenlmChanged: false,
      jobResultChanged: false,
      asrChanged: false,
      training: false,
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, 'model3_v2_retry_signal_loss_summary.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({ verdict, nextPhase, primaryOwner, rescuable: rescuable.length, baselineWrong: baselineWrong.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
