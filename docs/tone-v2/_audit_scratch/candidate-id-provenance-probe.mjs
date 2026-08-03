/**
 * CandidateId Provenance Contract Audit — READ ONLY probe.
 * Production path only. No code/type/JobResult mutation.
 *
 * Out: docs/tone-v2/_audit_scratch/candidate_id_provenance/{001..200}.json
 *      _aggregate.json, candidate_id_provenance_summary.md
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
const outDir = path.resolve(__dirname, 'candidate_id_provenance');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[cid-prov] ${m}`);
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
const { domainAwarePickToSpanReplacementPick } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/window-candidate-to-pick.js')
);
const { mergeCrossPathSentenceCandidates } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/merge-cross-path-sentence-candidates.js')
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

function matchKey(word, start, end) {
  return `${start}:${end}:${word}`;
}

function idStatus(v) {
  if (v === null) return 'NULL';
  if (v === undefined) return 'ABSENT';
  if (typeof v === 'string' && v.length === 0) return 'EMPTY';
  if (typeof v === 'string') return 'PRESENT';
  return 'OTHER';
}

function synthCoarse(rawText, pathFineSpans) {
  return pathFineSpans.map((s, i) => ({
    id: s.coarseSpanIds?.[0] ?? `coarse:${i}`,
    text: rawText.slice(s.rawStart, s.rawEnd),
    rawStart: s.rawStart,
    rawEnd: s.rawEnd,
    syllableStart: s.syllableStart,
    syllableEnd: s.syllableEnd,
  }));
}

const agg = {
  cases: 0,
  totals: {
    totalCandidates: 0,
    candidateIdsAtPool: 0,
    candidateIdsAfterBucket: 0,
    candidateIdsAfterBudget: 0,
    candidateIdsAtDomainAwarePick: 0,
    candidateIdsAtSpanReplacement: 0,
    candidateIdsAtSentenceReplacement: 0,
    candidateIdsAtCrossPath: 0,
    candidateIdsAtKenlmInput: 0,
    candidateIdsAtJobResult: 0,
    lostAtMapper: 0,
    lostAfterMapper: 0,
    nullAtSentence: 0,
    nullAtJobResult: 0,
    matchKeyCollisions: 0,
    sameRangeSurfaceDifferentId: 0,
    sameIdDifferentRange: 0,
    sameIdDifferentSurface: 0,
    repairReplacementsWithId: 0,
    repairReplacementsWithoutId: 0,
    canonicalReplacementsWithId: 0,
    gapReplacementsWithoutId: 0,
  },
  anomalies: {
    C1: 0,
    C2: 0,
    C3: 0,
    C4: 0,
    C5: 0,
    C6: 0,
    C7: 0,
    C8: 0,
    C9: 0,
    C10: 0,
    C11: 0,
    C12: 0,
    C13: 0,
    C14: 0,
    C15: 0,
    C16: 0,
    C17: 0,
    C18: 0,
  },
  anomalySamples: [],
  casesWithLostAtMapper: 0,
  casesWithMatchKeyCollision: 0,
  casesWithSameRangeSurfaceDifferentId: 0,
};

function pushSample(type, payload) {
  if (agg.anomalySamples.length < 80) {
    agg.anomalySamples.push({ type, ...payload });
  }
}

for (let ci = 0; ci < dialogCases.length; ci++) {
  const c = dialogCases[ci];
  const rawText = c.text;
  const num = caseFileNum(c.id);
  log(`${num} ${c.id}`);

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
  const caseRec = {
    caseId: c.id,
    rawText,
    stages: {
      pool: { present: 0, absent: 0, ids: [] },
      bucket: { present: 0, absent: 0 },
      budget: { present: 0, absent: 0 },
      domainAwarePick: { present: 0, absent: 0 },
      spanReplacement: { present: 0, absent: 0, nullish: 0 },
      sentenceReplacement: { present: 0, absent: 0, nullish: 0, repairPresent: 0, repairAbsent: 0 },
      crossPath: { present: 0, absent: 0, nullish: 0 },
      kenlmInput: { present: 0, absent: 0, nullish: 0 },
      jobResultProjection: {
        note: 'PROBE: no full JobResult; fw_detector.replacements has NO candidateId field; sentenceRerank.topCandidates.candidateId is synthetic candidate:i / raw; sentenceRerank.picked.replacements.candidateId would inherit SpanReplacementPick (currently ABSENT after mapper)',
        fwDetectorReplacementDiagHasCandidateId: false,
        topCandidatesCandidateIdKind: 'SYNTHETIC_INDEX',
        pickedReplacementCandidateId: 'WOULD_BE_ABSENT_IF_PICKED_FROM_CURRENT_CHAIN',
        countPresent: 0,
      },
    },
    mapperLoss: [],
    matchKeyCollisions: [],
    sameRangeSurfaceDifferentId: [],
    sameIdDifferentRange: [],
    sameIdDifferentSurface: [],
    idStability: { bucketChanged: 0, budgetChanged: 0 },
    anomalies: [],
    pathCount: (orch.pathAssemblyResults || []).length,
    kenlmInputCount: kenlmCombos.length,
  };

  const poolIdMeta = new Map(); // id -> {surface, rawStart, rawEnd, source}
  const matchKeyToIds = new Map(); // matchKey -> Set(ids) at pool

  for (let pi = 0; pi < (orch.pathAssemblyResults || []).length; pi++) {
    const pr = orch.pathAssemblyResults[pi];
    const pathFineSpans = pr.pathFineSpans || [];
    const vote = pr.assemblyResult?.vote;
    const retained =
      vote?.retainedDomains?.length > 0 ? [...vote.retainedDomains] : [null];
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const compatibility = resolveCompatibilityRelations(pathCandidates);
    const coarse = synthCoarse(rawText, pathFineSpans);
    const pool = buildFineSpanCandidatePool(
      compatibility.activeCandidates,
      coarse,
      pathFineSpans
    );

    for (const spanPool of pool) {
      for (const cand of spanPool.candidates || []) {
        agg.totals.totalCandidates += 1;
        const st = idStatus(cand.candidateId);
        if (st === 'PRESENT') {
          caseRec.stages.pool.present += 1;
          agg.totals.candidateIdsAtPool += 1;
          caseRec.stages.pool.ids.push(cand.candidateId);
        } else {
          caseRec.stages.pool.absent += 1;
          caseRec.anomalies.push('C1');
          agg.anomalies.C1 += 1;
          pushSample('C1', { caseId: c.id, pathId: pr.pathId, cand });
        }
        if (st === 'PRESENT') {
          const prev = poolIdMeta.get(cand.candidateId);
          if (prev) {
            if (prev.surface !== cand.replacement || prev.rawStart !== cand.rawStart || prev.rawEnd !== cand.rawEnd) {
              caseRec.anomalies.push('C11');
              agg.anomalies.C11 += 1;
              if (prev.surface !== cand.replacement) {
                caseRec.sameIdDifferentSurface.push({
                  id: cand.candidateId,
                  a: prev.surface,
                  b: cand.replacement,
                });
                agg.totals.sameIdDifferentSurface += 1;
              }
              if (prev.rawStart !== cand.rawStart || prev.rawEnd !== cand.rawEnd) {
                caseRec.sameIdDifferentRange.push({
                  id: cand.candidateId,
                  a: [prev.rawStart, prev.rawEnd],
                  b: [cand.rawStart, cand.rawEnd],
                });
                agg.totals.sameIdDifferentRange += 1;
              }
              pushSample('C11', { caseId: c.id, pathId: pr.pathId, id: cand.candidateId });
            }
          } else {
            poolIdMeta.set(cand.candidateId, {
              surface: cand.replacement,
              rawStart: cand.rawStart,
              rawEnd: cand.rawEnd,
              source: cand.source,
            });
          }
          const mk = matchKey(cand.replacement, cand.rawStart, cand.rawEnd);
          if (!matchKeyToIds.has(mk)) matchKeyToIds.set(mk, new Set());
          matchKeyToIds.get(mk).add(cand.candidateId);
        }
      }
    }

    for (let bi = 0; bi < retained.length; bi++) {
      const bucketDomain = retained[bi];
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
      const productionSentences = (pr.perBucketGenerated || [])[bi] || [];

      for (let si = 0; si < filtered.length; si++) {
        const filt = filtered[si];
        const bud = budgeted[si];
        const before = [
          ...(filt.sameDomainCandidates || []),
          ...(filt.baseCandidates || []),
          ...(filt.fallbackCandidates || []),
        ];
        for (const p of before) {
          if (idStatus(p.candidateId) === 'PRESENT') {
            caseRec.stages.bucket.present += 1;
            agg.totals.candidateIdsAfterBucket += 1;
          } else {
            caseRec.stages.bucket.absent += 1;
            caseRec.anomalies.push('C4');
            agg.anomalies.C4 += 1;
          }
        }
        for (const p of bud.selectedCandidates || []) {
          if (idStatus(p.candidateId) === 'PRESENT') {
            caseRec.stages.budget.present += 1;
            caseRec.stages.domainAwarePick.present += 1;
            agg.totals.candidateIdsAfterBudget += 1;
            agg.totals.candidateIdsAtDomainAwarePick += 1;
          } else {
            caseRec.stages.budget.absent += 1;
            caseRec.stages.domainAwarePick.absent += 1;
          }
        }

        // Stability: budgeted non-canonical ids must appear in before set with same id
        const beforeIds = new Set(before.map((p) => p.candidateId));
        for (const p of bud.selectedCandidates || []) {
          if (String(p.candidateId || '').startsWith('canonical:')) continue;
          if (!beforeIds.has(p.candidateId)) {
            // may be newly injected canonical only; if non-canonical missing upstream → C3
            caseRec.idStability.budgetChanged += 1;
            caseRec.anomalies.push('C3');
            agg.anomalies.C3 += 1;
            pushSample('C3', {
              caseId: c.id,
              pathId: pr.pathId,
              bucketDomain,
              candidateId: p.candidateId,
              word: p.word,
            });
          }
        }

        // Exact loss point: DomainAwarePick → SpanReplacementPick
        for (const p of bud.selectedCandidates || []) {
          const mapped = domainAwarePickToSpanReplacementPick(p);
          const inId = p.candidateId;
          const outId = mapped.candidateId;
          if (idStatus(inId) === 'PRESENT' && idStatus(outId) !== 'PRESENT') {
            caseRec.mapperLoss.push({
              pathId: pr.pathId,
              bucketDomain,
              fineSpanId: filt.fineSpanId,
              inputCandidateId: inId,
              inputWord: p.word,
              inputRange: [p.span.start, p.span.end],
              outputCandidateId: outId ?? null,
              outputKeys: Object.keys(mapped),
              lossKind: outId === null ? 'EXPLICIT_NULL' : 'UNMAPPED_ABSENT',
            });
            agg.totals.lostAtMapper += 1;
            caseRec.anomalies.push('C5');
            agg.anomalies.C5 += 1;
          }
          if (idStatus(outId) === 'PRESENT') {
            caseRec.stages.spanReplacement.present += 1;
            agg.totals.candidateIdsAtSpanReplacement += 1;
          } else {
            caseRec.stages.spanReplacement.nullish += 1;
            caseRec.stages.spanReplacement.absent += 1;
          }
        }
      }

      // Production grid (already mapped)
      for (const slot of grid) {
        for (const pick of slot) {
          if (idStatus(pick.candidateId) === 'PRESENT') {
            /* rare if mapper fixed — currently never for production */
          }
        }
      }

      // Sentence replacements from production perBucketGenerated
      for (const sent of productionSentences) {
        for (const r of sent.replacements || []) {
          const st = idStatus(r.candidateId);
          const isRepair = r.repairTarget === true && r.source !== 'canonical_exact';
          const isCanon = r.source === 'canonical_exact';
          if (st === 'PRESENT') {
            caseRec.stages.sentenceReplacement.present += 1;
            agg.totals.candidateIdsAtSentenceReplacement += 1;
            if (isRepair) agg.totals.repairReplacementsWithId += 1;
            if (isCanon) agg.totals.canonicalReplacementsWithId += 1;
          } else {
            caseRec.stages.sentenceReplacement.nullish += 1;
            caseRec.stages.sentenceReplacement.absent += 1;
            agg.totals.nullAtSentence += 1;
            if (isRepair) {
              caseRec.stages.sentenceReplacement.repairAbsent += 1;
              agg.totals.repairReplacementsWithoutId += 1;
              caseRec.anomalies.push('C6');
              agg.anomalies.C6 += 1;
            } else if (isCanon || r.repairTarget === false) {
              agg.totals.gapReplacementsWithoutId += 1;
              caseRec.anomalies.push('C17');
              agg.anomalies.C17 += 1;
            }
          }
        }
      }
    }
  }

  // CrossPath / KenLM input — same object references from merge
  const replayMerge = mergeCrossPathSentenceCandidates(
    (orch.pathAssemblyResults || []).map((p) => ({
      pathId: p.pathId,
      boundaryKey: p.boundaryKey,
      perBucketGenerated: p.perBucketGenerated || [],
    })),
    maxSentenceCandidates
  );

  for (const combo of replayMerge.combinations) {
    for (const r of combo.replacements || []) {
      const st = idStatus(r.candidateId);
      if (st === 'PRESENT') {
        caseRec.stages.crossPath.present += 1;
        caseRec.stages.kenlmInput.present += 1;
        agg.totals.candidateIdsAtCrossPath += 1;
        agg.totals.candidateIdsAtKenlmInput += 1;
      } else {
        caseRec.stages.crossPath.nullish += 1;
        caseRec.stages.kenlmInput.nullish += 1;
        caseRec.stages.crossPath.absent += 1;
        caseRec.stages.kenlmInput.absent += 1;
        // lost before KenLM mapping of replacement ids
        caseRec.anomalies.push('C8');
        agg.anomalies.C8 += 1;
      }
    }
  }

  // JobResult: replacements diag has no field; count as null/absent for provenance
  // topCandidates uses different semantic ID — not WindowCandidate.candidateId
  agg.totals.nullAtJobResult += 1; // structural: no WindowCandidate candidateId on JobResult.replacements
  caseRec.stages.jobResultProjection.countPresent = 0;

  // matchKey collisions at pool
  for (const [mk, ids] of matchKeyToIds) {
    if (ids.size > 1) {
      caseRec.matchKeyCollisions.push({ matchKey: mk, ids: [...ids] });
      agg.totals.matchKeyCollisions += 1;
      caseRec.sameRangeSurfaceDifferentId.push({ matchKey: mk, ids: [...ids] });
      agg.totals.sameRangeSurfaceDifferentId += 1;
      caseRec.anomalies.push('C13');
      agg.anomalies.C13 += 1;
      pushSample('C13', { caseId: c.id, matchKey: mk, ids: [...ids] });
    }
  }

  if (caseRec.mapperLoss.length) agg.casesWithLostAtMapper += 1;
  if (caseRec.matchKeyCollisions.length) agg.casesWithMatchKeyCollision += 1;
  if (caseRec.sameRangeSurfaceDifferentId.length) agg.casesWithSameRangeSurfaceDifferentId += 1;

  // Deduplicate anomaly tags per case for readability
  caseRec.anomalyTypes = [...new Set(caseRec.anomalies)];
  caseRec.anomalies = undefined;
  caseRec.stages.pool.ids = caseRec.stages.pool.ids.slice(0, 20);
  caseRec.mapperLoss = caseRec.mapperLoss.slice(0, 15);
  caseRec.matchKeyCollisions = caseRec.matchKeyCollisions.slice(0, 20);

  fs.writeFileSync(path.join(outDir, `${num}.json`), JSON.stringify(caseRec, null, 2), 'utf8');
  agg.cases += 1;
}

