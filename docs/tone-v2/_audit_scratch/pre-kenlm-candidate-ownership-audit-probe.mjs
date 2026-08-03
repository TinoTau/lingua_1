/**
 * Pre-KenLM Candidate Ownership Audit Probe (read-only).
 * Dumps lifecycle counts + per-span before/after filter/select for targeted cases.
 *
 * Run from electron_node/electron-node with ELECTRON_RUN_AS_NODE=1.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'pre_kenlm_candidate_ownership_audit');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[ownership] ${m}`);
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
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);
const { buildLexicalEdges } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-edges.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const {
  buildFineSpanCandidatePool,
  filterDomainCandidatesPerSpan,
  selectPerSpanCandidates,
  assembleDomainAwareSpanSets,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { voteUtteranceDomainFromPool } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
);
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const { windowCandidateToDomainAwarePick } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/window-candidate-to-pick.js')
);
const { getPerSpanCandidateLimit } = require(
  path.join(dist, 'fw-detector/per-span-candidate-limit.js')
);
const { buildWordTimeSpans } = require(path.join(dist, 'fw-detector/tone-time-align.js'));
const { isFuzzyPinyinRecallEnabled } = require(
  path.join(dist, 'lexicon-v2/lexicon-fw-recall-config.js')
);

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
const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
const toneTimestampOnlyEnabled = fwConfig.toneTimestampOnlyEnabled === true;

fs.mkdirSync(outDir, { recursive: true });

function summarizeCand(c) {
  return {
    replacement: c.replacement,
    source: c.source,
    hitKind: c.hitKind,
    domains: c.domains ? [...c.domains] : [],
    isCovered: !!c.isCovered,
    coveredBy: c.coveredBy || null,
    score: c.score,
    candidateId: c.candidateId,
    windowId: c.windowId,
    termId: c.termId ?? null,
    recallSource: c.recallSource,
  };
}

function summarizePick(p) {
  return {
    word: p.word,
    graphSource: p.graphSource,
    domains: p.domains ? [...p.domains] : [],
    score: p.score,
    candidateId: p.candidateId,
    recallSource: p.recallSource,
  };
}

function dropReasonsForSpan(spanPool, rawText, bucketDomain, vote) {
  const isBaseOnly =
    bucketDomain == null || vote.insufficientEvidence || vote.retainedDomains.length === 0;
  const reasons = [];
  for (const candidate of spanPool.candidates) {
    if (candidate.isCovered) {
      reasons.push({
        replacement: candidate.replacement,
        reason: 'isCovered',
        coveredBy: candidate.coveredBy || null,
      });
      continue;
    }
    const pick = windowCandidateToDomainAwarePick(candidate, rawText);
    if (!pick) {
      reasons.push({
        replacement: candidate.replacement,
        reason: 'windowCandidateToDomainAwarePick_null',
        source: candidate.source,
        hitKind: candidate.hitKind,
      });
      continue;
    }
    const same =
      !isBaseOnly &&
      bucketDomain &&
      (pick.graphSource === 'domain_term' || pick.graphSource === 'passive_domain_weak') &&
      Boolean(pick.domains?.includes(bucketDomain));
    const base = pick.graphSource === 'base_term';
    if (same || base || isBaseOnly) {
      reasons.push({
        replacement: pick.word,
        reason: same ? 'KEEP_sameDomain' : base ? 'KEEP_base' : 'KEEP_fallback_baseOnly',
        domains: pick.domains ? [...pick.domains] : [],
        graphSource: pick.graphSource,
      });
    } else {
      reasons.push({
        replacement: pick.word,
        reason: 'DROP_cross_domain_for_bucket',
        bucketDomain,
        domains: pick.domains ? [...pick.domains] : [],
        graphSource: pick.graphSource,
      });
    }
  }
  return reasons;
}

function auditCase(caseId, rawText) {
  log(`case ${caseId}: ${rawText}`);
  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  const wordTimeSpans = buildWordTimeSpans(rawText, [], [], [], []);
  const windows = buildLexicalWindowQueries({
    rawText,
    globalSyllables: coordinate.syllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  const filtered = latticeHardBlockFilter({ windows, rawText, coarseSpans, wordTimeSpans });
  const recallable = filtered.filter((w) => !w.blocked);
  const recall = recallTopKForWindows({
    rawText,
    windows: recallable,
    globalSyllables: [...coordinate.syllables],
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    wordTimeSpans,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled,
  });

  const byWindow = new Map();
  for (const c of recall.candidates) {
    const list = byWindow.get(c.windowId) || [];
    list.push(c);
    byWindow.set(c.windowId, list);
  }
  const recallByWindow = [...byWindow.entries()].map(([windowId, cands]) => ({
    windowId,
    count: cands.length,
    surfaces: [...new Set(cands.map((c) => c.replacement))],
    cands: cands.map(summarizeCand),
  }));

  const edgeBundles = recallable
    .map((w) => ({
      windowId: w.windowId,
      syllableStart: w.syllableStart,
      syllableEnd: w.syllableEnd,
      candidates: byWindow.get(w.windowId) || [],
    }))
    .filter((b) => b.candidates.length > 0);
  const lexicalEdges = buildLexicalEdges({ recalledWindows: edgeBundles });
  const edgeSummary = lexicalEdges.map((e) => ({
    edgeId: e.edgeId,
    kind: e.edgeKind,
    count: e.candidates.length,
    surfaces: [...new Set(e.candidates.map((c) => c.replacement))],
    cands: e.candidates.map(summarizeCand),
  }));

  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
  });

  const pathTraces = [];
  for (const pr of orch.pathAssemblyResults || []) {
    const pathFineSpans = pr.pathFineSpans || [];
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates);
    const compatibility = resolveCompatibilityRelations(pathCandidates);
    const active = compatibility.activeCandidates;
    const uncovered = active.filter((c) => !c.isCovered);
    const pool = buildFineSpanCandidatePool(active, coarseSpans, pathFineSpans);
    const vote = voteUtteranceDomainFromPool(pool);
    const bucketDomains =
      vote.insufficientEvidence || vote.retainedDomains.length === 0
        ? [null]
        : [...vote.retainedDomains];
    const perSpanLimit = getPerSpanCandidateLimit(pathFineSpans.length);

    const fineSpanDump = pathFineSpans.map((s) => ({
      spanId: s.spanId,
      raw: [s.rawStart, s.rawEnd],
      syl: [s.syllableStart, s.syllableEnd],
      text: rawText.slice(s.rawStart, s.rawEnd),
      windowSource: s.windowSource,
      candidateCount: s.candidates.length,
      surfaces: [...new Set(s.candidates.map((c) => c.replacement))],
      cands: s.candidates.map(summarizeCand),
    }));

    const poolDump = pool.map((p) => ({
      fineSpanId: p.fineSpanId,
      text: rawText.slice(p.rawRange[0], p.rawRange[1]),
      candidateCount: p.candidates.length,
      uncoveredCount: p.candidates.filter((c) => !c.isCovered).length,
      surfaces: [...new Set(p.candidates.map((c) => c.replacement))],
      cands: p.candidates.map(summarizeCand),
    }));

    const buckets = [];
    for (const bucketDomain of bucketDomains) {
      const filteredSets = filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain);
      const selected = selectPerSpanCandidates(
        filteredSets,
        pathFineSpans.length,
        coarseSpans,
        pathFineSpans,
        rawText,
        []
      );
      const spanSets = assembleDomainAwareSpanSets(selected);
      const grid = spanSets.map((slot) => [...new Set(slot.map((p) => p.word))]);
      let theo = 1;
      for (const g of grid) theo *= Math.max(1, g.length);

      buckets.push({
        bucketDomain,
        perSpanLimit,
        spans: selected.map((set, i) => {
          const poolSpan = pool[i];
          const beforeSurfaces = [
            ...new Set((poolSpan?.candidates || []).filter((c) => !c.isCovered).map((c) => c.replacement)),
          ];
          const afterFilter = [
            ...set.sameDomainCandidates.map((p) => p.word),
            ...set.baseCandidates.map((p) => p.word),
            ...set.fallbackCandidates.map((p) => p.word),
          ];
          const afterSelect = set.selectedCandidates.map((p) => p.word);
          const canonicalFill =
            afterFilter.length === 0 &&
            afterSelect.length === 1 &&
            String(set.selectedCandidates[0]?.candidateId || '').startsWith('canonical:');
          return {
            fineSpanId: set.fineSpanId,
            text: rawText.slice(set.rawRange[0], set.rawRange[1]),
            beforeUncoveredSurfaces: beforeSurfaces,
            sameDomain: set.sameDomainCandidates.map(summarizePick),
            base: set.baseCandidates.map(summarizePick),
            fallback: set.fallbackCandidates.map(summarizePick),
            afterFilterSurfaces: [...new Set(afterFilter)],
            afterSelectSurfaces: [...new Set(afterSelect)],
            selected: set.selectedCandidates.map(summarizePick),
            canonicalFill,
            dropTrace: dropReasonsForSpan(poolSpan, rawText, bucketDomain, vote),
            counts: {
              pool: poolSpan?.candidates.length ?? 0,
              uncovered: beforeSurfaces.length,
              sameDomain: set.sameDomainCandidates.length,
              base: set.baseCandidates.length,
              fallback: set.fallbackCandidates.length,
              afterFilter: afterFilter.length,
              afterSelect: afterSelect.length,
              deletedByFilter: Math.max(0, beforeSurfaces.length - new Set(afterFilter).size),
              deletedBySelect: Math.max(0, afterFilter.length - afterSelect.length),
            },
          };
        }),
        assemblyGrid: grid,
        theoreticalCombinationCount: theo,
        assemblyWouldHaveMultiSpace: theo > 1,
      });
    }

    pathTraces.push({
      pathId: pr.pathId,
      fineSpanCount: pathFineSpans.length,
      pathCandidateCount: pathCandidates.length,
      activeCount: active.length,
      uncoveredCount: uncovered.length,
      coveredCount: active.length - uncovered.length,
      vote: {
        retainedDomains: [...vote.retainedDomains],
        domainScores: { ...vote.domainScores },
        insufficientEvidence: vote.insufficientEvidence,
        utteranceDomain: vote.utteranceDomain,
      },
      perSpanLimit,
      fineSpanDump,
      poolDump,
      buckets,
      orchBucketSpanSets: (pr.assemblyResult?.bucketSpanSets || []).map((grid) =>
        grid.map((slot) => [...new Set(slot.map((p) => p.word))])
      ),
      perBucketGeneratedCounts: (pr.perBucketGenerated || []).map((list) => list.length),
      perBucketGeneratedTexts: (pr.perBucketGenerated || []).map((list) =>
        list.map((c) => c.text)
      ),
    });
  }

  const prefilled = orch.kenlmSentenceCandidates?.combinations || [];
  const lifecycle = {
    recallCandidates: recall.candidates.length,
    recallDistinctSurfaces: [...new Set(recall.candidates.map((c) => c.replacement))].length,
    lexicalEdgeCount: lexicalEdges.length,
    lexicalEdgeCandidateSum: lexicalEdges.reduce((s, e) => s + e.candidates.length, 0),
    pathCount: (orch.pathAssemblyResults || []).length,
    prefilledCount: prefilled.length,
    prefilledTexts: prefilled.map((c) => c.text),
  };

  return {
    caseId,
    rawText,
    lifecycle,
    recallByWindow: recallByWindow.filter((w) => w.surfaces.length >= 2 || w.count >= 2),
    edgeSummary: edgeSummary.filter((e) => e.surfaces.length >= 1),
    pathTraces,
    architectureNote: {
      ownerHypothesis:
        'selectPerSpanCandidates owns per-span cap; filterDomainCandidatesPerSpan owns cross-domain drop; canonical fill owns empty→ASR; Assembly only combines selectedCandidates grid',
      getPerSpanCandidateLimit: {
        'span<=1': 8,
        span2: 6,
        'span>=3': 4,
      },
    },
  };
}

const cases = [
  ['B01', '请确认地址和医院'],
  ['C01', '请确认地址、医院和医师'],
  ['A01', fs.existsSync(path.join(__dirname, 'pre_kenlm_candidate_pool_acceptance/cases/A01.json'))
    ? JSON.parse(
        fs.readFileSync(
          path.join(__dirname, 'pre_kenlm_candidate_pool_acceptance/cases/A01.json'),
          'utf8'
        )
      ).rawText
    : '低脂拿铁'],
];

// Fix A01 rawText load
try {
  const a01 = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'pre_kenlm_candidate_pool_acceptance/cases/A01.json'),
      'utf8'
    )
  );
  cases[2] = ['A01', a01.rawText];
} catch {
  cases[2] = ['A01', '我想要低脂拿铁'];
}

const results = [];
for (const [id, text] of cases) {
  try {
    results.push(auditCase(id, text));
  } catch (e) {
    results.push({ caseId: id, rawText: text, error: String(e?.stack || e) });
    log(`ERROR ${id}: ${e}`);
  }
}

const outPath = path.join(outDir, 'ownership_trace.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
log(`wrote ${outPath}`);

// compact console summary
for (const r of results) {
  if (r.error) {
    console.log(`\n=== ${r.caseId} ERROR ===\n${r.error}`);
    continue;
  }
  console.log(`\n=== ${r.caseId} ${r.rawText} ===`);
  console.log('lifecycle', r.lifecycle);
  for (const pt of r.pathTraces) {
    console.log('vote', pt.vote);
    console.log('perSpanLimit', pt.perSpanLimit);
    for (const b of pt.buckets) {
      console.log(`bucket=${b.bucketDomain} theo=${b.theoreticalCombinationCount} grid=`, b.assemblyGrid);
      for (const s of b.spans) {
        if (
          s.beforeUncoveredSurfaces.length > 1 ||
          s.canonicalFill ||
          s.afterFilterSurfaces.length !== s.beforeUncoveredSurfaces.length ||
          s.afterSelectSurfaces.length !== s.afterFilterSurfaces.length
        ) {
          console.log('  span', s.text, {
            before: s.beforeUncoveredSurfaces,
            afterFilter: s.afterFilterSurfaces,
            afterSelect: s.afterSelectSurfaces,
            canonicalFill: s.canonicalFill,
            drops: s.dropTrace.filter((d) => String(d.reason).startsWith('DROP') || d.reason === 'isCovered' || d.reason === 'windowCandidateToDomainAwarePick_null'),
          });
        }
      }
    }
  }
}
