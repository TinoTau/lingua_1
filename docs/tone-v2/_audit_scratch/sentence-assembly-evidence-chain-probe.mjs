/**
 * dialog_200 Sentence Assembly Evidence Chain Audit — READ ONLY.
 * Production path only. No human/semantic judgment.
 *
 * Out: docs/tone-v2/_audit_scratch/sentence_assembly_trace/{001..200}.{md,json}
 *      _aggregate.json, sentence_assembly_trace_summary.md
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
const outDir = path.resolve(__dirname, 'sentence_assembly_trace');
const summaryPath = path.resolve(__dirname, 'sentence_assembly_trace_summary.md');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[sa-trace] ${m}`);
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
const {
  filterDomainCandidatesPerSpan,
  budgetPerSpanCandidates,
  buildFineSpanCandidatePool,
  assembleDomainAwareSpanSets,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const { getPerSpanCandidateLimit } = require(
  path.join(dist, 'fw-detector/per-span-candidate-limit.js')
);
const { buildSentenceCandidates } = require(
  path.join(dist, 'fw-detector/build-sentence-candidates.js')
);
const { mergeCrossPathSentenceCandidates } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/merge-cross-path-sentence-candidates.js')
);
const { V4_LIMITS } = require(path.join(dist, 'fw-detector/span-assembly-v4/v4-limits.js'));
const { windowCandidateToDomainAwarePickResult } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/window-candidate-to-pick.js')
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
const maxSentenceCandidates = fwConfig.maxSentenceCandidates ?? 16;

fs.mkdirSync(outDir, { recursive: true });

const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string');

function caseFileNum(id) {
  const m = String(id).match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)).padStart(3, '0') : String(id);
}

function applyReplacementsRtl(rawText, picks) {
  let text = rawText;
  const sorted = [...picks].sort((a, b) => b.start - a.start);
  for (const p of sorted) {
    text = text.slice(0, p.start) + p.word + text.slice(p.end);
  }
  return text;
}

function pickMatchKey(word, start, end) {
  return `${start}:${end}:${word}`;
}

function segmentsFromCombo(rawText, combo) {
  const reps = (combo.replacements || []).map((r) => ({
    start: r.span.start,
    end: r.span.end,
    word: r.word,
    candidateId: r.candidateId ?? null,
    source: r.source,
    repairTarget: r.repairTarget,
    candidateScore: r.candidateScore,
  }));
  const sorted = [...reps].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments = [];
  let cursor = 0;
  for (const r of sorted) {
    if (cursor < r.start) {
      segments.push({
        type: 'RAW',
        text: rawText.slice(cursor, r.start),
        rawRange: [cursor, r.start],
        fineSpanId: null,
        candidateId: null,
        source: 'raw_gap_owner:buildSentenceCandidates.buildGapCanonicalPicks/uncovered',
      });
    }
    const isCanon = r.source === 'canonical_exact' || r.repairTarget === false;
    segments.push({
      type: isCanon ? (r.candidateId?.startsWith('canonical:') ? 'CANONICAL' : 'RAW') : 'DOMAIN_OR_BASE',
      text: r.word,
      rawRange: [r.start, r.end],
      fineSpanId: null,
      candidateId: r.candidateId,
      source: r.source,
      repairTarget: r.repairTarget,
    });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < rawText.length) {
    segments.push({
      type: 'RAW',
      text: rawText.slice(cursor),
      rawRange: [cursor, rawText.length],
      fineSpanId: null,
      candidateId: null,
      source: 'raw_tail',
    });
  }
  const reconstructed = applyReplacementsRtl(
    rawText,
    reps.map((r) => ({ start: r.start, end: r.end, word: r.word }))
  );
  return {
    segments,
    reconstructedText: reconstructed,
    textMatchesFinal: reconstructed === combo.text,
  };
}

function syntheticCoarseFromPath(rawText, pathFineSpans) {
  return pathFineSpans.map((s) => ({
    id: s.coarseSpanIds?.[0] || s.spanId,
    text: rawText.slice(s.rawStart, s.rawEnd),
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
    syllableStart: s.syllableStart,
    syllableEnd: s.syllableEnd,
    source: 'ime_token_boundary',
    boundaryConfidence: 1,
  }));
}

function classifyBucketEligibility(candidate, pickResult, bucketDomain, isBaseOnly) {
  if (!pickResult.ok) {
    return {
      bucketEligible: 'NO',
      reasonCode: pickResult.dropReason || 'DROP_ELIGIBILITY_FAIL',
      ownerModule: 'window-candidate-to-pick.windowCandidateToDomainAwarePickResult',
      decisionFunction: 'isCandidateEligibleForSpanAssembly',
      reasonDetail: `eligibility dropReason=${pickResult.dropReason}`,
    };
  }
  const pick = pickResult.pick;
  const isBase = pick.graphSource === 'base_term';
  const isSame =
    !isBaseOnly &&
    bucketDomain &&
    (pick.graphSource === 'domain_term' || pick.graphSource === 'passive_domain_weak') &&
    Boolean(pick.domains?.includes(bucketDomain));

  if (isSame) {
    return {
      bucketEligible: 'YES',
      reasonCode: 'KEEP_DOMAIN_MATCH',
      ownerModule: 'assemble-domain-aware-span-sets.filterDomainCandidatesPerSpan',
      decisionFunction: 'isSameDomainCandidate',
      reasonDetail: `domains includes bucketDomain=${bucketDomain}`,
    };
  }
  if (isBase) {
    return {
      bucketEligible: 'YES',
      reasonCode: 'KEEP_BASE_FOR_ALL_BUCKETS',
      ownerModule: 'assemble-domain-aware-span-sets.filterDomainCandidatesPerSpan',
      decisionFunction: 'isBaseCandidate',
      reasonDetail: "graphSource==='base_term'",
    };
  }
  if (isBaseOnly) {
    return {
      bucketEligible: 'YES',
      reasonCode: 'KEEP_FALLBACK_BASE_ONLY_BUCKET',
      ownerModule: 'assemble-domain-aware-span-sets.filterDomainCandidatesPerSpan',
      decisionFunction: 'isBaseOnly branch',
      reasonDetail: 'insufficientEvidence/base-only → fallbackCandidates',
    };
  }
  return {
    bucketEligible: 'NO',
    reasonCode: 'DROP_CROSS_DOMAIN_FOR_BUCKET',
    ownerModule: 'assemble-domain-aware-span-sets.filterDomainCandidatesPerSpan',
    decisionFunction: 'cross-domain exclusion',
    reasonDetail: `domain_term/passive not including bucketDomain=${bucketDomain}; intentionally excluded`,
  };
}

function overlaps(a0, a1, b0, b1) {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

function traceCase(c) {
  const rawText = c.text;
  const orch = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    traceCaseId: c.id,
  });

  const kenlmCombos = orch.kenlmSentenceCandidates?.combinations || [];
  const uniqueBeforeCap = orch.kenlmSentenceCandidates?.uniqueBeforeCap || [];
  const crossTrace = orch.kenlmSentenceCandidates?.crossPathMerge || null;

  // Replay CrossPath from production perBucketGenerated (must match)
  const replayMerge = mergeCrossPathSentenceCandidates(
    (orch.pathAssemblyResults || []).map((p) => ({
      pathId: p.pathId,
      boundaryKey: p.boundaryKey,
      perBucketGenerated: p.perBucketGenerated || [],
    })),
    maxSentenceCandidates
  );
  const crossPathTextMatch =
    JSON.stringify(replayMerge.combinations.map((x) => x.text)) ===
    JSON.stringify(kenlmCombos.map((x) => x.text));

  const anomalies = {
    A1: [],
    A2: [],
    A3: [],
    A4: [],
    A5: [],
    A6: [],
    A7: [],
    A8: [],
    A9: [],
    A10: [],
    A11: [],
    A12: [],
    A13: [],
    A14: [],
    A15: [],
    A16: [],
    A17: [],
    A18: [],
    A19: [],
    A20: [],
  };

  const pathsOut = [];
  let budgetDropCount = 0;
  let budgetTriggerSpans = 0;
  let bucketDropCount = 0;
  let assemblyEligibleNoSentence = 0;

  const candidateFateGlobal = [];

  for (let pi = 0; pi < (orch.pathAssemblyResults || []).length; pi++) {
    const pr = orch.pathAssemblyResults[pi];
    const pathFineSpans = pr.pathFineSpans || [];
    const vote = pr.assemblyResult?.vote;
    const retained =
      vote?.retainedDomains?.length > 0 ? [...vote.retainedDomains] : [null];
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const compatibility = resolveCompatibilityRelations(pathCandidates);
    const coarse = syntheticCoarseFromPath(rawText, pathFineSpans);
    const pool = buildFineSpanCandidatePool(
      compatibility.activeCandidates,
      coarse,
      pathFineSpans
    );
    const perSpanLimit = getPerSpanCandidateLimit(pathFineSpans.length);
    const productionBucketSets = pr.assemblyResult?.bucketSpanSets || [];

    const fineSpans = pathFineSpans.map((s, idx) => ({
      fineSpanId: s.spanId,
      rawRange: [s.rawStart, s.rawEnd],
      rawText: rawText.slice(s.rawStart, s.rawEnd),
      syllableRange: [s.syllableStart, s.syllableEnd],
      coarseSpanIds: s.coarseSpanIds || [],
      overlapGroupId: null,
      pathId: pr.pathId,
      productionIndex: idx,
      rawOrderIndex: idx,
    }));

    // Overlap groups among path FineSpans (should be non-overlapping by contract)
    const pathFineOverlap = [];
    for (let i = 0; i < pathFineSpans.length; i++) {
      for (let j = i + 1; j < pathFineSpans.length; j++) {
        const a = pathFineSpans[i];
        const b = pathFineSpans[j];
        if (overlaps(a.rawStart, a.rawEnd, b.rawStart, b.rawEnd)) {
          pathFineOverlap.push({
            a: a.spanId,
            b: b.spanId,
            ranges: [
              [a.rawStart, a.rawEnd],
              [b.rawStart, b.rawEnd],
            ],
          });
        }
      }
    }
    if (pathFineOverlap.length) {
      anomalies.A8.push({ caseId: c.id, pathId: pr.pathId, pathFineOverlap });
    }

    const bucketsOut = [];
    for (let bi = 0; bi < retained.length; bi++) {
      const bucketDomain = retained[bi];
      const isBaseOnly = bucketDomain == null;
      const filtered = filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain);
      const budgeted = budgetPerSpanCandidates(
        filtered,
        pathFineSpans.length,
        coarse,
        pathFineSpans,
        rawText,
        []
      );
      const grid = assembleDomainAwareSpanSets(budgeted);
      const productionGrid = productionBucketSets[bi] || [];
      const productionSentences = (pr.perBucketGenerated || [])[bi] || [];

      // A20: replay buildSentenceCandidates on production grid
      const replayAsm = buildSentenceCandidates(
        rawText,
        productionGrid.length ? productionGrid : grid,
        maxSentenceCandidates
      );
      const prodTexts = productionSentences.map((s) => s.text);
      const replayTexts = replayAsm.combinations.map((s) => s.text);
      const asmReplayMatch = JSON.stringify(prodTexts) === JSON.stringify(replayTexts);
      if (!asmReplayMatch) {
        anomalies.A20.push({
          caseId: c.id,
          pathId: pr.pathId,
          bucketDomain,
          production: prodTexts,
          replay: replayTexts,
        });
      }

      if (productionSentences.length > maxSentenceCandidates) {
        anomalies.A10.push({
          caseId: c.id,
          pathId: pr.pathId,
          bucketDomain,
          count: productionSentences.length,
          limit: maxSentenceCandidates,
        });
      }

      const candTrace = [];
      const usedKeys = new Map(); // matchKey -> sentenceIds
      const sentenceIdByKey = new Map();

      for (let si = 0; si < productionSentences.length; si++) {
        const sent = productionSentences[si];
        const sid = `p${pi}_b${bi}_s${si}`;
        for (const r of sent.replacements || []) {
          const key = pickMatchKey(r.word, r.span.start, r.span.end);
          if (!usedKeys.has(key)) usedKeys.set(key, []);
          usedKeys.get(key).push(sid);
        }
      }

      // NOTE: production domainAwarePickToSpanReplacementPick strips candidateId.
      // Provenance match uses rawRange+surface (PROBE annotation of production gap).
      const candidateIdStrippedInGrid = true;

      // Per-span budget / bucket eligibility for pool candidates
      for (let si = 0; si < pool.length; si++) {
        const spanPool = pool[si];
        const filt = filtered[si];
        const bud = budgeted[si];
        const beforeBudget = [
          ...(filt.sameDomainCandidates || []),
          ...(filt.baseCandidates || []),
          ...(filt.fallbackCandidates || []),
        ];
        const afterBudget = bud.selectedCandidates || [];
        const beforeIds = new Set(beforeBudget.map((p) => p.candidateId));
        const afterIds = new Set(afterBudget.map((p) => p.candidateId));
        const beforeCountForLimit = beforeBudget.length + (afterBudget.some((p) => String(p.candidateId || '').startsWith('canonical:')) ? 0 : 1);
        // Budget trigger: after surface dedupe path, selected length capped — detect drops of non-canonical
        const droppedByBudget = beforeBudget.filter((p) => !afterIds.has(p.candidateId));
        if (droppedByBudget.length) {
          budgetDropCount += droppedByBudget.length;
          budgetTriggerSpans += 1;
        }

        for (const cand of spanPool.candidates) {
          const fineSpanRange = {
            fineSpanId: spanPool.fineSpanId,
            rawStart: spanPool.rawRange[0],
            rawEnd: spanPool.rawRange[1],
            syllableStart: spanPool.syllableRange[0],
            syllableEnd: spanPool.syllableRange[1],
          };
          const converted = windowCandidateToDomainAwarePickResult(cand, rawText, fineSpanRange);
          const elig = classifyBucketEligibility(cand, converted, bucketDomain, isBaseOnly);
          if (elig.bucketEligible === 'NO' && elig.reasonCode === 'DROP_CROSS_DOMAIN_FOR_BUCKET') {
            bucketDropCount += 1;
          }
          if (elig.bucketEligible === 'NO' && elig.reasonCode !== 'DROP_CROSS_DOMAIN_FOR_BUCKET' && !converted.ok) {
            bucketDropCount += 1;
          }

          const inBefore = beforeIds.has(cand.candidateId);
          const inAfter = afterIds.has(cand.candidateId);
          const matchKey = pickMatchKey(cand.replacement, cand.rawStart, cand.rawEnd);
          const sentenceIds = usedKeys.get(matchKey) || [];
          let finalStatus;
          if (sentenceIds.length > 1) finalStatus = 'USED_IN_MULTIPLE_SENTENCES';
          else if (sentenceIds.length === 1) finalStatus = 'USED_IN_SENTENCE';
          else if (elig.bucketEligible === 'NO' && elig.reasonCode === 'DROP_CROSS_DOMAIN_FOR_BUCKET')
            finalStatus = 'DROPPED_BUCKET_MISMATCH';
          else if (elig.bucketEligible === 'NO') finalStatus = 'DROPPED_COMPATIBILITY';
          else if (inBefore && !inAfter) finalStatus = 'DROPPED_BUDGET';
          else if (inAfter && sentenceIds.length === 0) {
            // Identical surface→raw may be absorbed by uniqueByText first-wins without keeping this pick's id
            finalStatus = 'NOT_SELECTED_BY_VALID_PATH';
            assemblyEligibleNoSentence += 1;
            anomalies.A1.push({
              caseId: c.id,
              pathId: pr.pathId,
              bucketDomain,
              candidateId: cand.candidateId,
              word: cand.replacement,
              fineSpanId: spanPool.fineSpanId,
              matchKey,
              note: 'inAfterBudget but no sentence replacement with same rawRange+surface; may be uniqueByText collision or subset not retained after score sort/cap',
            });
          } else finalStatus = 'OTHER_REAL_CODE_REASON';

          candTrace.push({
            candidateId: cand.candidateId,
            matchKey,
            provenanceNote: candidateIdStrippedInGrid
              ? 'Sentence.replacements.candidateId stripped in assembleDomainAwareSpanSets; matched by rawRange+surface'
              : null,
            word: cand.replacement,
            surface: cand.replacement,
            source: cand.source,
            recallSource: cand.recallSource,
            hitKind: cand.hitKind,
            parentTermId: cand.parentTermId ?? null,
            rawRange: [cand.rawStart, cand.rawEnd],
            fineSpanId: spanPool.fineSpanId,
            pathId: pr.pathId,
            domains: [...(cand.domains || [])],
            isBase: cand.source === 'base_term',
            isCovered: Boolean(cand.isCovered),
            isCanonical: false,
            compatibilityStatus: cand.isCovered ? 'covered' : 'active',
            candidateRank: cand.candidateRank,
            candidateScore: cand.score,
            tonePenalty: cand.tonePenalty ?? null,
            ...elig,
            inBeforeBudget: inBefore,
            inAfterBudget: inAfter,
            sentenceIds,
            finalStatus,
          });
          candidateFateGlobal.push({
            caseId: c.id,
            pathId: pr.pathId,
            bucketDomain,
            candidateId: cand.candidateId,
            word: cand.replacement,
            finalStatus,
          });
        }

        // canonical in afterBudget
        for (const p of afterBudget) {
          if (String(p.candidateId || '').startsWith('canonical:')) {
            const key = pickMatchKey(p.word, p.span.start, p.span.end);
            const sentenceIds = usedKeys.get(key) || [];
            candTrace.push({
              candidateId: p.candidateId,
              matchKey: key,
              word: p.word,
              isCanonical: true,
              bucketEligible: 'YES',
              reasonCode: 'KEEP_CANONICAL_PRESERVATION',
              ownerModule: 'budgetPerSpanCandidates',
              decisionFunction: 'domainAwareCanonicalFromPathFineSpan',
              inAfterBudget: true,
              sentenceIds,
              finalStatus:
                sentenceIds.length > 0 ? 'USED_IN_SENTENCE' : 'NOT_SELECTED_BY_VALID_PATH',
            });
          }
        }

        // record budget before/after for this span
        filt._budgetTrace = {
          before: beforeBudget.map((p) => ({ id: p.candidateId, word: p.word, score: p.score })),
          after: afterBudget.map((p) => ({ id: p.candidateId, word: p.word, score: p.score })),
          dropped: droppedByBudget.map((p) => ({
            id: p.candidateId,
            word: p.word,
            reason: 'DROP_PER_SPAN_BUDGET',
          })),
          perSpanLimit,
          sortKey: 'score desc, candidateId asc (stableSortPicks); order sameDomain→base→fallback→canonical; surface dedupe',
          priorQuota: 'NOT_APPLIED (domainPriors=[])',
        };
      }

      const sentencesOut = productionSentences.map((sent, si) => {
        const sid = `p${pi}_b${bi}_s${si}`;
        const seg = segmentsFromCombo(rawText, sent);
        if (!seg.textMatchesFinal) {
          anomalies.A4.push({ caseId: c.id, sentenceId: sid, final: sent.text, reconstructed: seg.reconstructedText });
        }
        // check for out-of-pool words among repairTarget replacements
        const poolWords = new Set(
          pool.flatMap((sp) => sp.candidates.map((x) => x.replacement))
        );
        for (const r of sent.replacements || []) {
          if (r.repairTarget && r.word && !poolWords.has(r.word) && r.source !== 'canonical_exact') {
            // might still be ok if from activeCandidates — check path candidates
            const inPath = pathCandidates.some((x) => x.replacement === r.word);
            if (!inPath) {
              anomalies.A18.push({ caseId: c.id, sentenceId: sid, word: r.word, candidateId: r.candidateId });
            }
          }
        }
        // duplicate raw chars: overlapping replacements
        const reps = sent.replacements || [];
        for (let i = 0; i < reps.length; i++) {
          for (let j = i + 1; j < reps.length; j++) {
            if (
              overlaps(reps[i].span.start, reps[i].span.end, reps[j].span.start, reps[j].span.end)
            ) {
              anomalies.A5.push({
                caseId: c.id,
                sentenceId: sid,
                a: reps[i].candidateId,
                b: reps[j].candidateId,
              });
            }
          }
        }
        // order vs raw
        let last = -1;
        let orderOk = true;
        for (const r of [...reps].sort((a, b) => a.span.start - b.span.start)) {
          if (r.span.start < last) orderOk = false;
          last = r.span.start;
        }
        if (!orderOk) anomalies.A7.push({ caseId: c.id, sentenceId: sid });

        return {
          sentenceId: sid,
          bucketId: `p${pi}_b${bi}`,
          bucketDomain,
          pathId: pr.pathId,
          finalText: sent.text,
          assemblyRank: si + 1,
          assemblyScore: sent.candidateScore,
          replacements: (sent.replacements || []).map((r) => ({
            candidateId: r.candidateId ?? null,
            word: r.word,
            source: r.source,
            repairTarget: r.repairTarget,
            rawRange: [r.span.start, r.span.end],
            spanText: r.span.text,
            candidateScore: r.candidateScore,
          })),
          ...seg,
        };
      });

      // Bucket-internal exact text dedupe evidence (production already unique by text before cap)
      const seenBucketText = new Map();
      const bucketDedupe = [];
      for (const s of sentencesOut) {
        if (seenBucketText.has(s.finalText)) {
          bucketDedupe.push({
            dedupeKey: 'exact_text',
            firstSentenceId: seenBucketText.get(s.finalText),
            duplicateSentenceId: s.sentenceId,
            kept: seenBucketText.get(s.finalText),
            dropped: s.sentenceId,
            reason: 'should_not_appear_in_production_output_after_uniqueByText',
          });
          anomalies.A11.push({ caseId: c.id, sentenceId: s.sentenceId, note: 'duplicate_in_bucket_output' });
        } else {
          seenBucketText.set(s.finalText, s.sentenceId);
        }
      }

      bucketsOut.push({
        bucketId: `p${pi}_b${bi}`,
        bucketDomain,
        sourceRetainedDomain: bucketDomain,
        fineSpanIds: pool.map((p) => p.fineSpanId),
        baseCandidateCount: filtered.reduce((s, f) => s + f.baseCandidates.length, 0),
        domainCandidateCount: filtered.reduce((s, f) => s + f.sameDomainCandidates.length, 0),
        canonicalCandidateCount: budgeted.reduce(
          (s, f) => s + f.selectedCandidates.filter((p) => String(p.candidateId || '').startsWith('canonical:')).length,
          0
        ),
        rawFallbackCount: filtered.reduce((s, f) => s + f.fallbackCandidates.length, 0),
        assemblyDropTraces: filtered.flatMap((f) => f.assemblyDropTraces || []),
        perSpanBudget: filtered.map((f, i) => ({
          fineSpanId: pool[i]?.fineSpanId,
          ...(f._budgetTrace || {}),
        })),
        perSpanLimit,
        gridSlotSizes: (productionGrid.length ? productionGrid : grid).map((slot) => slot.length),
        generatedSentenceCount: productionSentences.length,
        intervalAssemblyCandidateCount: replayAsm.intervalAssemblyCandidateCount,
        intervalRejectedOverlapCount: replayAsm.intervalRejectedOverlapCount,
        limitedSentenceCount: Math.min(productionSentences.length, maxSentenceCandidates),
        limitName: 'maxSentenceCandidates',
        limitValue: maxSentenceCandidates,
        asmReplayMatch,
        candidates: candTrace,
        sentences: sentencesOut,
        bucketDedupe,
      });
    }

    pathsOut.push({
      pathId: pr.pathId,
      pathIndex: pi,
      pathSource: 'SegmentationPath/Lattice',
      pathScore: 'NOT PRESENT IN PRODUCTION TYPE',
      boundaryKey: pr.boundaryKey,
      fineSpanCount: pathFineSpans.length,
      bucketCount: retained.length,
      retainedDomains: vote?.retainedDomains ? [...vote.retainedDomains] : [],
      insufficientEvidence: Boolean(vote?.insufficientEvidence),
      bucketDomains: retained,
      fineSpans,
      pathFineOverlap,
      buckets: bucketsOut,
      sentenceCandidateCount: pr.sentenceCandidateCount,
    });
  }

  // CrossPath drop detail
  const crossPathInput = [];
  for (let pi = 0; pi < (orch.pathAssemblyResults || []).length; pi++) {
    const pr = orch.pathAssemblyResults[pi];
    const retained =
      pr.assemblyResult?.vote?.retainedDomains?.length > 0
        ? [...pr.assemblyResult.vote.retainedDomains]
        : [null];
    for (let bi = 0; bi < (pr.perBucketGenerated || []).length; bi++) {
      for (let si = 0; si < pr.perBucketGenerated[bi].length; si++) {
        const sent = pr.perBucketGenerated[bi][si];
        crossPathInput.push({
          pathId: pr.pathId,
          bucketId: `p${pi}_b${bi}`,
          bucketDomain: retained[bi],
          sentenceId: `p${pi}_b${bi}_s${si}`,
          text: sent.text,
          rank: si + 1,
        });
      }
    }
  }
  const seenCp = new Set();
  const crossPathDrops = [];
  const crossPathOutput = [];
  for (const item of crossPathInput) {
    if (seenCp.has(item.text)) {
      crossPathDrops.push({
        ownerModule: 'merge-cross-path-sentence-candidates',
        decisionFunction: 'mergeCrossPathSentenceCandidates',
        reasonCode: 'DROP_EXACT_TEXT_DUPLICATE_FIRST_WINS',
        dedupeKey: 'exact_text',
        keptSentenceId: crossPathOutput.find((x) => x.text === item.text)?.globalSentenceId,
        droppedSentenceId: item.sentenceId,
        text: item.text,
      });
      continue;
    }
    seenCp.add(item.text);
    crossPathOutput.push({
      globalSentenceId: `cp_${crossPathOutput.length}`,
      sourcePathId: item.pathId,
      sourceBucketId: item.bucketId,
      sourceSentenceId: item.sentenceId,
      text: item.text,
    });
  }
  const truncated = crossPathOutput.slice(maxSentenceCandidates);
  const cappedOutput = crossPathOutput.slice(0, maxSentenceCandidates);
  for (const t of truncated) {
    crossPathDrops.push({
      ownerModule: 'merge-cross-path-sentence-candidates',
      decisionFunction: 'uniqueBeforeCap.slice(0,cap)',
      reasonCode: 'DROP_AFTER_GLOBAL_CAP',
      dedupeKey: null,
      droppedSentenceId: t.globalSentenceId,
      text: t.text,
    });
  }

  // KenLM input provenance
  const kenlmInputs = kenlmCombos.map((combo, idx) => {
    const src = cappedOutput.find((x) => x.text === combo.text) || crossPathOutput.find((x) => x.text === combo.text);
    const candidateIds = (combo.replacements || [])
      .map((r) => r.candidateId)
      .filter(Boolean);
    if (!src) {
      anomalies.A14.push({ caseId: c.id, index: idx, text: combo.text });
    }
    return {
      kenlmInputIndex: idx,
      text: combo.text,
      sourcePathId: src?.sourcePathId ?? null,
      sourceBucketId: src?.sourceBucketId ?? null,
      sourceSentenceId: src?.sourceSentenceId ?? null,
      candidateIds,
      traced: Boolean(src),
      textEqualsCrossPath: Boolean(src) && src.text === combo.text,
      assemblyScore: combo.candidateScore,
      kenlmScore: null,
      kenlmRank: null,
      note: 'KenLM subprocess not required for input provenance; input list = CrossPath combinations',
    };
  });

  if (!crossPathTextMatch) {
    anomalies.A12.push({
      caseId: c.id,
      note: 'replay merge texts differ from orch.kenlmSentenceCandidates',
    });
  }

  if (
    kenlmCombos.some((combo) =>
      (combo.replacements || []).some((r) => r.repairTarget === true && (r.candidateId == null || r.candidateId === ''))
    )
  ) {
    anomalies.A19.push({
      caseId: c.id,
      note: 'PRODUCTION: domainAwarePickToSpanReplacementPick omits candidateId; reverse map uses rawRange+surface',
      owner: 'window-candidate-to-pick.ts::domainAwarePickToSpanReplacementPick',
    });
  }

  return {
    caseId: c.id,
    fileNum: caseFileNum(c.id),
    scenario: c.scenario || c.tag || '',
    rawText,
    pathCount: pathsOut.length,
    maxSentenceCandidates,
    perSpanLimitRule: 'getPerSpanCandidateLimit: <=1→8, 2→6, else→4',
    v4Limits: {
      maxIntervalEnumNodes: V4_LIMITS.maxIntervalEnumNodes,
      maxIntervalRepairPicksPerPath: V4_LIMITS.maxIntervalRepairPicksPerPath,
    },
    paths: pathsOut,
    crossPath: {
      input: crossPathInput,
      output: cappedOutput,
      drops: crossPathDrops,
      uniqueBeforeCapCount: uniqueBeforeCap.length,
      productionTrace: crossTrace,
      replayMatch: crossPathTextMatch,
    },
    kenlmInputs,
    stats: {
      budgetDropCount,
      budgetTriggerSpans,
      bucketDropCount,
      assemblyEligibleNoSentence,
      pathCount: pathsOut.length,
      bucketCount: pathsOut.reduce((s, p) => s + p.buckets.length, 0),
      bucketSentences: pathsOut.reduce(
        (s, p) => s + p.buckets.reduce((ss, b) => ss + b.sentences.length, 0),
        0
      ),
      crossPathOut: kenlmCombos.length,
    },
    anomalies,
    candidateFateGlobal,
  };
}

function toMarkdown(t) {
  const lines = [];
  lines.push(`# Sentence Assembly Trace — ${t.fileNum}`);
  lines.push('');
  lines.push('## 7.1 Case');
  lines.push(`- caseId: \`${t.caseId}\``);
  lines.push(`- scenario: \`${t.scenario}\``);
  lines.push(`- rawText: ${JSON.stringify(t.rawText)}`);
  lines.push(`- pathCount: ${t.pathCount}`);
  for (const p of t.paths) {
    lines.push(
      `- path ${p.pathIndex} retainedDomains=${JSON.stringify(p.retainedDomains)} bucketDomains=${JSON.stringify(p.bucketDomains)}`
    );
  }
  lines.push('');
  for (const p of t.paths) {
    lines.push(`## Path \`${p.pathId}\``);
    lines.push('');
    lines.push('### FineSpans');
    for (const fs of p.fineSpans) {
      lines.push(
        `- ${fs.fineSpanId} raw=${JSON.stringify(fs.rawText)} range=[${fs.rawRange}] syl=[${fs.syllableRange}]`
      );
    }
    if (p.pathFineOverlap?.length) {
      lines.push(`- PATH_FINE_SPAN_OVERLAP: ${JSON.stringify(p.pathFineOverlap)}`);
    }
    for (const b of p.buckets) {
      lines.push('');
      lines.push(`### Bucket \`${b.bucketId}\` domain=${b.bucketDomain}`);
      lines.push(
        `- counts: domain=${b.domainCandidateCount} base=${b.baseCandidateCount} canonical=${b.canonicalCandidateCount} fallback=${b.rawFallbackCount}`
      );
      lines.push(`- perSpanLimit=${b.perSpanLimit} gridSlotSizes=${JSON.stringify(b.gridSlotSizes)}`);
      lines.push(
        `- sentences=${b.generatedSentenceCount} intervalEnumPaths=${b.intervalAssemblyCandidateCount} rejectedOverlap=${b.intervalRejectedOverlapCount} asmReplayMatch=${b.asmReplayMatch}`
      );
      lines.push('');
      lines.push('#### Candidates (eligibility + fate)');
      for (const cand of b.candidates) {
        if (cand.isCanonical) {
          lines.push(
            `- CANONICAL ${cand.candidateId} word=${JSON.stringify(cand.word)} status=${cand.finalStatus} sentences=${JSON.stringify(cand.sentenceIds)}`
          );
          continue;
        }
        lines.push(
          `- ${cand.candidateId} ${JSON.stringify(cand.word)} eligible=${cand.bucketEligible} reason=${cand.reasonCode} budget=${cand.inBeforeBudget}→${cand.inAfterBudget} status=${cand.finalStatus} sentences=${JSON.stringify(cand.sentenceIds)}`
        );
      }
      lines.push('');
      lines.push('#### Budget traces');
      for (const bt of b.perSpanBudget || []) {
        if (!bt.after) continue;
        lines.push(
          `- ${bt.fineSpanId}: before=${bt.before?.length ?? 0} after=${bt.after?.length ?? 0} dropped=${JSON.stringify(bt.dropped || [])}`
        );
      }
      lines.push('');
      lines.push('#### Sentences');
      for (const s of b.sentences) {
        lines.push(`- ${s.sentenceId} score=${s.assemblyScore} textMatch=${s.textMatchesFinal}`);
        lines.push(`  text: ${JSON.stringify(s.finalText)}`);
        lines.push(
          `  replacements: ${JSON.stringify(s.replacements.map((r) => ({ id: r.candidateId, w: r.word, r: r.rawRange, src: r.source, rt: r.repairTarget })))}`
        );
      }
    }
  }
  lines.push('');
  lines.push('## CrossPath');
  lines.push(`- input=${t.crossPath.input.length} uniqueBeforeCap=${t.crossPath.uniqueBeforeCapCount} output=${t.crossPath.output.length} replayMatch=${t.crossPath.replayMatch}`);
  for (const d of t.crossPath.drops.slice(0, 50)) {
    lines.push(`- DROP ${d.reasonCode} text=${JSON.stringify(d.text)} dropped=${d.droppedSentenceId} kept=${d.keptSentenceId}`);
  }
  if (t.crossPath.drops.length > 50) lines.push(`- ... ${t.crossPath.drops.length - 50} more drops`);
  lines.push('');
  lines.push('## KenLM Input');
  for (const k of t.kenlmInputs) {
    lines.push(
      `- #${k.kenlmInputIndex} traced=${k.traced} path=${k.sourcePathId} bucket=${k.sourceBucketId} sent=${k.sourceSentenceId} text=${JSON.stringify(k.text)}`
    );
  }
  lines.push('');
  lines.push('## Anomalies (this case)');
  for (const [k, arr] of Object.entries(t.anomalies)) {
    if (arr.length) lines.push(`- ${k}: ${arr.length}`);
  }
  return lines.join('\n');
}

const aggregate = {
  limits: {
    maxSentenceCandidates,
    perSpanLimitRule: '<=1→8, ==2→6, else→4',
    maxIntervalEnumNodes: V4_LIMITS.maxIntervalEnumNodes,
    maxIntervalRepairPicksPerPath: V4_LIMITS.maxIntervalRepairPicksPerPath,
  },
  totals: {
    totalCases: 0,
    totalPaths: 0,
    totalBuckets: 0,
    totalCandidatesTracked: 0,
    totalBucketSentences: 0,
    totalCrossPathSentences: 0,
    totalKenlmInputs: 0,
    budgetDropCount: 0,
    budgetTriggerSpans: 0,
    bucketDropCount: 0,
    assemblyEligibleNoSentence: 0,
  },
  fateCounts: {},
  multiPath: [],
  multiBucket: [],
  kenlm: { traced: 0, untraced: 0, textMismatch: 0 },
  anomalies: Object.fromEntries([...Array(20)].map((_, i) => [`A${i + 1}`, []])),
  cases: [],
};

const limit = process.env.SA_TRACE_LIMIT ? parseInt(process.env.SA_TRACE_LIMIT, 10) : dialogCases.length;

for (let i = 0; i < limit; i++) {
  const c = dialogCases[i];
  log(`case ${i + 1}/${limit} ${c.id}`);
  const t = traceCase(c);
  fs.writeFileSync(path.join(outDir, `${t.fileNum}.json`), JSON.stringify(t, null, 2));
  fs.writeFileSync(path.join(outDir, `${t.fileNum}.md`), toMarkdown(t));

  aggregate.totals.totalCases += 1;
  aggregate.totals.totalPaths += t.stats.pathCount;
  aggregate.totals.totalBuckets += t.stats.bucketCount;
  aggregate.totals.totalBucketSentences += t.stats.bucketSentences;
  aggregate.totals.totalCrossPathSentences += t.stats.crossPathOut;
  aggregate.totals.totalKenlmInputs += t.kenlmInputs.length;
  aggregate.totals.budgetDropCount += t.stats.budgetDropCount;
  aggregate.totals.budgetTriggerSpans += t.stats.budgetTriggerSpans;
  aggregate.totals.bucketDropCount += t.stats.bucketDropCount;
  aggregate.totals.assemblyEligibleNoSentence += t.stats.assemblyEligibleNoSentence;
  aggregate.totals.totalCandidatesTracked += t.candidateFateGlobal.length;

  for (const f of t.candidateFateGlobal) {
    aggregate.fateCounts[f.finalStatus] = (aggregate.fateCounts[f.finalStatus] || 0) + 1;
  }
  if (t.pathCount > 1) {
    aggregate.multiPath.push({
      caseId: t.caseId,
      pathCount: t.pathCount,
      sentencesPerPath: t.paths.map((p) => ({
        pathId: p.pathId,
        n: p.buckets.reduce((s, b) => s + b.sentences.length, 0),
      })),
    });
  }
  for (const p of t.paths) {
    if (p.buckets.length > 1) {
      aggregate.multiBucket.push({
        caseId: t.caseId,
        pathId: p.pathId,
        buckets: p.buckets.map((b) => ({
          domain: b.bucketDomain,
          sentences: b.generatedSentenceCount,
        })),
      });
    }
  }
  for (const k of t.kenlmInputs) {
    if (k.traced) aggregate.kenlm.traced += 1;
    else aggregate.kenlm.untraced += 1;
    if (!k.textEqualsCrossPath) aggregate.kenlm.textMismatch += 1;
  }
  for (const [ak, arr] of Object.entries(t.anomalies)) {
    for (const item of arr) aggregate.anomalies[ak].push(item);
  }
  aggregate.cases.push({
    caseId: t.caseId,
    fileNum: t.fileNum,
    pathCount: t.pathCount,
    bucketSentences: t.stats.bucketSentences,
    kenlmInputs: t.kenlmInputs.length,
    budgetDrops: t.stats.budgetDropCount,
    A1: t.anomalies.A1.length,
    A14: t.anomalies.A14.length,
    A20: t.anomalies.A20.length,
  });
}

fs.writeFileSync(path.join(outDir, '_aggregate.json'), JSON.stringify(aggregate, null, 2));

const sum = [];
sum.push('# sentence_assembly_trace_summary');
sum.push('');
sum.push('READ ONLY · no human/semantic judgment');
sum.push('');
sum.push('## A. Global counts');
sum.push('```json');
sum.push(JSON.stringify({ limits: aggregate.limits, totals: aggregate.totals }, null, 2));
sum.push('```');
sum.push('');
sum.push('## B. Candidate fate distribution');
sum.push('```json');
sum.push(JSON.stringify(aggregate.fateCounts, null, 2));
sum.push('```');
sum.push('');
sum.push('## C. Step drops');
sum.push(`- Budget DROP count (candidate instances): ${aggregate.totals.budgetDropCount}`);
sum.push(`- Budget trigger spans: ${aggregate.totals.budgetTriggerSpans}`);
sum.push(`- Bucket DROP annotations: ${aggregate.totals.bucketDropCount}`);
sum.push(`- A1 (budget-kept, no sentence): ${aggregate.anomalies.A1.length}`);
sum.push('');
sum.push('## D. Multi Path cases');
sum.push(`count=${aggregate.multiPath.length}`);
for (const row of aggregate.multiPath.slice(0, 40)) sum.push(`- ${JSON.stringify(row)}`);
if (aggregate.multiPath.length > 40) sum.push(`- ... ${aggregate.multiPath.length - 40} more`);
sum.push('');
sum.push('## E. Multi Bucket cases');
sum.push(`count=${aggregate.multiBucket.length}`);
for (const row of aggregate.multiBucket.slice(0, 40)) sum.push(`- ${JSON.stringify(row)}`);
if (aggregate.multiBucket.length > 40) sum.push(`- ... ${aggregate.multiBucket.length - 40} more`);
sum.push('');
sum.push('## I. KenLM input provenance');
sum.push(JSON.stringify(aggregate.kenlm));
sum.push('');
sum.push('## J. Anomaly inventory A1–A20');
for (const [k, arr] of Object.entries(aggregate.anomalies)) {
  sum.push(`- ${k}: ${arr.length}`);
  for (const item of arr.slice(0, 15)) sum.push(`  - ${JSON.stringify(item)}`);
  if (arr.length > 15) sum.push(`  - ... ${arr.length - 15} more`);
}
sum.push('');
fs.writeFileSync(summaryPath, sum.join('\n'));
fs.writeFileSync(path.join(outDir, 'sentence_assembly_trace_summary.md'), sum.join('\n'));
log(
  `done cases=${aggregate.totals.totalCases} A1=${aggregate.anomalies.A1.length} A14=${aggregate.anomalies.A14.length} A20=${aggregate.anomalies.A20.length} untraced=${aggregate.kenlm.untraced}`
);
