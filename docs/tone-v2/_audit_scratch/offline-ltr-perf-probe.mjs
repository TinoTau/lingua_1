/**
 * Offline production-assembly performance probe (GT text + real lexicon + IME).
 * NOT full dialog_200 WAV/ASR/Tone path — labeled offline_assembly in output.
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

// Ensure lexicon bundle resolution finds repo-root node_runtime
process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

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
const { textToPinyinStream } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { getPerSpanCandidateLimit } = require(
  path.join(dist, 'fw-detector/per-span-candidate-limit.js')
);

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);

const runtime = new LexiconRuntimeV2();
const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') {
  console.error('lexicon load failed', loadState);
  process.exit(1);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
const recallDomainScope = recallScope.domainIds;
if (!recallDomainScope.length) {
  console.error('empty recallDomainScope');
  process.exit(1);
}

const cases = manifest.cases;
const results = [];
const now = () => performance.now();

for (const c of cases) {
  const text = (c.text || c.utterance || '').trim();
  if (!text) continue;
  const { syllables } = textToPinyinStream(text);
  const t0 = now();
  let err = null;
  let assembly = null;
  try {
    assembly = runSpanAssemblyV4Orchestrator({
      rawText: text,
      runtime,
      profile,
      recallDomainScope,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      asrSegments: undefined,
      acousticSlices: undefined,
      domainPriors: [],
      traceCaseId: c.id,
    });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const total = now() - t0;
  if (!assembly) {
    results.push({
      caseId: c.id,
      error: err,
      syllableCount: syllables.length,
      diagnosticsMode: 'off',
      probeKind: 'offline_assembly_gt_text',
      timingMs: { total },
    });
    continue;
  }

  const m = assembly.metrics;
  const formalCount = m.coarseSpanCount > 0 ? (assembly.fwSpans?.length ?? null) : 0;
  // Prefer architecture / span counts from metrics when available
  const formalFineSpanCount =
    typeof m.inSpanWindowCount === 'number' && typeof m.boundaryWindowCount === 'number'
      ? // formal = in_span + boundary + fallback; fallback not directly counted — use fwSpans
        assembly.fwSpans?.length ?? null
      : assembly.fwSpans?.length ?? null;

  const emptyFallbackSpanCount = (assembly.fwSpans || []).filter(
    (s) => !s.candidates?.length
  ).length;
  const activeCandidateSpanCount = (assembly.fwSpans || []).filter(
    (s) => (s.candidates?.length ?? 0) > 0
  ).length;

  results.push({
    caseId: c.id,
    probeKind: 'offline_assembly_gt_text',
    note: 'GT text + real lexicon/IME; NO WAV ASR; NO acoustic tone slices; KenLM not run',
    syllableCount: syllables.length,
    coarseSpanCount: m.coarseSpanCount ?? null,
    rawWindowCount: m.globalWindowGeneratedCount ?? null,
    blockedWindowCount: m.blockedWindowCount ?? null,
    recallableWindowCount: m.ngramQueryCount ?? null,
    sqlQueryCount: m.ngramQueryCount ?? null,
    uniqueSqlQueryKeyCount: null,
    duplicateSqlQueryCount: null,
    formalFineSpanCount,
    activeCandidateSpanCount,
    emptyFallbackSpanCount,
    effectivePerSpanLimit: getPerSpanCandidateLimit(formalFineSpanCount || 1),
    compatibilityComparisonCount: null,
    compatibilityEdgeCount: m.compatibilityEdgeCount ?? null,
    activeCandidateCount: m.activeCandidateCount ?? null,
    sentenceCandidateCount: m.kenlmPoolCandidateCount ?? null,
    intervalAssemblyCandidateCount: m.intervalAssemblyCandidateCount ?? null,
    sqlBudgetExhausted: (m.ngramQueryCount ?? 0) >= 150,
    domainVoteMs: m.domainVoteMs ?? null,
    domainAssemblyMs: m.domainAssemblyMs ?? null,
    assemblyMs: m.assemblyMs ?? null,
    timingMs: {
      coarsePartition: null,
      ltrGeneration: null,
      blockedFilter: null,
      pinyinPreparation: null,
      tonePattern: null,
      lexiconRecall: null,
      formalCommit: null,
      compatibilityGraph: null,
      domainVote: m.domainVoteMs ?? null,
      sentenceAssembly: null,
      kenlm: null,
      total,
      assemblyWall: m.assemblyMs ?? null,
    },
    diagnosticsMode: 'off',
    architectureCompliance: m.architectureCompliance ?? null,
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(vals) {
  const a = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, v) => s + v, 0);
  return {
    min: a[0],
    p50: percentile(a, 50),
    p90: percentile(a, 90),
    p95: percentile(a, 95),
    p99: percentile(a, 99),
    max: a[a.length - 1],
    mean: sum / a.length,
    n: a.length,
  };
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? null : num / den;
}

const ok = results.filter((r) => !r.error);
const summary = {
  probeKind: 'offline_assembly_gt_text',
  runtimeDialog200WavAsr: 'RUNTIME INCOMPLETE',
  caseCount: results.length,
  okCount: ok.length,
  errorCount: results.length - ok.length,
  recallDomainScopeCount: recallDomainScope.length,
  stats: {
    totalMs: summarize(ok.map((r) => r.timingMs.total)),
    assemblyMs: summarize(ok.map((r) => r.assemblyMs)),
    sqlQueryCount: summarize(ok.map((r) => r.sqlQueryCount)),
    rawWindowCount: summarize(ok.map((r) => r.rawWindowCount)),
    formalFineSpanCount: summarize(ok.map((r) => r.formalFineSpanCount)),
    sentenceCandidateCount: summarize(ok.map((r) => r.sentenceCandidateCount)),
    intervalAssemblyCandidateCount: summarize(ok.map((r) => r.intervalAssemblyCandidateCount)),
    activeCandidateCount: summarize(ok.map((r) => r.activeCandidateCount)),
    compatibilityEdgeCount: summarize(ok.map((r) => r.compatibilityEdgeCount)),
    syllableCount: summarize(ok.map((r) => r.syllableCount)),
  },
  correlations: {
    syllableCount_vs_totalMs: pearson(
      ok.map((r) => r.syllableCount),
      ok.map((r) => r.timingMs.total)
    ),
    sqlQueryCount_vs_totalMs: pearson(
      ok.map((r) => r.sqlQueryCount ?? 0),
      ok.map((r) => r.timingMs.total)
    ),
    formalFineSpanCount_vs_totalMs: pearson(
      ok.map((r) => r.formalFineSpanCount ?? 0),
      ok.map((r) => r.timingMs.total)
    ),
    activeCandidateCount_vs_totalMs: pearson(
      ok.map((r) => r.activeCandidateCount ?? 0),
      ok.map((r) => r.timingMs.total)
    ),
  },
  sqlBudgetExhaustedCount: ok.filter((r) => r.sqlBudgetExhausted).length,
  tailCases: {
    maxTotalMs: [...ok].sort((a, b) => b.timingMs.total - a.timingMs.total).slice(0, 5),
    maxSql: [...ok].sort((a, b) => (b.sqlQueryCount ?? 0) - (a.sqlQueryCount ?? 0)).slice(0, 5),
    maxFormal: [...ok]
      .sort((a, b) => (b.formalFineSpanCount ?? 0) - (a.formalFineSpanCount ?? 0))
      .slice(0, 5),
    maxIntervalEnum: [...ok]
      .sort(
        (a, b) => (b.intervalAssemblyCandidateCount ?? 0) - (a.intervalAssemblyCandidateCount ?? 0)
      )
      .slice(0, 5),
  },
};

const out = { summary, cases: results };
const outPath = path.resolve(__dirname, '../dialog200_ltr_performance_probe.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('wrote', outPath);
runtime.close();
