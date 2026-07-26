/**
 * Phase 0.5 pre-lattice baseline seal probe (offline assembly path).
 *
 * Scope: dialog_200 GT text → Span Assembly V4 (LTR Fine Span) → candidates.
 * Uses Electron ABI. Does NOT modify production code.
 *
 * KenLM Top-K: attempted via createKenlmBatchScorer when model present;
 * otherwise recorded as NOT AVAILABLE (see unavailable_metrics.md).
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\lattice_v1_baseline\seal-baseline-probe.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import crypto from 'crypto';
import os from 'os';
import v8 from 'v8';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../../..');
const outDir = __dirname;

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
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);

let createKenlmBatchScorer = null;
try {
  ({ createKenlmBatchScorer } = require(
    path.join(dist, 'asr-repair/sentence-rerank/kenlm-scorer.js')
  ));
} catch {
  createKenlmBatchScorer = null;
}

const manifestPath = path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const cases = manifest.cases || manifest;

function sha256File(p) {
  if (!fs.existsSync(p)) return null;
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return `sha256:${h.digest('hex')}`;
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

function memSnap() {
  const m = process.memoryUsage();
  return {
    heapUsed: m.heapUsed,
    heapTotal: m.heapTotal,
    rss: m.rss,
    external: m.external,
    heapLimit: v8.getHeapStatistics().heap_size_limit,
  };
}

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

let kenlmScorer = null;
let kenlmLoadError = null;
if (typeof createKenlmBatchScorer === 'function') {
  try {
    kenlmScorer = createKenlmBatchScorer();
  } catch (e) {
    kenlmLoadError = e instanceof Error ? e.message : String(e);
    kenlmScorer = null;
  }
} else {
  kenlmLoadError = 'createKenlmBatchScorer not available in dist';
}

const initialMem = memSnap();
let peakHeap = initialMem.heapUsed;
let peakRss = initialMem.rss;

const resultsPath = path.join(outDir, 'dialog_200_results.jsonl');
const fineSpanPath = path.join(outDir, 'fine_span_trace.jsonl');
const votePath = path.join(outDir, 'domain_vote_trace.jsonl');
const assemblyPath = path.join(outDir, 'assembly_trace.jsonl');
const kenlmPath = path.join(outDir, 'kenlm_trace.jsonl');
for (const p of [resultsPath, fineSpanPath, votePath, assemblyPath, kenlmPath]) {
  fs.writeFileSync(p, '');
}

const now = () => performance.now();
const rows = [];
let completed = 0;
let failed = 0;
let exceptions = 0;
let emptyCandidate = 0;
let repaired = 0;
let rawUnchanged = 0;
let kenlmReplacement = 0;
let fallbackCount = 0;
let parentTagLookupsProxy = 0;

const latencies = [];
const sqlTotals = [];
const recallReqs = [];
const cacheHits = [];
const cacheMisses = [];

for (const c of cases) {
  const caseId = c.id;
  const text = (c.text || c.utterance || '').trim();
  if (!text) continue;

  runtime.clearLookupCaches();
  const sqlBefore = runtime.getPhysicalStatementStats().total;
  const ngramBefore = runtime.getNgramQueryStats();

  let err = null;
  let assembly = null;
  const t0 = now();
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
      traceCaseId: caseId,
      enableUtteranceRecallCache: true,
    });
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
    exceptions += 1;
  }
  const totalMs = now() - t0;
  const sqlAfter = runtime.getPhysicalStatementStats().total;
  const ngramAfter = runtime.getNgramQueryStats();
  const physicalSql = sqlAfter - sqlBefore;
  // Parent tag lookups increment tierSqlQueries inside lookupTermDomainTagsInScope;
  // no dedicated counter — record ngram miss delta as parent-related SQL proxy + note in unavailable.
  const parentNgramSql = ngramAfter.sqlQueries - ngramBefore.sqlQueries;

  const mem = memSnap();
  peakHeap = Math.max(peakHeap, mem.heapUsed);
  peakRss = Math.max(peakRss, mem.rss);

  if (err) {
    failed += 1;
  } else {
    completed += 1;
  }

  const fineSpans = (assembly?.fwSpans || []).map((s) => ({
    syllableStart: s.syllableStart,
    syllableEnd: s.syllableEnd,
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
    text: s.text ?? null,
    candidateCount: (s.candidates || []).length,
  }));

  const retained = [...(assembly?.metrics?.retainedDomains ?? [])];
  const voteDomain = assembly?.metrics?.utteranceDomain ?? null;
  const candidates = (assembly?.kenlmSentenceCandidates?.combinations || []).map((x) => x.text);
  if (!err && candidates.length === 0) emptyCandidate += 1;

  let finalOutput = text;
  let kenlmTopK = null;
  let kenlmInput = candidates;
  let kenlmMs = null;
  let kenlmStatus = 'NOT_RUN';

  if (!err && kenlmScorer && candidates.length > 0) {
    const k0 = now();
    try {
      const scores = kenlmScorer.scoreBatch(candidates);
      kenlmMs = now() - k0;
      const ranked = candidates
        .map((t, i) => ({ text: t, score: scores[i], rank: i }))
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
      kenlmTopK = ranked.slice(0, 3);
      kenlmStatus = 'OK';
      if (ranked[0] && ranked[0].text !== text) {
        kenlmReplacement += 1;
        repaired += 1;
        finalOutput = ranked[0].text;
      } else {
        rawUnchanged += 1;
        finalOutput = ranked[0]?.text ?? text;
      }
    } catch (e) {
      kenlmStatus = `ERROR:${e instanceof Error ? e.message : String(e)}`;
      rawUnchanged += 1;
    }
  } else if (!err) {
    kenlmStatus = kenlmScorer ? 'NO_CANDIDATES' : 'NOT_AVAILABLE';
    if (candidates.length > 0 && candidates[0] !== text) {
      repaired += 1;
      finalOutput = candidates[0];
    } else {
      rawUnchanged += 1;
    }
  }

  const coord = buildUtteranceSyllableCoordinate(text);
  const row = {
    caseId,
    rawAsr: text,
    fineSpanSequence: fineSpans,
    domainVote: {
      utteranceDomain: voteDomain,
      retainedDomains: retained,
      domainVoteMs: assembly?.metrics?.domainVoteMs ?? null,
    },
    retainedDomains: retained,
    sentenceCandidates: candidates,
    kenlmInputCandidates: kenlmInput,
    kenlmTopK,
    kenlmStatus,
    finalOutput,
    error: err,
    fallbackState: assembly?.metrics?.fallbackReason ?? null,
    latencyMs: totalMs,
    assemblyMs: assembly?.metrics?.assemblyMs ?? null,
    lexiconRecallTotalMs: assembly?.metrics?.lexiconRecallTotalMs ?? null,
    domainVoteMs: assembly?.metrics?.domainVoteMs ?? null,
    kenlmMs,
    sql: {
      physicalSqlStatementCount: physicalSql,
      metricsPhysicalSql: assembly?.metrics?.physicalSqlStatementCount ?? null,
      recallRequestCount: assembly?.metrics?.recallRequestCount ?? null,
      uniqueRecallKeyCount: assembly?.metrics?.uniqueRecallKeyCount ?? null,
      utteranceCacheHitCount: assembly?.metrics?.utteranceCacheHitCount ?? null,
      utteranceCacheMissCount: assembly?.metrics?.utteranceCacheMissCount ?? null,
      parentNgramSqlDelta: parentNgramSql,
      ngramCacheHitsDelta: ngramAfter.cacheHits - ngramBefore.cacheHits,
      ngramCacheMissesDelta: ngramAfter.cacheMisses - ngramBefore.cacheMisses,
    },
    syllableCount: coord.syllables?.length ?? null,
  };

  rows.push(row);
  latencies.push(totalMs);
  sqlTotals.push(physicalSql);
  recallReqs.push(assembly?.metrics?.recallRequestCount ?? 0);
  cacheHits.push(assembly?.metrics?.utteranceCacheHitCount ?? 0);
  cacheMisses.push(assembly?.metrics?.utteranceCacheMissCount ?? 0);
  parentTagLookupsProxy += parentNgramSql;

  fs.appendFileSync(resultsPath, JSON.stringify(row) + '\n');
  fs.appendFileSync(
    fineSpanPath,
    JSON.stringify({ caseId, fineSpanSequence: fineSpans, syllableCount: row.syllableCount }) + '\n'
  );
  fs.appendFileSync(
    votePath,
    JSON.stringify({ caseId, ...row.domainVote }) + '\n'
  );
  fs.appendFileSync(
    assemblyPath,
    JSON.stringify({
      caseId,
      sentenceCandidates: candidates,
      kenlmPoolCandidateCount: candidates.length,
      intervalAssemblyCandidateCount: assembly?.metrics?.intervalAssemblyCandidateCount ?? null,
    }) + '\n'
  );
  fs.appendFileSync(
    kenlmPath,
    JSON.stringify({
      caseId,
      kenlmStatus,
      kenlmInputCount: kenlmInput.length,
      kenlmTopK,
      kenlmMs,
      finalOutput,
    }) + '\n'
  );
}

const finalMem = memSnap();
const latencyMetrics = summarize(latencies);
const sqlMetrics = {
  physicalSqlPerCase: summarize(sqlTotals),
  totalPhysicalSql: sqlTotals.reduce((a, b) => a + b, 0),
  recallRequestPerCase: summarize(recallReqs),
  utteranceCacheHitPerCase: summarize(cacheHits),
  utteranceCacheMissPerCase: summarize(cacheMisses),
  parentNgramSqlDeltaTotal: parentTagLookupsProxy,
  note:
    'lookupTermDomainTagsInScope increments tierSqlQueries but has no dedicated counter; parentNgramSqlDelta is parent ngram SQL only. Dedicated parent-tag call count = NOT AVAILABLE without production instrumentation (forbidden in Phase 0.5).',
};

const summary = {
  mode: 'offline_gt_text_assembly_electron_abi',
  total: rows.length,
  completed,
  failed,
  exceptions,
  timeouts: 0,
  rawUnchangedCount: rawUnchanged,
  repairedCount: repaired,
  kenlmReplacementCount: kenlmReplacement,
  fallbackCount,
  emptyCandidateCount: emptyCandidate,
  kenlmScorerAvailable: Boolean(kenlmScorer),
  kenlmLoadError,
  latency: latencyMetrics,
};

fs.writeFileSync(path.join(outDir, 'dialog_200_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'sql_metrics.json'), JSON.stringify(sqlMetrics, null, 2));
fs.writeFileSync(path.join(outDir, 'latency_metrics.json'), JSON.stringify(latencyMetrics, null, 2));
fs.writeFileSync(
  path.join(outDir, 'memory_metrics.json'),
  JSON.stringify(
    {
      scope: 'dialog_200_full_pass_process_peak',
      initial: initialMem,
      peakHeapUsed: peakHeap,
      peakRss,
      final: finalMem,
    },
    null,
    2
  )
);

const env = {
  os: `${os.type()} ${os.release()}`,
  arch: os.arch(),
  cpus: os.cpus().map((c) => c.model),
  cpuCount: os.cpus().length,
  totalMemBytes: os.totalmem(),
  freeMemBytes: os.freemem(),
  nodeProcessVersions: process.versions,
  electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
  cwd: process.cwd(),
};
fs.writeFileSync(path.join(outDir, 'environment.json'), JSON.stringify(env, null, 2));

const packageLock =
  fs.existsSync(path.join(root, 'package-lock.json'))
    ? sha256File(path.join(root, 'package-lock.json'))
    : null;
const manifestJson = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const identity = {
  capturedAt: new Date().toISOString(),
  gitBranch: null,
  gitSha: null,
  lexicon: {
    schemaVersion: manifestJson.schemaVersion,
    bundleVersion: manifestJson.bundleVersion,
    checksum: manifestJson.checksum,
    lastPatchId: manifestJson.lastPatchId,
    manifestSha256: sha256File(path.join(bundleDir, 'manifest.json')),
    checksumFile: fs.readFileSync(path.join(bundleDir, 'checksum.txt'), 'utf8').trim(),
    sqliteSha256: sha256File(path.join(bundleDir, 'lexicon.sqlite')),
  },
  dialog200: {
    manifestPath: 'test wav/dialog_200/cases.manifest.json',
    manifestSha256: sha256File(manifestPath),
    caseCount: rows.length,
  },
  packageLockSha256: packageLock,
  kenlm: {
    scorerAvailable: Boolean(kenlmScorer),
    loadError: kenlmLoadError,
  },
  runtimeConfigSha256: sha256File(
    path.join(root, 'config/fw-detector.runtime.json')
  ),
};
fs.writeFileSync(path.join(outDir, 'baseline_identity.json'), JSON.stringify(identity, null, 2));

const md = `# dialog_200 Baseline Summary (Phase 0.5)

Mode: **offline GT text → Span Assembly V4 (Electron ABI)**

| Metric | Value |
|--------|-------|
| total | ${summary.total} |
| completed | ${summary.completed} |
| failed | ${summary.failed} |
| exceptions | ${summary.exceptions} |
| raw unchanged | ${summary.rawUnchangedCount} |
| repaired (candidate≠raw or KenLM) | ${summary.repairedCount} |
| KenLM replacement | ${summary.kenlmReplacementCount} |
| empty candidates | ${summary.emptyCandidateCount} |
| KenLM scorer | ${summary.kenlmScorerAvailable ? 'available' : 'NOT AVAILABLE'} |
| P50 ms | ${latencyMetrics?.p50} |
| P95 ms | ${latencyMetrics?.p95} |
| max ms | ${latencyMetrics?.max} |
| total physical SQL | ${sqlMetrics.totalPhysicalSql} |

Artifacts under \`docs/tone-v2/_audit_scratch/lattice_v1_baseline/\`.
`;
fs.writeFileSync(path.join(outDir, 'dialog_200_summary.md'), md);

console.log(JSON.stringify(summary, null, 2));
console.log('wrote artifacts to', outDir);
