/**
 * SameDomain Multi-Candidate Assembly Restoration Acceptance
 * Runs A01/B01/C01 + targeted 43 + dialog_200 after eligibility repair.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'same_domain_multi_candidate_restoration');
const casesDir = path.join(outDir, 'cases');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[restore] ${m}`);
}
function pct(n, d) {
  return d ? Math.round((10000 * n) / d) / 100 : 0;
}
function stats(arr) {
  if (!arr.length) return { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, n: 0 };
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const at = (p) => a[Math.min(n - 1, Math.floor(n * p))];
  return {
    min: +a[0].toFixed(3),
    mean: +mean.toFixed(3),
    p50: +at(0.5).toFixed(3),
    p90: +at(0.9).toFixed(3),
    p95: +at(0.95).toFixed(3),
    p99: +at(0.99).toFixed(3),
    max: +a[n - 1].toFixed(3),
    n,
  };
}

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { runFwSentenceRerankFromPrefilled } = require(
  path.join(dist, 'fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.js')
);
const { createKenlmBatchScorer } = require(
  path.join(dist, 'asr-repair/sentence-rerank/kenlm-scorer.js')
);
const {
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  getSentenceKenlmRuntimeStatus,
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
log(`lexicon=${loadState.status}`);
if (loadState.status !== 'ok') process.exit(1);

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

fs.mkdirSync(casesDir, { recursive: true });

function runOrch(rawText, caseId) {
  return runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    traceCaseId: caseId,
  });
}

function analyze(caseId, rawText, orch) {
  const pathResults = orch.pathAssemblyResults || [];
  const prefilled = orch.kenlmSentenceCandidates?.combinations || [];
  const uniqueBefore = orch.kenlmSentenceCandidates?.uniqueBeforeCap || prefilled;
  const bucketDetails = [];
  let maxTheo = 0;
  const allAsm = new Set();
  const dropReasons = new Set();
  let exactTermOnlyResidual = false;

  for (const pr of pathResults) {
    const grids = pr.assemblyResult?.bucketSpanSets || [];
    const retained = pr.assemblyResult?.vote?.retainedDomains?.length
      ? [...pr.assemblyResult.vote.retainedDomains]
      : [null];
    const filteredPrimary = pr.assemblyResult?.filteredSets || [];
    for (const set of filteredPrimary) {
      for (const d of set.assemblyDropTraces || []) {
        dropReasons.add(d.dropReason);
        if (String(d.dropReason).includes('windowCandidateToDomainAwarePick_null')) {
          exactTermOnlyResidual = true;
        }
      }
    }
    for (let bi = 0; bi < grids.length; bi++) {
      const grid = grids[bi] || [];
      const perSpanSurfaces = grid.map((slot) => [...new Set(slot.map((p) => p.word))]);
      let theo = 1;
      for (const s of perSpanSurfaces) theo *= Math.max(1, s.length);
      maxTheo = Math.max(maxTheo, theo);
      const gen = (pr.perBucketGenerated || [])[bi] || [];
      for (const c of gen) allAsm.add(c.text);
      bucketDetails.push({
        domainId: retained[bi] ?? null,
        perSpanSurfaceCounts: perSpanSurfaces.map((s) => s.length),
        perSpanSurfaces: perSpanSurfaces.map((s) => s.slice(0, 8)),
        theoretical: theo,
        generated: gen.length,
        distinct: new Set(gen.map((c) => c.text)).size,
        texts: gen.map((c) => c.text),
      });
    }
  }

  const prefilledTexts = prefilled.map((c) => c.text);
  return {
    caseId,
    rawText,
    retainedDomains: pathResults[0]?.assemblyResult?.vote?.retainedDomains || [],
    bucketDetails,
    theoreticalCombinationCount: maxTheo,
    assemblyDistinctTextCount: allAsm.size,
    assemblyTexts: [...allAsm],
    crossPathDistinctCount: new Set(uniqueBefore.map((c) => c.text)).size,
    prefilledCount: prefilled.length,
    prefilledDistinct: new Set(prefilledTexts).size,
    prefilledTexts,
    kenlmInputCount: prefilled.length,
    dropReasons: [...dropReasons],
    exactTermOnlyResidual,
    multiGrid: maxTheo > 1,
    capOk: prefilled.length <= 16,
  };
}

async function maybeKenlm(rawText, orch) {
  const combos = orch.kenlmSentenceCandidates?.combinations || [];
  if (combos.length <= 1) {
    return { skipped: true, reason: 'prefilledCount<=1', prefilledCount: combos.length };
  }
  let status = null;
  let modelPath = null;
  let queryPath = null;
  let envError = null;
  try {
    status = getSentenceKenlmRuntimeStatus();
    modelPath = resolveCharLmModelPath();
    queryPath = resolveKenlmQueryPath();
  } catch (e) {
    envError = String(e && e.message ? e.message : e);
  }
  const kenlmRunnable =
    Boolean(modelPath) && Boolean(queryPath) && isKenlmSubprocessRunnable(modelPath, queryPath);
  let scorer = null;
  try {
    scorer = createKenlmBatchScorer();
  } catch (e) {
    return {
      skipped: true,
      reason: 'KenLM environment/config blocker',
      envError: String(e && e.message ? e.message : e),
      kenlmRunnable,
      status,
      modelPath,
      queryPath,
      prefilledCount: combos.length,
      inputTexts: combos.map((c) => c.text),
    };
  }
  if (!scorer || !kenlmRunnable) {
    return {
      skipped: true,
      reason: 'KenLM environment/config blocker',
      envError,
      kenlmRunnable,
      status,
      modelPath,
      queryPath,
      prefilledCount: combos.length,
      inputTexts: combos.map((c) => c.text),
    };
  }
  const t0 = performance.now();
  try {
    const result = await runFwSentenceRerankFromPrefilled({
      rawText,
      spans: orch.fwSpans || [],
      spanSets: orch.spanSets || [],
      config: {
        minPrior: fwConfig.minPrior,
        maxSentenceCandidates: fwConfig.maxSentenceCandidates,
        minDeltaToReplace: fwConfig.minDeltaToReplace,
        candidateRequireRepairTarget: fwConfig.candidateRequireRepairTarget,
      },
      kenlmScorer: scorer,
      prefilledCombinations: combos,
    });
    const totalMs = performance.now() - t0;
    const sr = result.sentenceRerank || {};
    const ranked = sr.rankedCandidates || sr.candidates || [];
    return {
      skipped: false,
      prefilledCount: combos.length,
      inputTexts: combos.map((c) => c.text),
      ranking: (Array.isArray(ranked) ? ranked : [])
        .slice(0, 16)
        .map((c, i) => ({
          rank: i + 1,
          text: c.text || c.sentence || String(c),
          score: c.kenlmScore ?? c.score ?? c.finalScore,
        })),
      top1: sr.bestSentence || ranked[0]?.text || combos[0]?.text || null,
      totalMs,
      kenlmQueryCount: result.kenlmQueryCount,
      modelPath,
      queryPath,
    };
  } catch (e) {
    return {
      skipped: true,
      reason: 'KenLM runtime error',
      error: String(e && e.stack ? e.stack : e),
      prefilledCount: combos.length,
      inputTexts: combos.map((c) => c.text),
      totalMs: performance.now() - t0,
      modelPath,
      queryPath,
    };
  }
}

const targetedPath = path.join(__dirname, 'pre_kenlm_candidate_pool_acceptance/targeted_cases.json');
const targeted = JSON.parse(fs.readFileSync(targetedPath, 'utf8'));
const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string' && c.text.length);

const focusIds = new Set(['A01', 'B01', 'C01']);

async function main() {
  log('TARGETED_START');
  const rows = [];
  for (const tc of targeted) {
    const t0 = performance.now();
    let orch;
    let err = null;
    try {
      orch = runOrch(tc.text, tc.caseId);
    } catch (e) {
      err = String(e && e.stack ? e.stack : e);
    }
    const orchMs = performance.now() - t0;
    if (err) {
      const row = { caseId: tc.caseId, text: tc.text, error: err, orchMs };
      rows.push(row);
      fs.writeFileSync(path.join(casesDir, `${tc.caseId}.json`), JSON.stringify(row, null, 2));
      continue;
    }
    const analyzed = analyze(tc.caseId, tc.text, orch);
    analyzed.orchMs = orchMs;
    analyzed.groups = tc.group;
    analyzed.why = tc.why;
    if (focusIds.has(tc.caseId) || analyzed.prefilledDistinct > 1) {
      analyzed.kenlm = await maybeKenlm(tc.text, orch);
    } else {
      analyzed.kenlm = { skipped: true, reason: 'prefilledCount<=1', prefilledCount: analyzed.prefilledCount };
    }
    rows.push(analyzed);
    fs.writeFileSync(path.join(casesDir, `${tc.caseId}.json`), JSON.stringify(analyzed, null, 2));
  }

  const focus = Object.fromEntries(rows.filter((r) => focusIds.has(r.caseId)).map((r) => [r.caseId, r]));
  const summary = {
    targetedN: rows.length,
    errors: rows.filter((r) => r.error).length,
    prefilledGt1: rows.filter((r) => (r.prefilledDistinct || 0) > 1).length,
    multiGrid: rows.filter((r) => r.multiGrid).length,
    exactTermOnlyResidual: rows.some((r) => r.exactTermOnlyResidual),
    capViolations: rows.filter((r) => r.capOk === false).length,
    focus: {
      A01: focus.A01 && {
        prefilledDistinct: focus.A01.prefilledDistinct,
        texts: focus.A01.prefilledTexts,
        multiGrid: focus.A01.multiGrid,
        kenlm: focus.A01.kenlm,
      },
      B01: focus.B01 && {
        prefilledDistinct: focus.B01.prefilledDistinct,
        texts: focus.B01.prefilledTexts,
        multiGrid: focus.B01.multiGrid,
        kenlm: focus.B01.kenlm,
      },
      C01: focus.C01 && {
        prefilledDistinct: focus.C01.prefilledDistinct,
        texts: focus.C01.prefilledTexts,
        multiGrid: focus.C01.multiGrid,
        kenlm: focus.C01.kenlm,
      },
    },
    acceptance: {
      A01_ge3: (focus.A01?.prefilledDistinct || 0) >= 3,
      B01_ge4: (focus.B01?.prefilledDistinct || 0) >= 4,
      C01_gt1: (focus.C01?.prefilledDistinct || 0) > 1,
      noExactTermResidual: !rows.some((r) => r.exactTermOnlyResidual),
      noCapViolations: rows.every((r) => r.error || r.capOk !== false),
    },
  };
  fs.writeFileSync(path.join(outDir, 'targeted_summary.json'), JSON.stringify(summary, null, 2));
  log(
    `targeted prefilledGt1=${summary.prefilledGt1}/${summary.targetedN} A01=${summary.focus.A01?.prefilledDistinct} B01=${summary.focus.B01?.prefilledDistinct} C01=${summary.focus.C01?.prefilledDistinct}`
  );

  log('DIALOG200_START');
  const d200 = [];
  const orchMsArr = [];
  let structFail = 0;
  for (const c of dialogCases) {
    const t0 = performance.now();
    try {
      const orch = runOrch(c.text, c.id);
      const ms = performance.now() - t0;
      orchMsArr.push(ms);
      const n = orch.kenlmSentenceCandidates?.combinations?.length ?? 0;
      if (n > 16) structFail += 1;
      d200.push({ caseId: c.id, prefilledCount: n, orchMs: ms, ok: n <= 16 });
    } catch (e) {
      structFail += 1;
      d200.push({ caseId: c.id, error: String(e && e.message ? e.message : e), ok: false });
    }
  }
  const d200Summary = {
    n: d200.length,
    structFail,
    prefilledGt1: d200.filter((r) => (r.prefilledCount || 0) > 1).length,
    orchPerf: stats(orchMsArr),
  };
  fs.writeFileSync(path.join(outDir, 'dialog200_summary.json'), JSON.stringify(d200Summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'dialog200_rows.json'), JSON.stringify(d200, null, 2));
  log(`dialog200 n=${d200Summary.n} fail=${structFail} prefilledGt1=${d200Summary.prefilledGt1} p95=${d200Summary.orchPerf.p95}`);

  const report = { summary, d200Summary, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(outDir, 'restoration_acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(summary.acceptance, null, 2));
  console.log(JSON.stringify(summary.focus, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
