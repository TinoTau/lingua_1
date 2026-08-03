/**
 * Read-only audit probe: LTR early-commit permanent exact_term drops on dialog_200.
 * Does not modify production code / lexicon / config.
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
const { textToPinyinStream, buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const {
  generateLocalOptionsAtCursor,
  commitBestFormalFineSpan,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js'));
const { blockedFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/blocked-window-filter.js')
);
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);
const { createUtteranceRecallContext } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/utterance-recall-cache.js')
);
const { voteUtteranceDomainFromPool } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
);
const { buildFineSpanCandidatePool } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js')
);
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.join(repoRoot, 'node_runtime/lexicon/v3'));
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
const domainIds = resolveRecallScope({
  configEnabledDomains: fwConfig.enabledDomains,
}).domainIds;

const caseIds = [
  'd001',
  'd007',
  'd015',
  'd022',
  'd031',
  'd041',
  'd049',
  'd055',
  'd061',
  'd067',
  'd073',
  'd079',
  'd085',
  'd091',
  'd097',
  'd103',
  'd109',
  'd115',
  'd132',
  'd150',
  'd168',
  'd186',
];
const byId = Object.fromEntries((manifest.cases || []).map((c) => [c.id, c]));
const selected = caseIds.map((id) => byId[id]).filter(Boolean);

const out = {
  caseCount: 0,
  cases: [],
  totals: {
    steps: 0,
    optionsGenerated: 0,
    optionsRecalled: 0,
    hitsRecalled: 0,
    hitsCommitted: 0,
    hitsPermanentlyDropped: 0,
    exactHitsPermanentlyDropped: 0,
    casesWithPermanentDrop: 0,
    casesWithLongerExactDropped: 0,
    casesWithAnyRecallHit: 0,
  },
};

function candWord(c) {
  return c.replacement || c.word || c.hotword?.word || '';
}

for (const c of selected) {
  const rawText = c.text;
  const { syllables } = textToPinyinStream(rawText);
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  const charSyllableRanges = buildUtteranceSyllableCoordinate(rawText).ranges;
  const utteranceRecall = createUtteranceRecallContext(
    runtime.getManifestVersion?.() ?? 'unknown'
  );

  const stepDetails = [];
  const permanentDropsRaw = [];
  let cursor = 0;
  let guard = 0;
  const formalSpans = [];
  const allRecalledExact = [];

  while (cursor < syllables.length) {
    guard += 1;
    if (guard > syllables.length + 8) break;

    const rawOptions = generateLocalOptionsAtCursor({
      cursor,
      rawText,
      globalSyllables: syllables,
      coarseSpans,
      charSyllableRanges,
    });
    const filtered = blockedFilter({
      windows: rawOptions,
      rawText,
      coarseSpans,
      wordTimeSpans: [],
    });
    const recallable = filtered.filter((w) => !w.blocked);
    const recall = recallable.length
      ? recallTopKForWindows({
          rawText,
          globalSyllables: syllables,
          windows: recallable,
          runtime,
          profile,
          domainIds,
          minPrior: fwConfig.minPrior,
          fuzzyRecallEnabled: false,
          acousticSlices: [],
          wordTimeSpans: [],
          toneTimestampOnlyEnabled: true,
          utteranceRecall,
        })
      : { candidates: [] };

    const byWin = new Map();
    for (const cand of recall.candidates) {
      const list = byWin.get(cand.windowId) || [];
      list.push(cand);
      byWin.set(cand.windowId, list);
      allRecalledExact.push({
        cursor,
        windowId: cand.windowId,
        word: candWord(cand),
        hitKind: cand.hitKind,
        syllableStart: cand.syllableStart,
        syllableEnd: cand.syllableEnd,
        domains: cand.domains || [],
      });
    }

    const { formalSpan, stepTrace } = commitBestFormalFineSpan({
      cursor,
      rawText,
      globalSyllables: syllables,
      coarseSpans,
      rawOptions,
      candidatesByWindowId: byWin,
      domainPriors: [],
      charSyllableRanges,
    });

    const winKey = `${formalSpan.syllableStart}:${formalSpan.syllableEnd}`;
    const droppedHits = [];
    for (const [wid, cands] of byWin.entries()) {
      if (!cands.length) continue;
      const isCommitted =
        wid === winKey || formalSpan.candidates.some((fc) => fc.windowId === wid);
      if (!isCommitted) {
        for (const e of cands) {
          droppedHits.push({
            windowId: wid,
            word: candWord(e),
            hitKind: e.hitKind,
            syllableStart: e.syllableStart,
            syllableEnd: e.syllableEnd,
            domains: e.domains || [],
            winnerText: rawText.slice(formalSpan.rawStart, formalSpan.rawEnd),
            winnerRange: [formalSpan.syllableStart, formalSpan.syllableEnd],
            winnerSource: formalSpan.windowSource,
            reason: formalSpan.selectionReason,
          });
        }
      }
    }
    permanentDropsRaw.push(...droppedHits);
    formalSpans.push(formalSpan);
    stepDetails.push({
      cursor,
      optionTexts: rawOptions.map((w) => ({
        id: w.windowId,
        text: w.windowText,
        blocked: w.blocked || filtered.find((f) => f.windowId === w.windowId)?.blocked,
        cross: w.boundaryCrossCount,
        hitCount: (byWin.get(w.windowId) || []).length,
      })),
      recallable: recallable.length,
      recalledHitCount: recall.candidates.length,
      winner: {
        text: rawText.slice(formalSpan.rawStart, formalSpan.rawEnd),
        range: [formalSpan.syllableStart, formalSpan.syllableEnd],
        reason: formalSpan.selectionReason,
        source: formalSpan.windowSource,
        cand: formalSpan.candidates.length,
      },
      rejectedOptions: (stepTrace?.options || [])
        .filter((o) => o.decision === 'rejected')
        .map((o) => ({
          windowId: o.windowId,
          reason: o.rejectedReason,
          lexical: o.lexicalCompleteness,
          cand: o.candidateCount,
        })),
      droppedHitsAtStep: droppedHits,
    });

    out.totals.steps += 1;
    out.totals.optionsGenerated += rawOptions.length;
    out.totals.optionsRecalled += recallable.length;
    cursor = formalSpan.syllableEnd;
  }

  const committedKeys = new Set();
  for (const s of formalSpans) {
    for (const cand of s.candidates) {
      committedKeys.add(`${cand.syllableStart}:${cand.syllableEnd}:${candWord(cand)}`);
      out.totals.hitsCommitted += 1;
    }
  }
  out.totals.hitsRecalled += allRecalledExact.length;
  if (allRecalledExact.length) out.totals.casesWithAnyRecallHit += 1;

  const truePermanent = [];
  for (const d of permanentDropsRaw) {
    const key = `${d.syllableStart}:${d.syllableEnd}:${d.word}`;
    const laterRescued = formalSpans.some(
      (s) =>
        s.syllableStart === d.syllableStart &&
        s.syllableEnd === d.syllableEnd &&
        s.candidates.some((c) => candWord(c) === d.word)
    );
    if (!laterRescued && !committedKeys.has(key)) {
      truePermanent.push(d);
    }
  }
  out.totals.hitsPermanentlyDropped += truePermanent.length;
  out.totals.exactHitsPermanentlyDropped += truePermanent.filter(
    (d) => d.hitKind === 'exact_term'
  ).length;
  if (truePermanent.length) out.totals.casesWithPermanentDrop += 1;
  const longerDrops = truePermanent.filter(
    (d) => d.syllableEnd - d.syllableStart > d.winnerRange[1] - d.winnerRange[0]
  );
  if (longerDrops.length) out.totals.casesWithLongerExactDropped += 1;

  const allCandidates = formalSpans.flatMap((s) => s.candidates);
  const active = resolveCompatibilityRelations(allCandidates).activeCandidates;
  const pool = buildFineSpanCandidatePool(active, coarseSpans, formalSpans);
  const vote = voteUtteranceDomainFromPool(pool);

  const overlapTrace = [];
  for (const step of stepDetails) {
    const interesting = step.optionTexts.filter((o) =>
      /订单|已经|提交|机场|高速|预订|酒店|拿铁|皇后/.test(o.text || '')
    );
    if (interesting.length || step.droppedHitsAtStep.length) {
      overlapTrace.push({
        cursor: step.cursor,
        options: interesting.length ? interesting : step.optionTexts,
        winner: step.winner,
        droppedHits: step.droppedHitsAtStep,
      });
    }
  }

  out.cases.push({
    caseId: c.id,
    text: rawText,
    syllableCount: syllables.length,
    formalCount: formalSpans.length,
    recalledHits: allRecalledExact.length,
    committedHitKeys: committedKeys.size,
    permanentDropCount: truePermanent.length,
    longerExactPermanentDrops: longerDrops.slice(0, 12),
    permanentDropSample: truePermanent.slice(0, 12),
    overlapTrace: overlapTrace.slice(0, 8),
    formalWithHits: formalSpans
      .filter((s) => s.candidates.length)
      .map((s) => ({
        id: s.spanId,
        text: rawText.slice(s.rawStart, s.rawEnd),
        source: s.windowSource,
        reason: s.selectionReason,
        words: s.candidates.map((c) => ({
          w: candWord(c),
          k: c.hitKind,
          d: c.domains || [],
        })),
      })),
    sampleSteps: stepDetails
      .filter(
        (s) =>
          s.droppedHitsAtStep.length ||
          s.recalledHitCount > 0 ||
          (s.winner.reason || '').includes('complete')
      )
      .slice(0, 10),
    voteRetained: [...vote.retainedDomains],
    voteScores: vote.domainScores,
    activeCandidateCount: active.length,
    recalledHitSample: allRecalledExact.slice(0, 24),
  });
  out.caseCount += 1;
}

const outPath = path.join(__dirname, 'ltr_vs_lattice_necessity_2026_07_29.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      outPath,
      caseCount: out.caseCount,
      totals: out.totals,
      perCase: out.cases.map((c) => ({
        id: c.caseId,
        formal: c.formalCount,
        recalledHits: c.recalledHits,
        committedHits: c.committedHitKeys,
        permanentDrops: c.permanentDropCount,
        longerDrops: c.longerExactPermanentDrops.length,
        formalWithHits: c.formalWithHits.length,
        vote: c.voteRetained,
        active: c.activeCandidateCount,
      })),
    },
    null,
    2
  )
);