agg.notes = {
  generation: 'recall-topk-for-windows: `${windowId}:${candidateSeq}` — runtime object id, not DB termId',
  uniquenessScope: 'per-window recall bind sequence within a path window; not global UUID',
  firstLossPoint:
    'domainAwarePickToSpanReplacementPick (window-candidate-to-pick.ts) — type optional candidateId? exists but mapper omits field',
  kenlmIndexMapping:
    'rerankFwSentences scores by text array index; picked = candidates[bestIndex]; independent of WindowCandidate.candidateId',
  jobResult:
    'extra.fw_detector spreads FwDetectorResult; FwDetectorReplacementDiag has no candidateId; topCandidates.candidateId is candidate:i / raw (synthetic)',
  recommendation: 'INTERNAL_ONLY (Option A) — passthrough DomainAwarePick→SpanReplacementPick→SentenceReplacement; do not rely on JobResult for provenance',
};

fs.writeFileSync(path.join(outDir, '_aggregate.json'), JSON.stringify(agg, null, 2), 'utf8');

const md = [];
md.push('# candidateId Provenance — dialog_200 Summary');
md.push('');
md.push(`cases: ${agg.cases}`);
md.push('');
md.push('## Totals');
md.push('```json');
md.push(JSON.stringify(agg.totals, null, 2));
md.push('```');
md.push('');
md.push('## Anomaly counts');
md.push('```json');
md.push(JSON.stringify(agg.anomalies, null, 2));
md.push('```');
md.push('');
md.push(`casesWithLostAtMapper: ${agg.casesWithLostAtMapper}`);
md.push(`casesWithMatchKeyCollision: ${agg.casesWithMatchKeyCollision}`);
md.push(`casesWithSameRangeSurfaceDifferentId: ${agg.casesWithSameRangeSurfaceDifferentId}`);
md.push('');
md.push('## Notes');
md.push('```json');
md.push(JSON.stringify(agg.notes, null, 2));
md.push('```');
md.push('');

fs.writeFileSync(path.join(outDir, 'candidate_id_provenance_summary.md'), md.join('\n'), 'utf8');
log(`done cases=${agg.cases} lostAtMapper=${agg.totals.lostAtMapper} matchKeyCollisions=${agg.totals.matchKeyCollisions}`);
