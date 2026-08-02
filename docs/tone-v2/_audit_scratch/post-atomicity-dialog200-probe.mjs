/**
 * Post-Atomicity dialog_200 regression + KenLM input export.
 * Hard gates: completedCases=200, failedCases=0, latticeUncovered=0.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'post_atomicity_dialog200');
const docsTone = path.join(repo, 'docs/tone-v2');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));

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

const bundleDir = path.resolve(repo, process.env.LEXICON_BUNDLE || 'node_runtime/lexicon/v3');
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') {
  console.error(loadState);
  process.exit(1);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const cases = JSON.parse(
  fs.readFileSync(path.resolve(repo, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
}

function esc(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

let completedCases = 0;
let failedCases = 0;
let latticeUncovered = 0;
let formalExactCandidateCount = 0;
let bucketCount = 0;
let assemblyCount = 0;
let crossPathCount = 0;
let kenlmInputCount = 0;
const retainedDomainHist = {};
const latencies = [];
const failCases = [];
const exportRows = [];
const results = [];

const tAll = performance.now();
for (const c of cases) {
  const caseId = c.id || c.caseId || 'unknown';
  const t0 = performance.now();
  try {
    const out = runSpanAssemblyV4Orchestrator({
      rawText: c.text,
      runtime,
      profile,
      recallDomainScope: domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      domainPriors: [],
    });
    const ms = performance.now() - t0;
    latencies.push(ms);
    completedCases += 1;

    const lt = out.latticeTrace || {};
    const coverage = lt.coverageStatus;
    if (coverage && coverage !== 'complete') {
      latticeUncovered += 1;
      failCases.push({ caseId, issue: 'lattice_uncovered', coverage });
    }

    const vote = out.utteranceDomainVote || out.domainVoteTrace || {};
    const retained = vote.retainedDomains || out.retainedDomains || [];
    for (const d of retained) {
      retainedDomainHist[d] = (retainedDomainHist[d] || 0) + 1;
    }

    const pathTraces = out.pathAssemblyTraces || [];
    for (const pt of pathTraces) {
      const buckets = pt?.bucketTraces || pt?.buckets || [];
      bucketCount += Array.isArray(buckets) ? buckets.length : 0;
      assemblyCount += pt?.sentenceCandidateCount || 0;
      formalExactCandidateCount +=
        pt?.formalExactCandidateCount ||
        (pt?.edgeHitKinds || []).filter((k) => k === 'exact' || k === 'formal_exact').length ||
        0;
    }

    const crossIn =
      out.metrics?.crossPathInputCandidateCount ?? out.crossPathMergeTrace?.inputCount ?? 0;
    crossPathCount += crossIn;

    const combos = out.kenlmSentenceCandidates?.combinations || [];
    kenlmInputCount += combos.length;

    for (let i = 0; i < combos.length; i += 1) {
      const x = combos[i] || {};
      exportRows.push({
        caseId,
        rawText: c.text,
        candidateId: x.candidateId || x.id || `case:${caseId}:idx:${i}`,
        text: x.text || '',
        sourcePath: x.sourcePath || x.pathId || '',
        bucketDomain: x.bucketDomain || x.domain || '',
        preKenLMScore: x.preKenLMScore ?? x.score ?? '',
        isRaw: x.isRaw === true || x.marker === 'raw' || x.source === 'raw' ? '1' : '0',
        isCanonical: x.isCanonical === true || x.marker === 'canonical' ? '1' : '0',
        replacementProvenance: JSON.stringify(
          x.replacementProvenance || x.provenance || x.spanReplacements || null
        ),
        retainedDomains: (retained || []).join('|'),
        latencyMs: Math.round(ms),
      });
    }

    results.push({
      caseId,
      ok: !(coverage && coverage !== 'complete'),
      kenlmN: combos.length,
      retainedDomains: retained,
      latencyMs: Math.round(ms),
    });
  } catch (err) {
    failedCases += 1;
    failCases.push({ caseId, issue: 'orchestrator_throw', message: String(err?.message || err) });
  }
}

latencies.sort((a, b) => a - b);
const summary = {
  generatedAt: new Date().toISOString(),
  bundleDir,
  lexiconLoad: loadState.status,
  contentHash: loadState.contentHash || loadState.checksum || null,
  casesTotal: cases.length,
  completedCases,
  failedCases,
  latticeUncovered,
  formalExactCandidateCount,
  retainedDomainHist,
  bucketCount,
  assemblyCount,
  crossPathCount,
  kenlmInputCount,
  PreKenLM: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.round(latencies[latencies.length - 1]) : 0,
    totalMs: Math.round(performance.now() - tAll),
  },
  hardGatePass: completedCases === 200 && failedCases === 0 && latticeUncovered === 0,
  failCases,
};

const csvHeader = [
  'caseId',
  'rawText',
  'candidateId',
  'text',
  'sourcePath',
  'bucketDomain',
  'preKenLMScore',
  'isRaw',
  'isCanonical',
  'replacementProvenance',
  'retainedDomains',
  'latencyMs',
];
const csvLines = [csvHeader.join(',')];
for (const r of exportRows) {
  csvLines.push(csvHeader.map((h) => esc(r[h])).join(','));
}
fs.writeFileSync(path.join(docsTone, 'dialog200_post_atomicity_candidate_export.csv'), `${csvLines.join('\n')}\n`);
fs.writeFileSync(path.join(outDir, 'dialog200_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'dialog200_results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n'));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.hardGatePass ? 0 : 2);
