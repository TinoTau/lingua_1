/**
 * Phase 0 + Phase 1 offline probe:
 * - dialog_200 GT text assembly (200/200 target)
 * - Baseline A (no utterance cache) vs Candidate B (cache) semantic equivalence
 * - Performance before/after Phase 1 on same corpus
 *
 * Run with Electron ABI:
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe docs/tone-v2/_audit_scratch/phase0-phase1-utterance-cache-probe.mjs
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
const { blockedFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/blocked-window-filter.js')
);
const { generateLocalOptionsAtCursor } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js')
);

const LATIN_CASES = [
  '去望京SOHO测试',
  '去A酒店',
  'USB接口坏了',
  'WiFi密码是多少',
  '去OK便利店',
  '机场T2航站楼',
  '去望京SOHO，不走四环可以吗？那边现在堵不堵？',
  '去望京SOHO，不走机场高速可以吗？那边现在堵不堵？',
];

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

function runAssembly(text, caseId, enableCache) {
  return runSpanAssemblyV4Orchestrator({
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
    enableUtteranceRecallCache: enableCache,
  });
}

function canonicalizeCandidates(assembly) {
  const spans = assembly.fwSpans || [];
  const rows = [];
  for (const span of spans) {
    for (const c of span.candidates || []) {
      rows.push({
        spanId: span.spanId ?? null,
        text: c.word ?? c.replacement ?? c.text ?? null,
        candidateId: c.candidateId ?? null,
        source: c.source ?? null,
        hitKind: c.hitKind ?? null,
        domains: [...(c.domains ?? [])].sort().join(','),
        parentTermId: c.parentTermId ?? null,
        toneLookupStage: c.toneLookupStage ?? null,
        score: c.score ?? c.candidateScore ?? null,
        windowId: c.windowId ?? null,
        syllableStart: c.syllableStart ?? span.syllableStart ?? null,
        syllableEnd: c.syllableEnd ?? span.syllableEnd ?? null,
        rawStart: c.rawStart ?? span.rawStart ?? null,
        rawEnd: c.rawEnd ?? span.rawEnd ?? null,
      });
    }
  }
  rows.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b))
  );
  return rows;
}

function semanticFingerprint(assembly) {
  return {
    formal: (assembly.fwSpans || []).map((s) => ({
      start: s.syllableStart,
      end: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      text: s.text ?? null,
    })),
    voteDomain: assembly.metrics?.utteranceDomain ?? null,
    retained: [...(assembly.metrics?.retainedDomains ?? [])].sort(),
    sentences: [...(assembly.kenlmSentenceCandidates?.combinations ?? []).map((c) => c.text)].sort(),
    candidates: canonicalizeCandidates(assembly),
  };
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

// --- Latin mixed unit checks ---
let latinMixedCasesPassed = 0;
let coverageInvariantFailures = 0;
let crossLatinGapRecallWindowCount = 0;
for (const raw of LATIN_CASES) {
  const coord = buildUtteranceSyllableCoordinate(raw);
  if (!coord.coverage.coverageOk) coverageInvariantFailures += 1;
  if (coord.syllables.includes('s') && coord.syllables.includes('o')) {
    // Latin leaked into FineSpan
  } else if (coord.coverage.coverageOk) {
    // probe cross-gap at SOHO if present
    if (raw.includes('SOHO')) {
      const soho = raw.indexOf('SOHO');
      const beforeSyl = coord.syllables.length
        ? Math.max(
            0,
            coord.ranges.find((r) => r.charEnd <= soho)?.syllableEnd - 1 ?? 0
          )
        : 0;
      const afterRange = coord.ranges.find((r) => r.charStart >= soho + 4);
      if (afterRange) {
        const opt = generateLocalOptionsAtCursor({
          cursor: beforeSyl,
          rawText: raw,
          globalSyllables: coord.syllables,
          coarseSpans: coord.ranges.map((r, i) => ({
            id: `c${i}`,
            text: raw.slice(r.charStart, r.charEnd),
            rawStart: r.charStart,
            rawEnd: r.charEnd,
            syllableStart: r.syllableStart,
            syllableEnd: r.syllableEnd,
            source: 'punctuation_fallback',
            boundaryConfidence: 0.3,
          })),
          charSyllableRanges: coord.ranges,
        }).find((o) => o.syllableEnd > afterRange.syllableStart && o.syllableStart < afterRange.syllableStart);
        if (opt) {
          const filtered = blockedFilter({
            windows: [opt],
            rawText: raw,
            coarseSpans: coord.ranges.map((r, i) => ({
              id: `c${i}`,
              text: raw.slice(r.charStart, r.charEnd),
              rawStart: r.charStart,
              rawEnd: r.charEnd,
              syllableStart: r.syllableStart,
              syllableEnd: r.syllableEnd,
              source: 'punctuation_fallback',
              boundaryConfidence: 0.3,
            })),
            wordTimeSpans: [],
          });
          if (filtered[0]?.blocked) {
            // good — blocked, not recalled
          } else {
            crossLatinGapRecallWindowCount += 1;
          }
        }
      }
    }
    try {
      runAssembly(raw, 'latin', true);
      latinMixedCasesPassed += 1;
    } catch {
      // fail
    }
  }
}

// --- dialog_200: fair cold Global-LRU per case; A then B as separate passes ---
const cases = manifest.cases;
const beforeRows = [];
const afterRows = [];
let semanticMatch = 0;
let semanticTotal = 0;
const now = () => performance.now();

function runPass(enableCache, outRows) {
  for (const c of cases) {
    const text = (c.text || c.utterance || '').trim();
    if (!text) continue;
    runtime.clearLookupCaches();
    let err = null;
    let assembly = null;
    const t0 = now();
    try {
      assembly = runAssembly(text, c.id, enableCache);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const total = now() - t0;
    outRows.push({
      caseId: c.id,
      error: err,
      assemblyMs: assembly?.metrics?.assemblyMs ?? null,
      totalMs: total,
      ngramQueryCount: assembly?.metrics?.ngramQueryCount ?? null,
      physicalSqlStatementCount: assembly?.metrics?.physicalSqlStatementCount ?? null,
      recallRequestCount: assembly?.metrics?.recallRequestCount ?? null,
      uniqueRecallKeyCount: assembly?.metrics?.uniqueRecallKeyCount ?? null,
      duplicateRecallKeyCount: assembly?.metrics?.duplicateRecallKeyCount ?? null,
      utteranceCacheHitCount: assembly?.metrics?.utteranceCacheHitCount ?? null,
      utteranceCacheMissCount: assembly?.metrics?.utteranceCacheMissCount ?? null,
      lexiconRecallTotalMs: assembly?.metrics?.lexiconRecallTotalMs ?? null,
      fingerprint: assembly && !err ? semanticFingerprint(assembly) : null,
    });
  }
}

runPass(false, beforeRows);
runPass(true, afterRows);

for (let i = 0; i < beforeRows.length; i += 1) {
  const a = beforeRows[i];
  const b = afterRows[i];
  if (a.fingerprint && b.fingerprint) {
    semanticTotal += 1;
    if (JSON.stringify(a.fingerprint) === JSON.stringify(b.fingerprint)) {
      semanticMatch += 1;
    }
  }
}

const okBefore = beforeRows.filter((r) => !r.error);
const okAfter = afterRows.filter((r) => !r.error);

const sum = (rows, key) =>
  rows.reduce((s, r) => s + (typeof r[key] === 'number' ? r[key] : 0), 0);

const probe = {
  phase0: {
    dialog200SuccessCount: okAfter.length,
    dialog200ErrorCount: afterRows.length - okAfter.length,
    latinMixedCasesPassed,
    coverageInvariantFailures,
    crossLatinGapRecallWindowCount,
    errorCases: afterRows.filter((r) => r.error).map((r) => ({ caseId: r.caseId, error: r.error })),
  },
  phase1: {
    recallRequestCount: sum(okAfter, 'recallRequestCount'),
    uniqueRecallKeyCount: sum(okAfter, 'uniqueRecallKeyCount'),
    duplicateRecallKeyCount: sum(okAfter, 'duplicateRecallKeyCount'),
    utteranceCacheHitCount: sum(okAfter, 'utteranceCacheHitCount'),
    utteranceCacheMissCount: sum(okAfter, 'utteranceCacheMissCount'),
    physicalSqlStatementCountBefore: sum(okBefore, 'physicalSqlStatementCount'),
    physicalSqlStatementCountAfter: sum(okAfter, 'physicalSqlStatementCount'),
    // Baseline A does not populate physicalSql — use ngramQueryCount as logical attempts;
    // physical SQL after is the measured statement delta from tier counters.
    logicalRecallAttemptsBefore: sum(okBefore, 'ngramQueryCount'),
    logicalRecallAttemptsAfter: sum(okAfter, 'ngramQueryCount'),
    semanticEquivalenceRate: semanticTotal ? semanticMatch / semanticTotal : null,
    semanticMatchCount: semanticMatch,
    semanticTotalCount: semanticTotal,
  },
  performance: {
    before: {
      p50Ms: summarize(okBefore.map((r) => r.assemblyMs))?.p50 ?? null,
      p90Ms: summarize(okBefore.map((r) => r.assemblyMs))?.p90 ?? null,
      p95Ms: summarize(okBefore.map((r) => r.assemblyMs))?.p95 ?? null,
      p99Ms: summarize(okBefore.map((r) => r.assemblyMs))?.p99 ?? null,
      maxMs: summarize(okBefore.map((r) => r.assemblyMs))?.max ?? null,
      meanMs: summarize(okBefore.map((r) => r.assemblyMs))?.mean ?? null,
      assemblyMs: summarize(okBefore.map((r) => r.assemblyMs)),
      lexiconRecallTotalMs: summarize(okBefore.map((r) => r.lexiconRecallTotalMs)),
    },
    after: {
      p50Ms: summarize(okAfter.map((r) => r.assemblyMs))?.p50 ?? null,
      p90Ms: summarize(okAfter.map((r) => r.assemblyMs))?.p90 ?? null,
      p95Ms: summarize(okAfter.map((r) => r.assemblyMs))?.p95 ?? null,
      p99Ms: summarize(okAfter.map((r) => r.assemblyMs))?.p99 ?? null,
      maxMs: summarize(okAfter.map((r) => r.assemblyMs))?.max ?? null,
      meanMs: summarize(okAfter.map((r) => r.assemblyMs))?.mean ?? null,
      assemblyMs: summarize(okAfter.map((r) => r.assemblyMs)),
      lexiconRecallTotalMs: summarize(okAfter.map((r) => r.lexiconRecallTotalMs)),
      recallRequestCount: summarize(okAfter.map((r) => r.recallRequestCount)),
      uniqueRecallKeyCount: summarize(okAfter.map((r) => r.uniqueRecallKeyCount)),
      duplicateRecallKeyCount: summarize(okAfter.map((r) => r.duplicateRecallKeyCount)),
      utteranceCacheHitCount: summarize(okAfter.map((r) => r.utteranceCacheHitCount)),
      physicalSqlStatementCount: summarize(okAfter.map((r) => r.physicalSqlStatementCount)),
    },
  },
  architecture: {
    localBatchImplemented: false,
    concurrencyImplemented: false,
    redisImplemented: false,
    parentSemanticsChanged: false,
  },
};

const outPath = path.resolve(__dirname, '../phase0_phase1_utterance_cache_probe.json');
fs.writeFileSync(outPath, JSON.stringify(probe, null, 2));
console.log(JSON.stringify(probe, null, 2));
console.log('wrote', outPath);
runtime.close();
