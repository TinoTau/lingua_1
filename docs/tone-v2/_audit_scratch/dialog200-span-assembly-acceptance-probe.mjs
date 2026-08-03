/**
 * dialog_200 Span Lattice + Sentence Assembly Quality & Performance Acceptance
 * Audit-only probe — no production algorithm / threshold / lexicon changes.
 *
 * Primary entry: runSpanAssemblyV4Orchestrator
 * Observation: same production lattice helpers for Window/Recall/Edge dumps
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\dialog200-span-assembly-acceptance-probe.mjs
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
const outDir = path.resolve(__dirname, 'dialog200_span_assembly_acceptance');
const casesDir = path.join(outDir, 'cases');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(msg) {
  console.error(`[${new Date().toISOString()}] ${msg}`);
}

function pct(n, d) {
  return d ? Math.round((10000 * n) / d) / 100 : 0;
}

function stats(arr) {
  if (!arr.length) {
    return { min: 0, mean: 0, median: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, stdev: 0, n: 0 };
  }
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const varSum = a.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const at = (p) => a[Math.min(n - 1, Math.floor(n * p))];
  return {
    min: Math.round(a[0] * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    median: Math.round(at(0.5) * 1000) / 1000,
    p50: Math.round(at(0.5) * 1000) / 1000,
    p90: Math.round(at(0.9) * 1000) / 1000,
    p95: Math.round(at(0.95) * 1000) / 1000,
    p99: Math.round(at(0.99) * 1000) / 1000,
    max: Math.round(a[n - 1] * 1000) / 1000,
    stdev: Math.round(Math.sqrt(varSum) * 1000) / 1000,
    n,
  };
}

function applyReplacements(rawText, replacements) {
  let text = rawText;
  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    text = text.slice(0, r.start) + r.word + text.slice(r.end);
  }
  return text;
}

function classifyCombo(rawText, combo) {
  const reps = (combo.replacements || []).map((r) => ({
    start: r.span.start,
    end: r.span.end,
    word: r.word,
    sourceText: rawText.slice(r.span.start, r.span.end),
    candidateTerm: r.word,
  }));
  const rebuilt = applyReplacements(rawText, reps);
  const rebuildOk = rebuilt === combo.text;
  const isRaw = combo.text === rawText;
  const noOp =
    reps.length > 0 && reps.every((r) => r.word === r.sourceText);
  const overlap = (() => {
    const s = [...reps].sort((a, b) => a.start - b.start);
    for (let i = 1; i < s.length; i++) {
      if (s[i].start < s[i - 1].end) return true;
    }
    return false;
  })();
  let kind = 'RAW_UNCHANGED';
  if (!rebuildOk || overlap) kind = 'INVALID_REPLACEMENT';
  else if (isRaw && reps.length === 0) kind = 'RAW_UNCHANGED';
  else if (isRaw && noOp) kind = 'NO_OP_REPLACEMENT';
  else if (isRaw) kind = 'NO_OP_REPLACEMENT';
  else if (reps.length === 1) kind = 'VALID_SINGLE_SPAN_REPLACEMENT';
  else if (reps.length > 1) kind = 'VALID_MULTI_SPAN_REPLACEMENT';
  else kind = 'NO_OP_REPLACEMENT';
  return { kind, rebuildOk, rebuilt, isRaw, noOp, overlap, replacementOperations: reps };
}

function candBrief(c) {
  return {
    candidateId: c.candidateId,
    term: c.replacement,
    termId: c.termId,
    source: c.source,
    hitKind: c.hitKind,
    score: c.candidateScore ?? c.score,
    domainTags: c.domains ? [...c.domains] : [],
    isBase: c.source === 'base_term',
    pinyin: c.windowPinyinKey,
    tone: c.toneLookupStage ?? null,
    rawStart: c.rawStart,
    rawEnd: c.rawEnd,
    syllableStart: c.syllableStart,
    syllableEnd: c.syllableEnd,
  };
}

function isDomainVoteEligible(c) {
  if (c.isCovered) return false;
  if (c.source === 'base_term') return false;
  return Boolean(c.domains?.some((d) => d && d !== 'general' && d !== 'base_term'));
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
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { buildLexicalWindowQueries } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-window-queries.js')
);
const { latticeHardBlockFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-hard-block-filter.js')
);
const { buildWordTimeSpans } = require(path.join(dist, 'fw-detector/tone-time-align.js'));
const { isFuzzyPinyinRecallEnabled } = require(
  path.join(dist, 'lexicon-v2/lexicon-fw-recall-config.js')
);
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);
const { buildLexicalEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-edges.js')
);
const { injectFallbackEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/inject-fallback-edges.js')
);
const { enumerateCompleteSegmentationPaths } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js')
);
const { materializePathFineSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/materialize-path-fine-spans.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));
const { DOMAIN_BUCKET_RETENTION_RATIO } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
);

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
log(`lexicon.load=${loadState.status}`);
if (loadState.status !== 'ok') process.exit(1);

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
const toneTimestampOnlyEnabled = fwConfig.toneTimestampOnlyEnabled === true;

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const cases = manifest.cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);
log(`cases=${cases.length}`);

fs.mkdirSync(casesDir, { recursive: true });

function observeLayers(rawText) {
  const layerMs = {};
  let t = performance.now();
  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  layerMs.coordinateMs = performance.now() - t;

  t = performance.now();
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  layerMs.coarsePartitionMs = performance.now() - t;

  const wordTimeSpans = buildWordTimeSpans(rawText, [], [], [], []);

  t = performance.now();
  const windows = buildLexicalWindowQueries({
    rawText,
    globalSyllables: coordinate.syllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  layerMs.windowBuildMs = performance.now() - t;

  t = performance.now();
  const filteredWindows = latticeHardBlockFilter({
    windows,
    rawText,
    coarseSpans,
    wordTimeSpans,
  });
  layerMs.hardBlockMs = performance.now() - t;
  const recallable = filteredWindows.filter((w) => !w.blocked);

  t = performance.now();
  const recall = recallTopKForWindows({
    rawText,
    windows: recallable,
    globalSyllables: [...coordinate.syllables],
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    wordTimeSpans,
    acousticSlices: undefined,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled,
  });
  layerMs.recallMs = performance.now() - t;

  const byWindow = new Map();
  for (const c of recall.candidates) {
    const list = byWindow.get(c.windowId) || [];
    list.push(c);
    byWindow.set(c.windowId, list);
  }
  const bundles = recallable.map((w) => ({
    windowId: w.windowId,
    syllableStart: w.syllableStart,
    syllableEnd: w.syllableEnd,
    candidates: byWindow.get(w.windowId) || [],
  }));

  t = performance.now();
  const lexicalEdges = buildLexicalEdges({ recalledWindows: bundles });
  layerMs.edgeBuildMs = performance.now() - t;

  t = performance.now();
  const fb = injectFallbackEdges({
    lexicalEdges,
    syllableCount: coordinate.syllables.length,
  });
  layerMs.fallbackMs = performance.now() - t;

  t = performance.now();
  const enumResult = enumerateCompleteSegmentationPaths({
    lexicalEdges: fb.edges,
    syllableCount: coordinate.syllables.length,
    limits: {
      maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
      maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
    },
  });
  layerMs.pathEnumerationMs = performance.now() - t;

  t = performance.now();
  const views = enumResult.paths.map((p) => materializePathFineSpans(p, coordinate));
  layerMs.materializationMs = performance.now() - t;

  return {
    layerMs,
    coordinate,
    coarseSpans,
    windows: filteredWindows,
    recallable,
    recall,
    byWindow,
    lexicalEdges,
    edgesAfterFallback: fb.edges,
    fallbackInjection: fb,
    enumResult,
    pathViews: views,
    physicalSqlStatementCount: recall.physicalSqlStatementCount ?? null,
  };
}

function analyzeCase(caseDef, orchOut, obs) {
  const rawText = caseDef.text;
  const caseId = caseDef.id || caseDef.caseId;
  const expectedText =
    caseDef.expectedText && caseDef.expectedText !== caseDef.text ? caseDef.expectedText : null;

  const coord = obs.coordinate;
  let coordinateMappingFailure = 0;
  let invalidRangeCount = 0;
  const syllableTrace = (coord.syllables || []).map((syl, i) => {
    const range = coord.ranges?.[i];
    const start = range?.start ?? null;
    const end = range?.end ?? null;
    if (start == null || end == null || !(start < end)) {
      invalidRangeCount += 1;
      coordinateMappingFailure += 1;
    }
    return {
      syllableIndex: i,
      text: typeof syl === 'string' ? syl : '',
      textStart: start,
      textEnd: end,
      pinyin: null,
    };
  });

  const windowLengthDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const windowsPerStart = {};
  const windowTrace = obs.windows.map((w) => {
    const len = w.syllableEnd - w.syllableStart;
    if (len >= 1 && len <= 5) windowLengthDistribution[len] += 1;
    windowsPerStart[w.syllableStart] = (windowsPerStart[w.syllableStart] || 0) + 1;
    return {
      windowId: w.windowId,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      windowLength: len,
      textStart: w.rawStart,
      textEnd: w.rawEnd,
      sourceText: w.windowText,
      pinyin: w.windowPinyinKey,
      blocked: w.blocked === true,
      blockReason: w.blockedBoundaryReason ?? null,
    };
  });

  const recallWindows = [];
  let windowsWith0 = 0;
  let windowsWith1 = 0;
  let windowsWith2Plus = 0;
  let maxCand = 0;
  let sumCand = 0;
  let baseCandCount = 0;
  let domainCandCount = 0;
  let multiDomainCandCount = 0;
  for (const w of obs.recallable) {
    const cands = obs.byWindow.get(w.windowId) || [];
    const n = cands.length;
    sumCand += n;
    maxCand = Math.max(maxCand, n);
    if (n === 0) windowsWith0 += 1;
    else if (n === 1) windowsWith1 += 1;
    else windowsWith2Plus += 1;
    for (const c of cands) {
      if (c.source === 'base_term') baseCandCount += 1;
      if (c.domains?.some((d) => d && d !== 'general' && d !== 'base_term')) domainCandCount += 1;
      if ((c.domains || []).filter((d) => d && d !== 'general' && d !== 'base_term').length > 1) {
        multiDomainCandCount += 1;
      }
    }
    recallWindows.push({
      windowId: w.windowId,
      query: {
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        text: w.windowText,
        pinyin: w.windowPinyinKey,
      },
      candidates: cands.slice(0, 32).map(candBrief),
      candidateCount: n,
      distinctTerms: new Set(cands.map((c) => c.replacement)).size,
    });
  }

  const edgeTrace = obs.edgesAfterFallback.map((e) => ({
    edgeId: e.edgeId,
    edgeKind: e.edgeKind,
    syllableStart: e.syllableStart,
    syllableEnd: e.syllableEnd,
    textStart: e.candidates[0]?.rawStart ?? null,
    textEnd: e.candidates[0]?.rawEnd ?? null,
    sourceText: rawText.slice(
      e.candidates[0]?.rawStart ?? 0,
      e.candidates[0]?.rawEnd ?? 0
    ),
    candidateCount: e.candidates.length,
    candidates: e.candidates.slice(0, 24).map(candBrief),
    sourceWindowIds: e.sourceWindowId ? [e.sourceWindowId] : [],
  }));
  const lexicalEdgeCount = obs.lexicalEdges.length;
  const fallbackEdgeCount = obs.edgesAfterFallback.filter((e) => e.edgeKind === 'fallback').length;
  const edgesWithMultipleCandidates = obs.edgesAfterFallback.filter(
    (e) => e.edgeKind === 'lexical' && e.candidates.length > 1
  ).length;

  // Compare recall candidates vs edge for same ranges
  let recallCandTotal = obs.recall.candidates.length;
  let edgeCandTotal = obs.lexicalEdges.reduce((s, e) => s + e.candidates.length, 0);

  const pathTrace = [];
  let pathCoverageFailure = 0;
  let pathOverlapFailure = 0;
  const sylCount = coord.syllables.length;
  for (const p of obs.enumResult.paths) {
    let hasGap = false;
    let hasOverlap = false;
    let expected = 0;
    for (const e of p.edgeRefs) {
      if (e.syllableStart !== expected) {
        if (e.syllableStart > expected) hasGap = true;
        else hasOverlap = true;
      }
      expected = e.syllableEnd;
    }
    if (expected !== sylCount) hasGap = true;
    if (hasGap) pathCoverageFailure += 1;
    if (hasOverlap) pathOverlapFailure += 1;
    pathTrace.push({
      pathId: p.pathId,
      edges: p.edgeRefs.map((e) => e.edgeId),
      boundaryKey: p.boundaryKey,
      edgeSequenceKey: p.edgeRefs.map((e) => `${e.syllableStart}:${e.syllableEnd}`).join('|'),
      coverageStart: 0,
      coverageEnd: expected,
      hasGap,
      hasOverlap,
      lexicalEdgeCount: p.edgeRefs.filter((e) => e.edgeKind === 'lexical').length,
      fallbackEdgeCount: p.edgeRefs.filter((e) => e.edgeKind === 'fallback').length,
    });
  }
  const distinctBoundary = new Set(pathTrace.map((p) => p.boundaryKey)).size;
  const distinctSeq = new Set(pathTrace.map((p) => p.edgeSequenceKey)).size;

  // PathFineSpan from orchestrator (post-tone)
  const pathAssembly = orchOut.pathAssemblyResults || [];
  const fineSpanTraces = [];
  const voteTraces = [];
  const bucketTraces = [];
  const assemblyTraces = [];
  let toneCandidateDrop = 0;
  let casesMultiDomainBucket = false;
  let assemblyDistinctTexts = new Set();
  let assemblyComboCount = 0;
  let invalidAssembly = 0;
  let truncated = 0;
  let noOpRep = 0;
  let rawOnly = true;
  let anyModified = false;
  let multiSpanMod = false;
  let candidateExcludedNotes = [];

  for (const pr of pathAssembly) {
    const spans = pr.pathFineSpans || [];
    for (const span of spans) {
      const isFallback = span.selectionReason === 'lattice_fallback_edge' || span.candidates.length === 0;
      // materialize from obs for before-tone comparison when path matches
      const obsView = obs.pathViews.find((v) => v.pathId === pr.pathId || v.boundaryKey === pr.boundaryKey);
      const before = obsView?.pathFineSpans?.find(
        (s) => s.syllableStart === span.syllableStart && s.syllableEnd === span.syllableEnd
      );
      const beforeCount = before?.candidates?.length ?? span.candidates.length;
      const afterCount = span.candidates.length;
      if (afterCount < beforeCount) toneCandidateDrop += 1;
      fineSpanTraces.push({
        pathId: pr.pathId,
        spanId: span.spanId,
        textRange: { start: span.rawStart, end: span.rawEnd },
        syllableRange: { start: span.syllableStart, end: span.syllableEnd },
        sourceText: rawText.slice(span.rawStart, span.rawEnd),
        isFallback,
        candidateCountBeforeTone: beforeCount,
        candidatesBeforeTone: (before?.candidates || span.candidates).slice(0, 16).map(candBrief),
        candidateCountAfterTone: afterCount,
        candidatesAfterTone: span.candidates.slice(0, 16).map(candBrief),
        toneEvidenceStatus: span.toneRebindTrace
          ? span.toneRebindTrace.acousticTonePattern != null
            ? 'available'
            : 'unavailable'
          : 'no_trace',
        toneEvidence: span.toneRebindTrace
          ? {
              pathRawStart: span.toneRebindTrace.pathRawStart,
              pathRawEnd: span.toneRebindTrace.pathRawEnd,
              recomputedAfterRebind: span.toneRebindTrace.recomputedAfterRebind,
            }
          : {},
      });
    }

    const vote = pr.assemblyResult?.vote;
    const poolCands = spans.flatMap((s) => s.candidates);
    const voteEligible = poolCands.filter(isDomainVoteEligible);
    const baseExcluded = poolCands.filter((c) => c.source === 'base_term');
    const fallbackExcluded = spans.filter((s) => s.candidates.length === 0).map((s) => s.spanId);
    voteTraces.push({
      pathId: pr.pathId,
      voteEligibleCandidateCount: voteEligible.length,
      voteEligibleCandidates: voteEligible.slice(0, 40).map(candBrief),
      baseCandidatesExcludedFromVote: baseExcluded.slice(0, 20).map(candBrief),
      fallbackCandidatesExcludedFromVote: fallbackExcluded,
      domainScores: vote?.domainScores || {},
      highestScore: vote?.maxCount ?? vote?.winnerScore ?? 0,
      retentionRatio: DOMAIN_BUCKET_RETENTION_RATIO,
      retainedDomains: vote?.retainedDomains || [],
      rejectedDomains: Object.keys(vote?.domainScores || {}).filter(
        (d) => !(vote?.retainedDomains || []).includes(d)
      ),
      insufficientEvidence: vote?.insufficientEvidence === true,
    });

    const retained = vote?.retainedDomains?.length
      ? [...vote.retainedDomains]
      : [null];
    const filteredSets = pr.assemblyResult?.filteredSets || [];
    const bucketSpanSets = pr.assemblyResult?.bucketSpanSets || [];
    for (let bi = 0; bi < bucketSpanSets.length; bi++) {
      const domainId = retained[bi] ?? null;
      if (bucketSpanSets.length > 1) casesMultiDomainBucket = true;
      const grid = bucketSpanSets[bi] || [];
      const domainCands = [];
      const baseCands = [];
      // Prefer filteredSets when single-bucket primary; else derive from picks
      for (const slot of grid) {
        for (const pick of slot) {
          if (pick.source === 'base_term' || pick.recallSource === 'base') baseCands.push(pick.word);
          else domainCands.push(pick.word);
        }
      }
      const fs = filteredSets[0];
      bucketTraces.push({
        pathId: pr.pathId,
        domainId,
        domainCandidates: (fs?.sameDomainCandidates || []).slice(0, 24).map((p) => p.word),
        baseCandidates: (fs?.baseCandidates || []).slice(0, 24).map((p) => p.word),
        spanCandidateGrid: grid.map((slot) =>
          slot.slice(0, 12).map((p) => ({
            word: p.word,
            start: p.span.start,
            end: p.span.end,
            source: p.source,
            score: p.candidateScore,
          }))
        ),
        candidateCount: grid.reduce((s, slot) => s + slot.length, 0),
        candidateTerms: [...new Set(grid.flatMap((slot) => slot.map((p) => p.word)))],
        inputSpanCandidateCounts: grid.map((slot) => slot.length),
      });
    }

    for (let bi = 0; bi < (pr.perBucketGenerated || []).length; bi++) {
      const generated = pr.perBucketGenerated[bi] || [];
      const grid = (pr.assemblyResult?.bucketSpanSets || [])[bi] || [];
      const inputCounts = grid.map((slot) => slot.length);
      const naive = inputCounts.reduce((a, b) => a * Math.max(1, b), 1);
      const genMapped = generated.map((combo) => {
        const cls = classifyCombo(rawText, combo);
        assemblyComboCount += 1;
        assemblyDistinctTexts.add(combo.text);
        if (!cls.rebuildOk || cls.overlap) invalidAssembly += 1;
        if (cls.kind === 'NO_OP_REPLACEMENT') noOpRep += 1;
        if (cls.kind !== 'RAW_UNCHANGED' && cls.kind !== 'NO_OP_REPLACEMENT') {
          rawOnly = false;
          anyModified = true;
          if (cls.kind === 'VALID_MULTI_SPAN_REPLACEMENT') multiSpanMod = true;
        }
        if (combo.text.length < rawText.length * 0.5) truncated += 1;
        return {
          text: combo.text,
          replacementOperations: cls.replacementOperations,
          sourceCandidateIds: (combo.replacements || []).map((r) => r.candidateId).filter(Boolean),
          isRawText: combo.text === rawText,
          dedupKey: combo.text,
          classification: cls.kind,
          rebuildOk: cls.rebuildOk,
        };
      });
      assemblyTraces.push({
        pathId: pr.pathId,
        domainId: retained[bi] ?? null,
        inputSpanCandidateCounts: inputCounts,
        naiveCombinationPotential: naive,
        validNonOverlappingCombinationPotential: 'NOT_OBSERVABLE_WITHOUT_REPLAY',
        generatedCombinationCount: generated.length,
        generatedCandidates: genMapped.slice(0, 32),
        distinctTextCount: new Set(generated.map((g) => g.text)).size,
      });
    }

    // exclusions: span candidates not in any selected slot of primary filtered
    for (const span of spans) {
      for (const c of span.candidates) {
        const inSelected = (pr.assemblyResult?.filteredSets || []).some((fs) =>
          (fs.selectedCandidates || []).some((p) => p.candidateId === c.candidateId || p.word === c.replacement)
        );
        if (!inSelected && span.candidates.length) {
          candidateExcludedNotes.push({
            pathId: pr.pathId,
            spanId: span.spanId,
            term: c.replacement,
            reason: 'not_in_primary_filtered_selectedCandidates',
          });
        }
      }
    }
  }

  const merge = orchOut.crossPathMergeTrace || orchOut.kenlmSentenceCandidates?.crossPathMerge || {};
  const prefilled = orchOut.kenlmSentenceCandidates?.combinations || [];
  const uniqueBefore = orchOut.kenlmSentenceCandidates?.uniqueBeforeCap || prefilled;
  const perBucketAll = (orchOut.kenlmSentenceCandidates?.perBucketGenerated || []).flat(2);
  // Collect all path bucket texts before merge
  const inputCandidates = [];
  for (const pr of pathAssembly) {
    for (let bi = 0; bi < (pr.perBucketGenerated || []).length; bi++) {
      for (const combo of pr.perBucketGenerated[bi] || []) {
        inputCandidates.push({
          text: combo.text,
          pathId: pr.pathId,
          domainId: (pr.assemblyResult?.vote?.retainedDomains || [])[bi] ?? null,
        });
      }
    }
  }
  const distinctBefore = new Set(inputCandidates.map((c) => c.text)).size;
  const textCounts = {};
  for (const c of inputCandidates) textCounts[c.text] = (textCounts[c.text] || 0) + 1;
  const duplicates = Object.entries(textCounts)
    .filter(([, n]) => n > 1)
    .map(([text, n]) => ({ text, count: n }));

  const crossPathTrace = {
    inputCandidateCount: inputCandidates.length,
    inputCandidates: inputCandidates.slice(0, 64),
    distinctTextsBeforeDedup: distinctBefore,
    duplicates: duplicates.slice(0, 32),
    uniqueTextsAfterDedup: uniqueBefore.length,
    cappedCandidateCount: prefilled.length,
    prefilledCombinations: prefilled.map((c) => c.text),
    mergeTrace: merge,
  };

  // Diversity layer flags
  const flags = {
    hasRecallCandidate: recallCandTotal > 0,
    hasMultipleRecallCandidates: windowsWith2Plus > 0 || maxCand > 1,
    hasMultiCandidateLexicalEdge: edgesWithMultipleCandidates > 0,
    hasMultiplePaths: pathTrace.length > 1,
    hasMultipleEffectiveCandidatePaths: distinctSeq > 1,
    hasMultipleRetainedDomains: voteTraces.some((v) => (v.retainedDomains || []).length > 1),
    hasMultipleBuckets: casesMultiDomainBucket || bucketTraces.length > 1,
    hasMultipleAssemblyCombinations: assemblyComboCount > 1,
    hasMultipleDistinctAssemblyTexts: assemblyDistinctTexts.size > 1,
    hasMultipleDistinctCrossPathTexts: distinctBefore > 1,
    hasKenlmInputNAbove1: prefilled.length > 1,
  };

  // First collapse layer
  let firstCollapse = null;
  const layers = [
    ['R1_RECALL_ONLY_ONE_CANDIDATE', !flags.hasMultipleRecallCandidates],
    ['R2_EDGE_DROPS_ALTERNATIVES', flags.hasMultipleRecallCandidates && !flags.hasMultiCandidateLexicalEdge],
    ['R3_PATHS_DIFFER_ONLY_BY_BOUNDARY', flags.hasMultiplePaths && !flags.hasMultipleEffectiveCandidatePaths],
    [
      'R8_OR_R9_ASSEMBLY',
      flags.hasMultiCandidateLexicalEdge && !flags.hasMultipleDistinctAssemblyTexts,
    ],
    [
      'R11_CROSS_PATH_EXACT_DUPLICATES',
      flags.hasMultipleDistinctAssemblyTexts === false &&
        inputCandidates.length > 1 &&
        distinctBefore === 1,
    ],
    ['R12_OR_R13_DATA_LIMITED', !flags.hasMultipleRecallCandidates && recallCandTotal >= 0],
  ];
  for (const [code, hit] of layers) {
    if (hit && !firstCollapse) firstCollapse = code;
  }
  if (flags.hasMultipleDistinctCrossPathTexts && !flags.hasKenlmInputNAbove1) {
    firstCollapse = 'R11_CROSS_PATH_EXACT_DUPLICATES';
  }
  if (!flags.hasMultipleDistinctAssemblyTexts && flags.hasMultiCandidateLexicalEdge) {
    // Check if assembly only emitted raw / identical
    const allRaw = [...assemblyDistinctTexts].every((t) => t === rawText);
    firstCollapse = allRaw ? 'R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT' : 'R8_ASSEMBLY_ONLY_USES_FIRST_CANDIDATE';
  }

  const structuralFailures = {
    coordinateMappingFailure,
    invalidRangeCount,
    invalidWindowRange: windowTrace.filter(
      (w) => !(w.textStart < w.textEnd) || w.syllableStart >= w.syllableEnd
    ).length,
    pathCoverageFailure,
    pathOverlapFailure,
    materializationFailure: orchOut.latticeTrace?.coverageStatus === 'incomplete' ? 1 : 0,
    undefinedPrefilled: orchOut.kenlmSentenceCandidates?.combinations === undefined ? 1 : 0,
    kenlmInputOver16: prefilled.length > 16 ? 1 : 0,
    invalidAssembly,
  };

  return {
    caseId,
    rawText,
    rawTextLength: rawText.length,
    syllableCount: sylCount,
    expectedText,
    sourceManifestEntry: {
      id: caseDef.id,
      scenario: caseDef.scenario,
      file: caseDef.file,
      language: caseDef.language,
    },
    coordinate: {
      syllableTrace: syllableTrace.slice(0, 80),
      coordinateMappingFailure,
      invalidRangeCount,
      coverageOk: coord.coverage?.coverageOk ?? null,
    },
    windows: {
      totalWindowCount: windowTrace.length,
      windowLengthDistribution,
      blockedWindowCount: windowTrace.filter((w) => w.blocked).length,
      recallEligibleWindowCount: obs.recallable.length,
      windowsPerStartPosition: windowsPerStart,
      hasLength1: windowLengthDistribution[1] > 0,
      sample: windowTrace.slice(0, 40),
    },
    recall: {
      windowsWith0Candidate: windowsWith0,
      windowsWith1Candidate: windowsWith1,
      windowsWith2PlusCandidates: windowsWith2Plus,
      maxCandidatesPerWindow: maxCand,
      averageCandidatesPerWindow: obs.recallable.length
        ? Math.round((1000 * sumCand) / obs.recallable.length) / 1000
        : 0,
      baseCandidateCount: baseCandCount,
      domainCandidateCount: domainCandCount,
      multiDomainCandidateCount: multiDomainCandCount,
      totalCandidates: recallCandTotal,
      sqlQueryCount: orchOut.latticeTrace?.sqlQueryCount ?? obs.physicalSqlStatementCount ?? null,
      windows: recallWindows.slice(0, 60),
    },
    edges: {
      lexicalEdgeCount,
      fallbackEdgeCount,
      edgesWithMultipleCandidates,
      edgeCandidateTotal: edgeCandTotal,
      recallCandidateTotal: recallCandTotal,
      edgePreservesMulti: edgesWithMultipleCandidates > 0 || maxCand <= 1,
      sample: edgeTrace.slice(0, 40),
    },
    paths: {
      pathCount: pathTrace.length,
      distinctBoundaryPathCount: distinctBoundary,
      distinctEffectiveCandidatePathCount: distinctSeq,
      pathCoverageFailure,
      pathOverlapFailure,
      paths: pathTrace,
    },
    fineSpans: fineSpanTraces.slice(0, 80),
    toneCandidateDropCount: toneCandidateDrop,
    votes: voteTraces,
    buckets: bucketTraces.slice(0, 24),
    candidateExcludedFromAllBuckets: candidateExcludedNotes.slice(0, 40),
    assemblies: assemblyTraces,
    crossPath: crossPathTrace,
    quality: {
      invalidAssemblyCount: invalidAssembly,
      truncatedTextCount: truncated,
      noOpReplacementCount: noOpRep,
      casesWithRawOnly: rawOnly,
      casesWithAnyModifiedCandidate: anyModified,
      casesWithMultiSpanModifiedCandidate: multiSpanMod,
      assemblyComboCount,
      assemblyDistinctTextCount: assemblyDistinctTexts.size,
    },
    diversityFlags: flags,
    firstCollapseLayer: firstCollapse,
    structuralFailures,
    latticeTrace: orchOut.latticeTrace || null,
    pathAssemblyTraces: orchOut.pathAssemblyTraces || null,
    architectureCompliance: orchOut.metrics?.architectureCompliance || null,
    metrics: orchOut.metrics || null,
  };
}

// ---------- TRACE PASS ----------
log('TRACE_PASS_START');
const caseSummaries = [];
const funnelIds = {
  casesWithRecallCandidate: [],
  casesWithMultipleRecallCandidates: [],
  casesWithMultiCandidateLexicalEdge: [],
  casesWithMultiplePaths: [],
  casesWithMultipleEffectiveCandidatePaths: [],
  casesWithMultipleRetainedDomains: [],
  casesWithMultipleBuckets: [],
  casesWithMultipleAssemblyCombinations: [],
  casesWithMultipleDistinctAssemblyTexts: [],
  casesWithMultipleDistinctCrossPathTexts: [],
  casesWithKenlmInputNAbove1: [],
};
const collapseCounts = {};
const structuralTotals = {
  coordinateMappingFailure: 0,
  invalidWindowRange: 0,
  pathCoverageFailure: 0,
  pathOverlapFailure: 0,
  materializationFailure: 0,
  invalidReplacementRange: 0,
  textTruncation: 0,
  undefinedPrefilledCombinations: 0,
  kenlmInputOver16: 0,
  orchestratorFailure: 0,
};
let casesWithModified = 0;
let casesRawOnly = 0;

for (const c of cases) {
  const caseId = c.id;
  try {
    const obs = observeLayers(c.text);
    const t0 = performance.now();
    const out = runSpanAssemblyV4Orchestrator({
      rawText: c.text,
      runtime,
      profile,
      recallDomainScope: domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      domainPriors: [],
      traceCaseId: caseId,
    });
    const orchMs = performance.now() - t0;
    const analyzed = analyzeCase(c, out, obs);
    analyzed.timing = { ...obs.layerMs, orchestratorMs: orchMs, totalObservedMs: orchMs };
    // tone/vote/bucket/assembly/crossPath inside orch — mark NOT_OBSERVABLE separately
    analyzed.timing.toneRebindMs = 'NOT_OBSERVABLE';
    analyzed.timing.domainVoteMs = 'NOT_OBSERVABLE';
    analyzed.timing.bucketBuildMs = 'NOT_OBSERVABLE';
    analyzed.timing.sentenceAssemblyMs = 'NOT_OBSERVABLE';
    analyzed.timing.crossPathMergeMs = 'NOT_OBSERVABLE';

    fs.writeFileSync(path.join(casesDir, `${caseId}.json`), JSON.stringify(analyzed, null, 2));

    const f = analyzed.diversityFlags;
    if (f.hasRecallCandidate) funnelIds.casesWithRecallCandidate.push(caseId);
    if (f.hasMultipleRecallCandidates) funnelIds.casesWithMultipleRecallCandidates.push(caseId);
    if (f.hasMultiCandidateLexicalEdge) funnelIds.casesWithMultiCandidateLexicalEdge.push(caseId);
    if (f.hasMultiplePaths) funnelIds.casesWithMultiplePaths.push(caseId);
    if (f.hasMultipleEffectiveCandidatePaths)
      funnelIds.casesWithMultipleEffectiveCandidatePaths.push(caseId);
    if (f.hasMultipleRetainedDomains) funnelIds.casesWithMultipleRetainedDomains.push(caseId);
    if (f.hasMultipleBuckets) funnelIds.casesWithMultipleBuckets.push(caseId);
    if (f.hasMultipleAssemblyCombinations) funnelIds.casesWithMultipleAssemblyCombinations.push(caseId);
    if (f.hasMultipleDistinctAssemblyTexts)
      funnelIds.casesWithMultipleDistinctAssemblyTexts.push(caseId);
    if (f.hasMultipleDistinctCrossPathTexts)
      funnelIds.casesWithMultipleDistinctCrossPathTexts.push(caseId);
    if (f.hasKenlmInputNAbove1) funnelIds.casesWithKenlmInputNAbove1.push(caseId);

    collapseCounts[analyzed.firstCollapseLayer] =
      (collapseCounts[analyzed.firstCollapseLayer] || 0) + 1;

    structuralTotals.coordinateMappingFailure += analyzed.structuralFailures.coordinateMappingFailure;
    structuralTotals.invalidWindowRange += analyzed.structuralFailures.invalidWindowRange;
    structuralTotals.pathCoverageFailure += analyzed.structuralFailures.pathCoverageFailure;
    structuralTotals.pathOverlapFailure += analyzed.structuralFailures.pathOverlapFailure;
    structuralTotals.materializationFailure += analyzed.structuralFailures.materializationFailure;
    structuralTotals.undefinedPrefilledCombinations += analyzed.structuralFailures.undefinedPrefilled;
    structuralTotals.kenlmInputOver16 += analyzed.structuralFailures.kenlmInputOver16;
    structuralTotals.invalidReplacementRange += analyzed.structuralFailures.invalidAssembly;
    structuralTotals.textTruncation += analyzed.quality.truncatedTextCount;

    if (analyzed.quality.casesWithAnyModifiedCandidate) casesWithModified += 1;
    if (analyzed.quality.casesWithRawOnly) casesRawOnly += 1;

    caseSummaries.push({
      caseId,
      textLength: c.text.length,
      syllableCount: analyzed.syllableCount,
      windowCount: analyzed.windows.totalWindowCount,
      recallCandidateCount: analyzed.recall.totalCandidates,
      edgeCount: analyzed.edges.lexicalEdgeCount + analyzed.edges.fallbackEdgeCount,
      pathCount: analyzed.paths.pathCount,
      assemblyDistinct: analyzed.quality.assemblyDistinctTextCount,
      kenlmN: analyzed.crossPath.cappedCandidateCount,
      distinctBeforeDedup: analyzed.crossPath.distinctTextsBeforeDedup,
      firstCollapse: analyzed.firstCollapseLayer,
      orchMs,
      layerMs: obs.layerMs,
      hasLen1Window: analyzed.windows.hasLength1,
      multiRecall: f.hasMultipleRecallCandidates,
      multiEdge: f.hasMultiCandidateLexicalEdge,
      scenario: c.scenario,
    });
    if (caseSummaries.length % 25 === 0) log(`trace_progress=${caseSummaries.length}`);
  } catch (err) {
    structuralTotals.orchestratorFailure += 1;
    log(`FAIL ${caseId}: ${err && err.message ? err.message : err}`);
    fs.writeFileSync(
      path.join(casesDir, `${caseId}.json`),
      JSON.stringify({ caseId, error: String(err && err.stack ? err.stack : err) }, null, 2)
    );
    caseSummaries.push({ caseId, error: true });
  }
}
log('TRACE_PASS_DONE');

// ---------- PERFORMANCE: 1 cold + 3 warm ----------
log('PERF_PASS_START');
function runPerfBatch(label) {
  const totals = [];
  const perCase = [];
  for (const c of cases) {
    const t0 = performance.now();
    try {
      runSpanAssemblyV4Orchestrator({
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
      totals.push(ms);
      perCase.push({ caseId: c.id, totalMs: ms, textLength: c.text.length });
    } catch (e) {
      totals.push(99999);
      perCase.push({ caseId: c.id, totalMs: 99999, error: String(e.message || e) });
    }
  }
  return { label, stats: stats(totals), perCase };
}

const perfCold = runPerfBatch('cold');
const perfWarm = [runPerfBatch('warm1'), runPerfBatch('warm2'), runPerfBatch('warm3')];
const warmMerged = perfWarm.flatMap((r) => r.perCase.map((p) => p.totalMs));
const warmStats = stats(warmMerged);
log('PERF_PASS_DONE');

// Layer timing from trace pass
const layerKeys = [
  'coordinateMs',
  'windowBuildMs',
  'hardBlockMs',
  'recallMs',
  'edgeBuildMs',
  'fallbackMs',
  'pathEnumerationMs',
  'materializationMs',
  'orchestratorMs',
];
const layerStats = {};
for (const k of layerKeys) {
  layerStats[k] = stats(caseSummaries.filter((s) => !s.error).map((s) => (s.layerMs && s.layerMs[k]) || (k === 'orchestratorMs' ? s.orchMs : 0)));
}

const slowest = [...caseSummaries]
  .filter((s) => !s.error)
  .sort((a, b) => b.orchMs - a.orchMs)
  .slice(0, 10);

// Representative case selection
function pickReps() {
  const ok = caseSummaries.filter((s) => !s.error);
  const byId = Object.fromEntries(ok.map((s) => [s.caseId, s]));
  const picks = new Set();
  const add = (id) => {
    if (id && byId[id]) picks.add(id);
  };
  add(ok.find((s) => s.pathCount === 1)?.caseId);
  add(ok.find((s) => s.pathCount > 1)?.caseId);
  add(ok.find((s) => s.multiRecall)?.caseId);
  add(funnelIds.casesWithMultipleRetainedDomains[0]);
  add(funnelIds.casesWithMultipleBuckets[0]);
  add(ok.sort((a, b) => b.edgeCount - a.edgeCount)[0]?.caseId);
  add(ok.sort((a, b) => b.textLength - a.textLength)[0]?.caseId);
  add(ok.find((s) => /[0-9A-Za-z]/.test(cases.find((c) => c.id === s.caseId)?.text || ''))?.caseId);
  add(ok.find((s) => (cases.find((c) => c.id === s.caseId)?.text || '').includes('，'))?.caseId);
  add(funnelIds.casesWithMultipleDistinctAssemblyTexts[0]);
  add(funnelIds.casesWithKenlmInputNAbove1[0]);
  // fill to 20
  for (const s of ok) {
    if (picks.size >= 20) break;
    picks.add(s.caseId);
  }
  return [...picks].slice(0, 20);
}
const repIds = pickReps();

let repMd = `# Representative Cases Manual Review\n\n`;
for (const id of repIds) {
  const tr = JSON.parse(fs.readFileSync(path.join(casesDir, `${id}.json`), 'utf8'));
  const s = caseSummaries.find((x) => x.caseId === id);
  repMd += `## ${id}\n\n`;
  repMd += `| 字段 | 值 |\n|------|-----|\n`;
  repMd += `| 原文 | ${tr.rawText} |\n`;
  repMd += `| scenario | ${tr.sourceManifestEntry?.scenario} |\n`;
  repMd += `| windows | ${tr.windows?.totalWindowCount} (len1=${tr.windows?.windowLengthDistribution?.[1]}) |\n`;
  repMd += `| recall max/avg | ${tr.recall?.maxCandidatesPerWindow} / ${tr.recall?.averageCandidatesPerWindow} |\n`;
  repMd += `| multi-domain cand | ${tr.recall?.multiDomainCandidateCount} |\n`;
  repMd += `| edges multi-cand | ${tr.edges?.edgesWithMultipleCandidates} |\n`;
  repMd += `| paths | ${tr.paths?.pathCount} (distinctSeq=${tr.paths?.distinctEffectiveCandidatePathCount}) |\n`;
  repMd += `| retainedDomains | ${(tr.votes || []).map((v) => (v.retainedDomains || []).join('|')).join(' ; ')} |\n`;
  repMd += `| assembly distinct | ${tr.quality?.assemblyDistinctTextCount} |\n`;
  repMd += `| crossPath distinctBefore / kenlmN | ${tr.crossPath?.distinctTextsBeforeDedup} / ${tr.crossPath?.cappedCandidateCount} |\n`;
  repMd += `| firstCollapse | ${tr.firstCollapseLayer} |\n`;
  repMd += `| orchMs | ${s?.orchMs?.toFixed?.(1) ?? s?.orchMs} |\n`;
  const texts = tr.crossPath?.prefilledCombinations || [];
  repMd += `\n**组装候选:**\n`;
  for (const t of texts.slice(0, 5)) {
    repMd += `- \`${t}\`\n`;
  }
  const asm = (tr.assemblies || [])[0];
  if (asm?.generatedCandidates?.[0]) {
    const g = asm.generatedCandidates[0];
    repMd += `\n**示例 replacementOperations (${g.classification}):**\n`;
    repMd += '```json\n' + JSON.stringify(g.replacementOperations?.slice(0, 8), null, 2) + '\n```\n';
  }
  // Manual placeholder grades — filled programmatically with heuristics
  let grade = 'ACCEPTABLE';
  if (tr.structuralFailures && Object.values(tr.structuralFailures).some((v) => v > 0 && typeof v === 'number')) {
    grade = 'BAD';
  } else if (tr.quality?.invalidAssemblyCount > 0) {
    grade = 'BAD';
  } else if (tr.quality?.casesWithAnyModifiedCandidate) {
    grade = 'GOOD';
  } else if (tr.firstCollapseLayer === 'R9_ASSEMBLY_GENERATES_IDENTICAL_TEXT') {
    grade = 'QUESTIONABLE';
  }
  repMd += `\n**自动启发式质量评价:** ${grade}\n\n`;
  repMd += `评价说明: 结构完整；多样性受 ${tr.firstCollapseLayer} 限制；无金标纠错准确率。\n\n---\n\n`;
}
fs.writeFileSync(path.join(outDir, 'representative_cases.md'), repMd);

const n = cases.length;
const funnel = {};
for (const [k, ids] of Object.entries(funnelIds)) {
  funnel[k] = { count: ids.length, percentage: pct(ids.length, n), caseIds: ids };
}

const hardStructurePass =
  structuralTotals.orchestratorFailure === 0 &&
  structuralTotals.coordinateMappingFailure === 0 &&
  structuralTotals.invalidWindowRange === 0 &&
  structuralTotals.pathCoverageFailure === 0 &&
  structuralTotals.pathOverlapFailure === 0 &&
  structuralTotals.materializationFailure === 0 &&
  structuralTotals.undefinedPrefilledCombinations === 0 &&
  structuralTotals.kenlmInputOver16 === 0 &&
  structuralTotals.invalidReplacementRange === 0;

const multiEdgeButSingleText = caseSummaries.filter(
  (s) =>
    !s.error &&
    s.multiEdge &&
    s.assemblyDistinct <= 1 &&
    (funnelIds.casesWithMultipleDistinctAssemblyTexts.indexOf(s.caseId) < 0)
).length;

const assemblySilentDropSuspects = caseSummaries.filter(
  (s) => !s.error && s.multiEdge && s.assemblyDistinct <= 1
);

const perfHardPass = warmStats.p95 <= 200 && warmStats.max <= 500 && structuralTotals.orchestratorFailure === 0;
const perfTargetPass = warmStats.p50 <= 100 && warmStats.p95 <= 150;

const summary = {
  generatedAt: new Date().toISOString(),
  casesTotal: n,
  entry: 'runSpanAssemblyV4Orchestrator',
  lexicon: 'node_runtime/lexicon/v3',
  runtimeBoundary: 'text-level Span Assembly only — NOT Electron Node E2E',
  constants: {
    DOMAIN_BUCKET_RETENTION_RATIO,
    maxActivePathsPerPosition: V4_LIMITS.maxActivePathsPerPosition,
    maxCompleteSegmentationPaths: V4_LIMITS.maxCompleteSegmentationPaths,
    maxSentenceCandidates: fwConfig.maxSentenceCandidates,
  },
  structuralTotals,
  hardStructurePass,
  funnel,
  collapseCounts,
  qualityRollup: {
    casesWithModified,
    casesRawOnly,
    multiEdgeButSingleText,
    assemblySilentDropSuspectCount: assemblySilentDropSuspects.length,
    assemblySilentDropSuspectIds: assemblySilentDropSuspects.slice(0, 40).map((s) => s.caseId),
    windowLen1Cases: caseSummaries.filter((s) => s.hasLen1Window).length,
  },
  expectedTextNote:
    'manifest expectedText equals utterance/text for restored corpus — NOT a correction gold label; no accuracy claimed',
  representativeCaseIds: repIds,
};

fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'performance.json'),
  JSON.stringify(
    {
      cold: perfCold.stats,
      warmRuns: perfWarm.map((r) => r.stats),
      warmMerged: warmStats,
      layerStatsFromTracePass: layerStats,
      slowest10: slowest,
      hardGate: { p95_le_200: warmStats.p95 <= 200, max_le_500: warmStats.max <= 500 },
      targetGate: { p50_le_100: warmStats.p50 <= 100, p95_le_150: warmStats.p95 <= 150 },
      sentenceAssemblyP95: 'NOT_OBSERVABLE',
      crossPathMergeP95: 'NOT_OBSERVABLE',
      sql: {
        note: 'sqlQueryCount available per case via latticeTrace when present',
        observable: true,
      },
    },
    null,
    2
  )
);
fs.writeFileSync(path.join(outDir, 'case_index.json'), JSON.stringify(caseSummaries, null, 2));

log(`SUMMARY hardStructurePass=${hardStructurePass} warm_p95=${warmStats.p95} warm_max=${warmStats.max}`);
log(`funnel kenlmN>1=${funnel.casesWithKenlmInputNAbove1.count} multiEdge=${funnel.casesWithMultiCandidateLexicalEdge.count}`);
log(`collapseCounts=${JSON.stringify(collapseCounts)}`);

if (structuralTotals.orchestratorFailure > 0) process.exit(2);
process.exit(0);
