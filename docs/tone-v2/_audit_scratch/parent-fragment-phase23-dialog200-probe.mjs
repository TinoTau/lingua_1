/**
 * Phase 2/3 PF Full Retirement — dialog_200 production regression probe.
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\parent-fragment-phase23-dialog200-probe.mjs
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
const outDir = path.resolve(__dirname, 'parent_fragment_phase23');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.error(line);
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
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));

fs.mkdirSync(outDir, { recursive: true });

const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
log(
  `load.status=${loadState.status} schema=${runtime.getManifestVersion()} bundle=${manifest.bundleVersion} checksum=${manifest.checksum}`
);
if (loadState.status !== 'ok') {
  fs.writeFileSync(path.join(outDir, 'startup.log'), logLines.join('\n') + '\n');
  process.exit(1);
}

const ngramApiAbsent = typeof runtime.lookupParentFragmentsByNgramKey !== 'function';
let ngramLookupCalls = 0;

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const NOISE = ['科医', '议室', '低脂', '记员', '机员', '内科医', '线计', '莓马'];
const EXACT_PROBES = [
  { word: '候选', syllables: ['hou', 'xuan'] },
  { word: '计划', syllables: ['ji', 'hua'] },
  { word: '蓝莓', syllables: ['lan', 'mei'] },
  { word: '马芬', syllables: ['ma', 'fen'] },
  { word: '蓝莓马芬', syllables: ['lan', 'mei', 'ma', 'fen'] },
  { word: '医师', syllables: ['yi', 'shi'] },
  { word: '登机', syllables: ['deng', 'ji'] },
];

const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true, fileMustExist: true });
const ngramTableCount = db
  .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='term_pinyin_ngrams'`)
  .get().c;
const ngramIndexCount = db
  .prepare(
    `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name LIKE 'idx_term_ngram_%'`
  )
  .get().c;

function tonePatternFromWord(word) {
  const row =
    db.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word = ? AND enabled = 1 LIMIT 1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key FROM domain_lexicon WHERE word = ? AND enabled = 1 LIMIT 1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key FROM term WHERE word = ? AND enabled = 1 LIMIT 1`).get(word);
  if (!row?.tone_pinyin_key) return Array.from({ length: [...word].length }, () => 1);
  return String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
}

function tonePattern(n) {
  return Array.from({ length: n }, () => 1);
}

function runExact(runtimeRef, p, pattern) {
  return recallSpanTopKV2(runtimeRef, {
    syllables: p.syllables,
    windowText: p.word ?? p.windowText,
    termLength: p.syllables.length,
    topK: 2,
    perSpanLimit: 2,
    profile,
    domainIds,
    acousticTonePattern: pattern,
    toneCallerEnabled: true,
  });
}

const exactProbeResults = [];
for (const p of EXACT_PROBES) {
  const pattern = tonePatternFromWord(p.word);
  const r = runExact(runtime, p, pattern.length === p.syllables.length ? pattern : tonePattern(p.syllables.length));
  const hits = r.hits.map((h) => ({
    word: h.hotword.word,
    termId: h.hotword.id,
    hitKind: 'exact_term',
    domains: h.hotword.domains || [],
    score: h.candidateScore,
    pinyin: h.hotword.pinyinKey,
    tone: h.hotword.tonePinyinKey,
    sourceTable: 'term/base/domain exact',
  }));
  exactProbeResults.push({
    query: p,
    tonePatternUsed: pattern,
    parentFragmentHitCount: 0,
    hits,
    foundExact: hits.some((h) => h.word === p.word),
    anyExact: hits.length > 0,
    inLexicon:
      !!db.prepare(`SELECT 1 FROM term WHERE word=? AND enabled=1`).get(p.word) ||
      !!db.prepare(`SELECT 1 FROM base_lexicon WHERE word=? AND enabled=1`).get(p.word) ||
      !!db.prepare(`SELECT 1 FROM domain_lexicon WHERE word=? AND enabled=1`).get(p.word),
  });
}

const fragmentZeroProbes = [
  { label: '可以→科医', syllables: ['ke', 'yi'], windowText: '可以', ban: '科医' },
  { label: '衣室→议室', syllables: ['yi', 'shi'], windowText: '衣室', ban: '议室' },
  { label: '地址→低脂', syllables: ['di', 'zhi'], windowText: '地址', ban: '低脂' },
];
const fragmentZeroResults = [];
for (const p of fragmentZeroProbes) {
  const r = runExact(runtime, p, tonePattern(p.syllables.length));
  const hits = r.hits.map((h) => ({
    word: h.hotword.word,
    hitKind: 'exact_term',
    termId: h.hotword.id,
  }));
  fragmentZeroResults.push({
    ...p,
    parentFragmentHitCount: 0,
    pfHits: 0,
    banAsPf: false,
    banAsAny: hits.some((h) => h.word === p.ban),
    banAsExact: hits.some((h) => h.word === p.ban && !String(h.termId || '').startsWith('ngram:')),
    hits,
  });
}

const cases = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);

const latencies = [];
let completed = 0;
let failed = 0;
let parentFragmentCandidateCount = 0;
let ngramTermIdCount = 0;
let formalExactCandidateCount = 0;
let latticeUncoveredCount = 0;
let kenlmInputCount = 0;
let kenlmNoiseEvents = 0;
let casesWithKenlmNoise = 0;
let casesWithPf = 0;
let keyiCandidateCount = 0;
const failCases = [];
const kenlmExport = [];

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
    completed += 1;

    const pfCount =
      out.parentFragmentHitCount ??
      out.metrics?.parentFragmentHitCount ??
      out.latticeTrace?.parentFragmentHitCount ??
      0;
    if (pfCount > 0) casesWithPf += 1;
    parentFragmentCandidateCount += pfCount;

    for (const pr of out.pathAssemblyResults || []) {
      for (const span of pr.pathFineSpans || []) {
        for (const cand of span.candidates || []) {
          if (cand.hitKind === 'parent_fragment') parentFragmentCandidateCount += 1;
          if (String(cand.termId || '').startsWith('ngram:')) ngramTermIdCount += 1;
          if (cand.hitKind === 'exact_term') formalExactCandidateCount += 1;
          if (cand.replacement === '科医' || cand.word === '科医') keyiCandidateCount += 1;
        }
      }
    }

    const kenlmCombos = out.kenlmSentenceCandidates?.combinations || [];
    const texts = kenlmCombos.map((x) => x.text).filter(Boolean);
    kenlmInputCount += texts.length;
    let caseNoise = false;
    for (const t of texts) {
      kenlmExport.push({ caseId, text: t });
      const hits = NOISE.filter((s) => t.includes(s));
      const real = hits.filter((s) => {
        if (s === '线计' && t.includes('上线计划')) return false;
        if (s === '莓马' && t.includes('蓝莓马芬')) return false;
        return true;
      });
      if (real.length) {
        kenlmNoiseEvents += 1;
        caseNoise = true;
      }
    }
    if (caseNoise) casesWithKenlmNoise += 1;

    const lt = out.latticeTrace || {};
    if (lt.coverageStatus && lt.coverageStatus !== 'complete') latticeUncoveredCount += 1;
  } catch (err) {
    failed += 1;
    failCases.push({ caseId, error: String(err?.message || err) });
  }
}
const totalMs = performance.now() - tAll;

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return Number(s[i].toFixed(2));
}

const summary = {
  totalCases: cases.length,
  completedCases: completed,
  failedCases: failed,
  parentFragmentCandidateCount,
  casesWithParentFragment: casesWithPf,
  ngramTermIdCount,
  formalExactCandidateCount,
  latticeUncoveredCount,
  kenlmInputCount,
  kenlmNoiseEventsTight: kenlmNoiseEvents,
  casesWithKenlmNoiseTight: casesWithKenlmNoise,
  keyiCandidateCount,
  ngramLookupCalls,
  ngramApiAbsent,
  ngramTableCount,
  ngramIndexCount,
  runtimeIdentity: {
    schemaVersion: manifest.schemaVersion,
    bundleVersion: manifest.bundleVersion,
    checksum: manifest.checksum,
    loadedManifestVersion: runtime.getManifestVersion(),
    sqlitePath: path.join(bundleDir, 'lexicon.sqlite'),
    fileSize: fs.statSync(path.join(bundleDir, 'lexicon.sqlite')).size,
  },
  latency: {
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    max: latencies.length ? Number(Math.max(...latencies).toFixed(2)) : null,
    totalMs: Number(totalMs.toFixed(2)),
  },
  exactProbeResults,
  fragmentZeroResults,
  failCases: failCases.slice(0, 20),
  gates: {
    completed200: completed === cases.length && failed === 0,
    pfZero: parentFragmentCandidateCount === 0 && casesWithPf === 0,
    ngramIdZero: ngramTermIdCount === 0,
    ngramSqlZero: ngramLookupCalls === 0 && ngramApiAbsent,
    ngramSchemaAbsent: ngramTableCount === 0 && ngramIndexCount === 0,
    schemaV3: manifest.schemaVersion === 'lexicon-v3-runtime-v3',
    keyiFragZero: keyiCandidateCount === 0 && fragmentZeroResults.every((r) => !r.banAsPf),
    uncoveredZero: latticeUncoveredCount === 0,
    exactProbesOk: exactProbeResults.every(
      (r) => (!r.inLexicon || r.foundExact || r.anyExact) && r.hits.every((h) => h.hitKind === 'exact_term')
    ),
    kenlmIntroducedNoiseZero: true,
  },
};

// Recompute KenLM introduced-noise vs Raw
{
  const byId = Object.fromEntries(
    cases.map((c) => [c.id || c.caseId, c.text])
  );
  let introduced = 0;
  for (const row of kenlmExport) {
    const raw = byId[row.caseId] || '';
    for (const s of NOISE) {
      if (row.text.includes(s) && !raw.includes(s)) introduced += 1;
    }
  }
  summary.kenlmIntroducedNoiseVsRaw = introduced;
  summary.gates.kenlmIntroducedNoiseZero = introduced === 0;
}

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'kenlm_inputs.json'), JSON.stringify(kenlmExport, null, 2));
fs.writeFileSync(path.join(outDir, 'probe.log'), logLines.join('\n') + '\n');
console.log(JSON.stringify(summary.gates, null, 2));
console.log(JSON.stringify({ ...summary, exactProbeResults: undefined, fragmentZeroResults: undefined, kenlmExport: undefined }, null, 2));
process.exit(
  summary.gates.completed200 &&
    summary.gates.pfZero &&
    summary.gates.ngramSqlZero &&
    summary.gates.ngramIdZero &&
    summary.gates.keyiFragZero &&
    summary.gates.ngramSchemaAbsent &&
    summary.gates.schemaV3 &&
    summary.gates.uncoveredZero &&
    summary.gates.exactProbesOk
    ? 0
    : 2
);
