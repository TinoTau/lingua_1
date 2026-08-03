/**
 * Lattice Phase 2 offline probe on dialog_200 GT texts.
 * Path Enumeration harness-only — no production cutover / no LTR dual chain.
 *
 * Run (Electron ABI):
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe docs/tone-v2/_audit_scratch/phase2-path-dialog200-probe.mjs
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
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);
const { runPhase2PathHarnessFromLexicalEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase2-path-harness.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
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
const domainIds = recallScope.domainIds;

const cases = (manifest.cases || []).filter((c) => typeof c.text === 'string' && c.text.length > 0);
const latencies = [];
const rows = [];
let completed = 0;
let failed = 0;

const utterancesWithNoLexicalCompletePath = [];
const utterancesWithFallback = [];
const capTriggeredCases = [];
const perPositionCapTriggeredCases = [];
const completeCapTriggeredCases = [];
const zeroCompletePathCases = [];
const highPathCountCases = [];
const uniqueBoundaryKeyViolations = [];
const unstablePathIdViolations = [];
const candidateReferenceCopyViolations = [];

const completeBeforeDist = {};
const retainedDist = {};

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
    const coordinate = buildUtteranceSyllableCoordinate(c.text);
    const phase2 = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: caseId,
      rawText: c.text,
      coordinate,
      syllableCount: phase1.syllableCount,
      lexicalEdges: phase1.edges,
    });
    const ms = performance.now() - t0;
    latencies.push(ms);

    // Deterministic replay
    const phase2b = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: caseId,
      rawText: c.text,
      coordinate,
      syllableCount: phase1.syllableCount,
      lexicalEdges: phase1.edges,
    });
    if (JSON.stringify(phase2.boundaryKeys) !== JSON.stringify(phase2b.boundaryKeys)) {
      unstablePathIdViolations.push({ caseId, kind: 'boundaryKeys_mismatch' });
    }
    if (JSON.stringify(phase2.paths.map((p) => p.pathId)) !== JSON.stringify(phase2b.paths.map((p) => p.pathId))) {
      unstablePathIdViolations.push({ caseId, kind: 'pathId_mismatch' });
    }

    const keySet = new Set(phase2.boundaryKeys);
    if (keySet.size !== phase2.boundaryKeys.length) {
      uniqueBoundaryKeyViolations.push({ caseId, boundaryKeys: phase2.boundaryKeys });
    }

    for (let i = 0; i < phase2.paths.length; i += 1) {
      const path = phase2.paths[i];
      const view = phase2.pathFineSpanViews[i];
      for (let j = 0; j < path.edgeRefs.length; j += 1) {
        if (view.formalFineSpans[j].candidates !== path.edgeRefs[j].candidates) {
          candidateReferenceCopyViolations.push({
            caseId,
            pathId: path.pathId,
            edgeIndex: j,
          });
        }
      }
    }

    if (phase2.fallbackInjectionCount > 0) {
      utterancesWithFallback.push({
        caseId,
        fallbackInjectionCount: phase2.fallbackInjectionCount,
        fallbackInjectionRanges: phase2.fallbackInjectionRanges,
      });
    }
    // Approximate "no lexical complete path": fallback was required.
    if (phase2.fallbackInjectionCount > 0) {
      utterancesWithNoLexicalCompletePath.push(caseId);
    }
    if (phase2.retainedCompletePathCount === 0) {
      zeroCompletePathCases.push(caseId);
    }

    const perPos = phase2.capEvents.filter((e) => e.pruneStage === 'per_position_cap');
    const completeCap = phase2.capEvents.filter((e) => e.pruneStage === 'complete_path_cap');
    if (phase2.capEvents.length > 0) {
      capTriggeredCases.push({
        caseId,
        capEvents: phase2.capEvents,
        completePathCountBeforePrune: phase2.completePathCountBeforePrune,
        retainedCompletePathCount: phase2.retainedCompletePathCount,
      });
    }
    if (perPos.length) {
      perPositionCapTriggeredCases.push({ caseId, events: perPos });
    }
    if (completeCap.length) {
      completeCapTriggeredCases.push({ caseId, events: completeCap });
    }
    if (phase2.completePathCountBeforePrune > 16) {
      highPathCountCases.push({
        caseId,
        completePathCountBeforePrune: phase2.completePathCountBeforePrune,
        retainedCompletePathCount: phase2.retainedCompletePathCount,
        syllableCount: phase2.syllableCount,
        lexicalEdgeCount: phase2.lexicalEdgeCount,
      });
    }

    completeBeforeDist[phase2.completePathCountBeforePrune] =
      (completeBeforeDist[phase2.completePathCountBeforePrune] || 0) + 1;
    retainedDist[phase2.retainedCompletePathCount] =
      (retainedDist[phase2.retainedCompletePathCount] || 0) + 1;

    rows.push({
      caseId,
      syllableCount: phase2.syllableCount,
      lexicalEdgeCount: phase2.lexicalEdgeCount,
      fallbackEdgeCount: phase2.fallbackEdgeCount,
      fallbackInjectionCount: phase2.fallbackInjectionCount,
      fallbackInjectionRanges: phase2.fallbackInjectionRanges,
      completePathCountBeforePrune: phase2.completePathCountBeforePrune,
      retainedCompletePathCount: phase2.retainedCompletePathCount,
      prunedPathCount: phase2.prunedPathCount,
      boundaryKeys: phase2.boundaryKeys,
      prunedBoundaryKeys: phase2.prunedBoundaryKeys,
      pruneReasons: phase2.pruneReasons,
      singleCharWindowCount: phase1.diagnostics?.singleCharWindowCount ?? 0,
      singleCharRecallCount: phase1.diagnostics?.singleCharRecallCount ?? 0,
      singleCharHitCount: phase1.diagnostics?.singleCharHitCount ?? 0,
      singleCharCandidateCount: phase1.diagnostics?.singleCharCandidateCount ?? 0,
      singleCharCandidateCapHitCount: phase1.diagnostics?.singleCharCandidateCapHitCount ?? 0,
      singleCharLexicalEdgeCount:
        phase2.diagnostics?.singleCharLexicalEdgeCount ??
        phase1.diagnostics?.singleCharLexicalEdgeCount ??
        0,
      singleCharLexicalEdgeUsedCount: phase2.diagnostics?.singleCharLexicalEdgeUsedCount ?? 0,
      singleCharFallbackEdgeCount: phase2.diagnostics?.singleCharFallbackEdgeCount ?? 0,
      latencyMs: Math.round(ms * 100) / 100,
    });
    completed += 1;
  } catch (err) {
    failed += 1;
    rows.push({
      caseId,
      error: err && err.message ? err.message : String(err),
    });
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

latencies.sort((a, b) => a - b);
const heapEnd = process.memoryUsage().heapUsed;

const summary = {
  harnessOnly: true,
  productionCutover: false,
  dualChain: false,
  note: 'Phase 2 Path Enumeration harness on dialog_200 GT text — LTR production untouched',
  completed,
  failed,
  caseCount: cases.length,
  utterancesWithNoLexicalCompletePathCount: utterancesWithNoLexicalCompletePath.length,
  utterancesWithNoLexicalCompletePath,
  utterancesWithFallbackCount: utterancesWithFallback.length,
  utterancesWithFallback,
  fallbackEdgeCount: {
    sum: rows.reduce((n, r) => n + (r.fallbackEdgeCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.fallbackEdgeCount || 0), 0) / completed : 0,
  },
  singleChar: {
    windowCount: rows.reduce((n, r) => n + (r.singleCharWindowCount || 0), 0),
    recallCount: rows.reduce((n, r) => n + (r.singleCharRecallCount || 0), 0),
    hitCount: rows.reduce((n, r) => n + (r.singleCharHitCount || 0), 0),
    candidateCount: rows.reduce((n, r) => n + (r.singleCharCandidateCount || 0), 0),
    candidateCapHitCount: rows.reduce((n, r) => n + (r.singleCharCandidateCapHitCount || 0), 0),
    lexicalEdgeCount: rows.reduce((n, r) => n + (r.singleCharLexicalEdgeCount || 0), 0),
    lexicalEdgeUsedCount: rows.reduce((n, r) => n + (r.singleCharLexicalEdgeUsedCount || 0), 0),
    fallbackEdgeCount: rows.reduce((n, r) => n + (r.singleCharFallbackEdgeCount || 0), 0),
  },
  completePathCountBeforePruneDistribution: completeBeforeDist,
  retainedPathCountDistribution: retainedDist,
  capTriggeredCasesCount: capTriggeredCases.length,
  capTriggeredCases,
  perPositionCapTriggeredCasesCount: perPositionCapTriggeredCases.length,
  perPositionCapTriggeredCases,
  completeCapTriggeredCasesCount: completeCapTriggeredCases.length,
  completeCapTriggeredCases,
  zeroCompletePathCases,
  highPathCountCases,
  uniqueBoundaryKeyViolations,
  unstablePathIdViolations,
  candidateReferenceCopyViolations,
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
};

const outDir = path.resolve(__dirname, 'lattice_v1_phase2');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dialog_200_phase2_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'dialog_200_phase2_results.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

console.log(JSON.stringify(summary, null, 2));
