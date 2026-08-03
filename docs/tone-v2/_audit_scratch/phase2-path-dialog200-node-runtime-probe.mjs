/**
 * Phase 2 Code Verification — Node-runtime-equivalent lexicon probe (dialog_200).
 *
 * Environment class target: C — Offline harness with real SQLite Recall
 * (LexiconRuntimeV2 via Electron ABI; same path as Phase1/FW acceptance gates).
 *
 * NOT production Electron GUI (`npm start`). NOT mock recall.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\phase2-path-dialog200-node-runtime-probe.mjs
 *
 * Outputs (does NOT overwrite lattice_v1_phase2/):
 *   docs/tone-v2/_audit_scratch/lattice_v1_phase2_node_runtime/
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
const outDir = path.resolve(__dirname, 'lattice_v1_phase2_node_runtime');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const startupLog = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  startupLog.push(line);
  console.error(line);
}

log(`cwd=${process.cwd()}`);
log(`ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE || ''}`);
log(`process.versions.electron=${process.versions.electron || 'none'}`);
log(`process.versions.node=${process.versions.node}`);
log(`repoRoot=${repoRoot}`);

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
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { runPhase2PathHarnessFromLexicalEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase2-path-harness.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { enumerateCompleteSegmentationPaths } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));

const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');
const manifestPath = path.join(bundleDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const sqliteBytes = fs.statSync(sqlitePath).size;

log(`bundleDir=${bundleDir}`);
log(`sqlitePath=${sqlitePath}`);
log(`sqliteBytes=${sqliteBytes}`);
log(`manifest.bundleVersion=${manifest.bundleVersion}`);
log(`manifest.tables.term=${manifest.tables?.term}`);
log(`manifest.tables.term_domain_tags=${manifest.tables?.term_domain_tags}`);

const runtime = new LexiconRuntimeV2();
const tLoad0 = performance.now();
const loadState = runtime.loadFromBundleDir(bundleDir);
const loadMs = performance.now() - tLoad0;
log(`loadFromBundleDir.status=${loadState.status}`);
log(`loadFromBundleDir.ms=${Math.round(loadMs)}`);
if (loadState.status !== 'ok') {
  log(`load FAILED: ${JSON.stringify(loadState)}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'node_startup_evidence.log'), startupLog.join('\n') + '\n');
  process.exit(1);
}
log('LexiconRuntimeV2 READY (SQLite operational lexicon loaded)');
log(`manifestVersion=${runtime.getManifestVersion?.() ?? 'unknown'}`);

// Optional direct SQL counts (same ABI).
try {
  const Database = require(path.join(root, 'node_modules/better-sqlite3'));
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const tableNames = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  log(`sqlite.tables=${tableNames.join(',')}`);
  for (const name of ['term', 'terms', 'hotwords', 'term_domain_tags', 'domain_hierarchy', 'ngrams']) {
    if (!tableNames.includes(name)) continue;
    const c = db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get().c;
    log(`sqlite.count.${name}=${c}`);
  }
  db.close();
  log('sqlite.readonly probe OK');
} catch (err) {
  log(`sqlite.direct_count_error=${err && err.message ? err.message : String(err)}`);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
const domainIds = recallScope.domainIds;
log(`recall.domainIds=${domainIds.join('|')}`);
log(`fwConfig.minPrior=${fwConfig.minPrior}`);
log('Recall service path: phase1 harness → recallTopKForWindows (NO mock)');

const casesManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const cases = (casesManifest.cases || []).filter((c) => typeof c.text === 'string' && c.text.length > 0);

function mapBlockedReason(reason) {
  if (!reason) return 'HARD_BLOCKED_WINDOW';
  if (reason === 'non_cjk_syllable') return 'NON_CJK_GAP';
  if (reason === 'punctuation_in_window' || reason === 'whitespace_gap') return 'LATIN_OR_PUNCT_GAP';
  if (reason === 'raw_gap_between_spans') return 'LATIN_OR_PUNCT_GAP';
  if (reason === 'asr_word_gap_ms') return 'ASR_GAP';
  if (reason === 'sentence_boundary') return 'HARD_BLOCKED_WINDOW';
  return 'HARD_BLOCKED_WINDOW';
}

function classifyFallbackAtPosition(input) {
  const { pos, phase1, lexicalEdgeStarts, syllableCount } = input;
  const windowsAtPos = phase1.filteredWindows.filter((w) => w.syllableStart === pos);
  const blocked = windowsAtPos.filter((w) => w.blocked);
  const recallable = windowsAtPos.filter((w) => !w.blocked);
  const recalled = phase1.recalledWindows.filter((w) => {
    const [s] = w.windowId.split(':').map(Number);
    return s === pos;
  });
  const recallHitCount = recalled.reduce((n, w) => n + (w.candidates?.length || 0), 0);
  const lexicalFromPos = lexicalEdgeStarts.get(pos) || [];

  let fallbackReason = 'UNKNOWN';
  if (lexicalFromPos.length === 0) {
    if (windowsAtPos.length === 0) {
      fallbackReason = 'COORDINATE_GAP';
    } else if (recallable.length === 0 && blocked.length > 0) {
      fallbackReason = mapBlockedReason(blocked[0].blockedBoundaryReason);
    } else if (recallable.length > 0 && recallHitCount === 0) {
      fallbackReason = 'NO_LEXICON_HIT';
    } else if (recallable.length > 0 && recallHitCount > 0) {
      // Hits existed but no edge — edge builder dropped empty? or only longer windows with hits that didn't form edge at this start
      const edgesFromHits = phase1.edges.filter((e) => e.syllableStart === pos);
      if (edgesFromHits.length === 0) {
        fallbackReason = 'EDGE_BUILD_DROPPED_CANDIDATES';
      } else {
        fallbackReason = 'UNKNOWN';
      }
    }
  } else {
    // Lexical edges exist from pos but min-cost reconstruction still used fallback
    // (dead-end branches that do not reach N cheaper than a fallback path).
    fallbackReason = 'UNKNOWN';
  }

  const rawStart =
    windowsAtPos[0]?.rawStart ??
    recalled[0]?.candidates?.[0]?.rawStart ??
    null;
  const rawEnd =
    windowsAtPos.find((w) => w.syllableEnd === pos + 1)?.rawEnd ??
    windowsAtPos[0]?.rawEnd ??
    null;

  return {
    syllableStart: pos,
    syllableEnd: pos + 1,
    rawStart,
    rawEnd,
    fallbackReason,
    windowsAtPosition: windowsAtPos.length,
    blockedWindowCount: blocked.length,
    recallableWindowCount: recallable.length,
    recallExecuted: recallable.length > 0,
    recallHitCount,
    candidateCountBeforeFilter: recallHitCount,
    candidateCountAfterFilter: recallHitCount,
    lexicalEdgeExists: lexicalFromPos.length > 0,
    lexicalOutgoingCount: lexicalFromPos.length,
    blockedReasons: [...new Set(blocked.map((w) => w.blockedBoundaryReason).filter(Boolean))],
    syllableCount,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const latencies = [];
const rows = [];
const fallbackCaseRows = [];
const zeroLexicalPathCases = [];
const highPathCases = [];
const capCases = [];
const reasonDist = {};
const reasonSentenceSets = {};
const fallbackBucket = { '0': 0, '1-2': 0, '3-5': 0, '6-10': 0, '11+': 0 };

let completed = 0;
let failed = 0;
let sumRecallable = 0;
let sumCandidates = 0;
let sumLexicalEdges = 0;
let sumFallbackInj = 0;
let sumPhysicalSql = 0;
let sumRetained = 0;
let multiPath = 0;
let utterancesNeedingFallback = 0;
let zeroLexicalOnly = 0;
let incompleteRecall = 0;
let uniqueBoundaryKeyViolations = 0;
let unstablePathIdViolations = 0;
let candidateReferenceCopyViolations = 0;

const heapStart = process.memoryUsage().heapUsed;
const tAll = performance.now();

for (const c of cases) {
  const caseId = c.id || c.caseId || `case_${completed + failed}`;
  try {
    const t0 = performance.now();
    const phase1 = runPhase1WindowEdgeHarness({
      rawText: c.text,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      measureHeap: false,
    });
    const d1 = phase1.diagnostics;
    if (d1.logicalWindowRecallCount !== d1.recallableWindowCount) {
      incompleteRecall += 1;
    }

    const coordinate = buildUtteranceSyllableCoordinate(c.text);
    const lexicalOnlyEnum = enumerateCompleteSegmentationPaths({
      syllableCount: phase1.syllableCount,
      lexicalEdges: phase1.edges,
      limits: {
        maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
        maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
      },
    });

    const phase2 = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: caseId,
      rawText: c.text,
      coordinate,
      syllableCount: phase1.syllableCount,
      lexicalEdges: phase1.edges,
    });

    const phase2b = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: caseId,
      rawText: c.text,
      coordinate,
      syllableCount: phase1.syllableCount,
      lexicalEdges: phase1.edges,
    });
    if (JSON.stringify(phase2.boundaryKeys) !== JSON.stringify(phase2b.boundaryKeys)) {
      unstablePathIdViolations += 1;
    }
    if (
      JSON.stringify(phase2.paths.map((p) => p.pathId)) !==
      JSON.stringify(phase2b.paths.map((p) => p.pathId))
    ) {
      unstablePathIdViolations += 1;
    }
    if (new Set(phase2.boundaryKeys).size !== phase2.boundaryKeys.length) {
      uniqueBoundaryKeyViolations += 1;
    }
    for (let i = 0; i < phase2.paths.length; i += 1) {
      const path = phase2.paths[i];
      const view = phase2.pathFineSpanViews[i];
      for (let j = 0; j < path.edgeRefs.length; j += 1) {
        if (view.formalFineSpans[j].candidates !== path.edgeRefs[j].candidates) {
          candidateReferenceCopyViolations += 1;
        }
      }
    }

    const ms = performance.now() - t0;
    latencies.push(ms);

    const lexicalEdgeStarts = new Map();
    for (const e of phase1.edges) {
      const list = lexicalEdgeStarts.get(e.syllableStart) || [];
      list.push(e);
      lexicalEdgeStarts.set(e.syllableStart, list);
    }

    // Fallback positions from injected edges
    const fallbackEdges = [];
    for (const e of phase2.fallbackInjectionEdgeIds || []) {
      // ids like fallback:start:end
      const m = /^fallback:(\d+):(\d+)$/.exec(e);
      if (m) fallbackEdges.push({ start: Number(m[1]), end: Number(m[2]) });
    }
    // Prefer ranges expansion if edge ids missing
    if (!fallbackEdges.length && phase2.fallbackInjectionCount > 0) {
      for (const r of phase2.fallbackInjectionRanges) {
        for (let p = r.start; p < r.end; p += 1) {
          fallbackEdges.push({ start: p, end: p + 1 });
        }
      }
    }

    const fallbackDetails = [];
    for (const fb of fallbackEdges) {
      const detail = classifyFallbackAtPosition({
        pos: fb.start,
        phase1,
        lexicalEdgeStarts,
        syllableCount: phase1.syllableCount,
      });
      detail.sentenceId = caseId;
      detail.rawText = c.text;
      fallbackDetails.push(detail);
      reasonDist[detail.fallbackReason] = (reasonDist[detail.fallbackReason] || 0) + 1;
      if (!reasonSentenceSets[detail.fallbackReason]) {
        reasonSentenceSets[detail.fallbackReason] = new Set();
      }
      reasonSentenceSets[detail.fallbackReason].add(caseId);
    }

    const lexicalOnlyComplete = lexicalOnlyEnum.completePathCountBeforePrune;
    if (lexicalOnlyComplete === 0) {
      zeroLexicalOnly += 1;
      zeroLexicalPathCases.push({
        caseId,
        syllableCount: phase1.syllableCount,
        lexicalEdgeCount: phase1.edges.length,
        fallbackInjectionCount: phase2.fallbackInjectionCount,
        retainedPathCount: phase2.retainedCompletePathCount,
      });
    }
    if (phase2.fallbackInjectionCount > 0) {
      utterancesNeedingFallback += 1;
      fallbackCaseRows.push({
        caseId,
        fallbackInjectionCount: phase2.fallbackInjectionCount,
        fallbackInjectionRanges: phase2.fallbackInjectionRanges,
        details: fallbackDetails,
      });
    }

    const fbCount = phase2.fallbackInjectionCount;
    if (fbCount === 0) fallbackBucket['0'] += 1;
    else if (fbCount <= 2) fallbackBucket['1-2'] += 1;
    else if (fbCount <= 5) fallbackBucket['3-5'] += 1;
    else if (fbCount <= 10) fallbackBucket['6-10'] += 1;
    else fallbackBucket['11+'] += 1;

    if (phase2.capEvents?.length) {
      capCases.push({ caseId, capEvents: phase2.capEvents });
    }
    if (phase2.completePathCountBeforePrune > 16) {
      highPathCases.push({
        caseId,
        completePathCountBeforePrune: phase2.completePathCountBeforePrune,
        retainedCompletePathCount: phase2.retainedCompletePathCount,
      });
    }
    if (phase2.retainedCompletePathCount > 1) multiPath += 1;

    sumRecallable += d1.recallableWindowCount || 0;
    sumCandidates += d1.candidateCount || 0;
    sumLexicalEdges += phase1.edges.length;
    sumFallbackInj += phase2.fallbackInjectionCount;
    sumPhysicalSql += d1.physicalSqlStatementCount || 0;
    sumRetained += phase2.retainedCompletePathCount;

    rows.push({
      caseId,
      syllableCount: phase1.syllableCount,
      windowCount: d1.windowCount,
      blockedWindowCount: d1.blockedWindowCount,
      recallableWindowCount: d1.recallableWindowCount,
      logicalWindowRecallCount: d1.logicalWindowRecallCount,
      uniqueRecallKeyCount: d1.uniqueRecallKeyCount,
      cacheHitCount: d1.cacheHitCount,
      cacheMissCount: d1.cacheMissCount,
      physicalSqlStatementCount: d1.physicalSqlStatementCount,
      candidateCount: d1.candidateCount,
      lexicalEdgeCount: phase1.edges.length,
      fallbackEdgeCount: phase2.fallbackEdgeCount,
      fallbackInjectionCount: phase2.fallbackInjectionCount,
      completePathCountBeforeFallback: lexicalOnlyComplete,
      completePathCountAfterFallback: phase2.completePathCountBeforePrune,
      retainedPathCount: phase2.retainedCompletePathCount,
      boundaryKeys: phase2.boundaryKeys,
      fallbackReasons: fallbackDetails.map((d) => d.fallbackReason),
      latencyMs: Math.round(ms * 100) / 100,
    });
    completed += 1;
  } catch (err) {
    failed += 1;
    rows.push({ caseId, error: err && err.message ? err.message : String(err) });
  }
}

latencies.sort((a, b) => a - b);
const heapEnd = process.memoryUsage().heapUsed;

const reasonDistribution = Object.keys(reasonDist)
  .sort((a, b) => reasonDist[b] - reasonDist[a])
  .map((reason) => ({
    reason,
    count: reasonDist[reason],
    ratio: sumFallbackInj ? reasonDist[reason] / sumFallbackInj : 0,
    sentenceCount: reasonSentenceSets[reason]?.size || 0,
    exampleSentenceIds: [...(reasonSentenceSets[reason] || [])].slice(0, 8),
  }));

const typicalByReason = {};
for (const r of reasonDistribution) {
  const ex = fallbackCaseRows.find((fc) =>
    (fc.details || []).some((d) => d.fallbackReason === r.reason)
  );
  if (ex) {
    const d = ex.details.find((x) => x.fallbackReason === r.reason);
    typicalByReason[r.reason] = {
      sentenceId: ex.caseId,
      syllableStart: d.syllableStart,
      windowsAtPosition: d.windowsAtPosition,
      recallHitCount: d.recallHitCount,
      blockedReasons: d.blockedReasons,
      rawTextSnippet: (d.rawText || '').slice(0, 40),
    };
  }
}

log(`dialog_200 completed=${completed} failed=${failed}`);
log(`physicalSql.sum=${sumPhysicalSql} candidates.sum=${sumCandidates} edges.sum=${sumLexicalEdges}`);
log(`fallback utterances=${utterancesNeedingFallback} injection.sum=${sumFallbackInj}`);
log(`incompleteRecallCases=${incompleteRecall}`);

const summary = {
  environmentClass: 'C',
  environmentClassLabel: 'Offline harness with real SQLite Recall',
  environmentNotes: [
    'LexiconRuntimeV2.loadFromBundleDir(node_runtime/lexicon/v3)',
    'Electron ABI (ELECTRON_RUN_AS_NODE=1) — project standard for FW/lexicon gates',
    'NOT Electron GUI npm start production app',
    'NOT mock / stub recall',
    'Phase1 harness → recallTopKForWindows → SQLite → buildLexicalEdges → Phase2',
  ],
  harnessOnly: true,
  productionCutover: false,
  dualChain: false,
  mockRecall: false,
  completed,
  failed,
  caseCount: cases.length,
  incompleteRecallCases: incompleteRecall,
  recallableWindowCount: { sum: sumRecallable, avg: completed ? sumRecallable / completed : 0 },
  candidates: { sum: sumCandidates, avg: completed ? sumCandidates / completed : 0 },
  lexicalEdgeCount: { sum: sumLexicalEdges, avg: completed ? sumLexicalEdges / completed : 0 },
  utterancesNeedingFallback,
  fallbackInjectionCount: { sum: sumFallbackInj, avg: completed ? sumFallbackInj / completed : 0 },
  zeroLexicalOnlyCompletePaths: zeroLexicalOnly,
  retainedPathCount: { sum: sumRetained, avg: completed ? sumRetained / completed : 0 },
  multiPathUtterances: multiPath,
  fallbackDependencyBuckets: fallbackBucket,
  physicalSqlStatementCount: { sum: sumPhysicalSql, avg: completed ? sumPhysicalSql / completed : 0 },
  latencyMs: {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    totalMs: performance.now() - tAll,
  },
  memory: {
    heapStartBytes: heapStart,
    heapEndBytes: heapEnd,
    heapDeltaBytes: heapEnd - heapStart,
  },
  uniqueBoundaryKeyViolations,
  unstablePathIdViolations,
  candidateReferenceCopyViolations,
  capTriggeredCases: capCases.length,
  highPathCountCases: highPathCases.length,
  reasonDistribution,
  typicalByReason,
  lexicon: {
    sqlitePath,
    sqliteBytes,
    bundleVersion: manifest.bundleVersion,
    term: manifest.tables?.term,
    term_domain_tags: manifest.tables?.term_domain_tags,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'node_startup_evidence.log'), startupLog.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'dialog_200_phase2_node_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'dialog_200_phase2_node_results.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(
  path.join(outDir, 'fallback_cases.jsonl'),
  fallbackCaseRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(
  path.join(outDir, 'zero_lexical_path_cases.jsonl'),
  zeroLexicalPathCases.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(
  path.join(outDir, 'high_path_cases.jsonl'),
  highPathCases.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(
  path.join(outDir, 'cap_cases.jsonl'),
  capCases.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

console.log(JSON.stringify(summary, null, 2));
