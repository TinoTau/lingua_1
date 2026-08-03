/**
 * Candidate Provenance Audit Probe — READ ONLY.
 * Traces every FineSpan Recall candidate through Compatibility → Domain/Eligibility →
 * Budget → Assembly Grid → CrossPath → KenLM Input.
 * No heuristics / human judgment / looks-odd.
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
const outDir = path.resolve(__dirname, 'candidate_provenance_audit');
const casesDir = path.join(outDir, 'cases');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[provenance] ${m}`);
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
  buildFineSpanCandidatePool,
  filterDomainCandidatesPerSpan,
  budgetPerSpanCandidates,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const { windowCandidateToDomainAwarePickResult } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/window-candidate-to-pick.js')
);
const { getPerSpanCandidateLimit } = require(
  path.join(dist, 'fw-detector/per-span-candidate-limit.js')
);
const { isCandidateEligibleForSpanAssembly } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-span-assembly-eligibility.js')
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

fs.mkdirSync(casesDir, { recursive: true });

const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string');

function caseFileNum(id) {
  const m = String(id).match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)).padStart(3, '0') : String(id);
}

function isSameDomainPick(pick, bucketDomain) {
  return (
    (pick.graphSource === 'domain_term' || pick.graphSource === 'passive_domain_weak') &&
    Boolean(pick.domains?.includes(bucketDomain))
  );
}

function isBasePick(pick) {
  return pick.graphSource === 'base_term';
}

function sentenceUsesPick(combo, pick) {
  if (!combo?.replacements?.length) {
    // fallback: surface appears in text (weaker)
    return typeof combo?.text === 'string' && combo.text.includes(pick.word);
  }
  return combo.replacements.some(
    (r) =>
      r.word === pick.word &&
      r.span &&
      r.span.start === pick.span.start &&
      r.span.end === pick.span.end
  );
}

function emptyStageStats() {
  return {
    recallCandidates: 0,
    compatibilityFail: 0,
    compatibilityPass: 0,
    domainEligibilityDrop: 0,
    domainMembershipDrop: 0,
    domainKeep: 0,
    budgetDrop: 0,
    budgetKeep: 0,
    assemblyYes: 0,
    assemblyNo: 0,
    crossPathDrop: 0,
    crossPathKeep: 0,
    kenlmYes: 0,
    kenlmNo: 0,
  };
}

function addStats(a, b) {
  for (const k of Object.keys(b)) a[k] = (a[k] || 0) + b[k];
  return a;
}

function provenanceForCase(c) {
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
  const allAsmBeforeDedup = [];
  for (const pr of orch.pathAssemblyResults || []) {
    for (const list of pr.perBucketGenerated || []) {
      for (const combo of list) allAsmBeforeDedup.push(combo);
    }
  }

  const caseStats = emptyStageStats();
  const pathsOut = [];
  const neverAssembly = [];
  const budgetDropped = [];
  const domainDropped = [];
  const crossPathDropped = [];
  const designPremature = [];

  for (const pr of orch.pathAssemblyResults || []) {
    const pathFineSpans = pr.pathFineSpans || [];
    const vote = pr.assemblyResult?.vote;
    const retained =
      vote?.retainedDomains?.length > 0 ? [...vote.retainedDomains] : [null];
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
    const compatibility = resolveCompatibilityRelations(pathCandidates);
    const activeById = new Map(
      (compatibility.activeCandidates || []).map((x) => [x.candidateId, x])
    );

    const syntheticCoarse = pathFineSpans.map((s) => ({
      id: s.coarseSpanIds?.[0] || s.spanId,
      text: rawText.slice(s.rawStart, s.rawEnd),
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      source: 'ime_token_boundary',
      boundaryConfidence: 1,
    }));
    const pool = buildFineSpanCandidatePool(
      compatibility.activeCandidates,
      syntheticCoarse,
      pathFineSpans
    );
    const perSpanLimit = getPerSpanCandidateLimit(pathFineSpans.length);

    const bucketOut = [];
    for (let bi = 0; bi < retained.length; bi++) {
      const bucketDomain = retained[bi];
      const filtered = filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain);
      const budgeted = budgetPerSpanCandidates(
        filtered,
        pathFineSpans.length,
        syntheticCoarse,
        pathFineSpans,
        rawText,
        []
      );
      const bucketAsm = (pr.perBucketGenerated || [])[bi] || [];

      const spansOut = [];
      for (let si = 0; si < pool.length; si++) {
        const spanPool = pool[si];
        const fineSpan = {
          fineSpanId: spanPool.fineSpanId,
          rawStart: spanPool.rawRange[0],
          rawEnd: spanPool.rawRange[1],
          syllableStart: spanPool.syllableRange[0],
          syllableEnd: spanPool.syllableRange[1],
        };
        const spanRaw = rawText.slice(fineSpan.rawStart, fineSpan.rawEnd);
        const filt = filtered[si];
        const bud = budgeted[si];
        const budgetedIds = new Set((bud?.selectedCandidates || []).map((p) => p.candidateId));
        const budgetedWords = new Set((bud?.selectedCandidates || []).map((p) => p.word));

        // identity-kept lists after domain filter
        const domainKeptIds = new Set([
          ...(filt?.sameDomainCandidates || []).map((p) => p.candidateId),
          ...(filt?.baseCandidates || []).map((p) => p.candidateId),
          ...(filt?.fallbackCandidates || []).map((p) => p.candidateId),
        ]);

        const candidatesOut = [];
        const seenIds = new Set();

        for (const cand of spanPool.candidates || []) {
          if (seenIds.has(cand.candidateId)) continue;
          seenIds.add(cand.candidateId);
          caseStats.recallCandidates += 1;

          const active = activeById.get(cand.candidateId) || cand;
          const covered = active.isCovered === true;
          const compatibilityStatus = covered ? 'FAIL' : 'PASS';
          if (covered) caseStats.compatibilityFail += 1;
          else caseStats.compatibilityPass += 1;

          const elig = isCandidateEligibleForSpanAssembly(active, fineSpan);
          const converted = windowCandidateToDomainAwarePickResult(active, rawText, fineSpan);

          let domainFilter = 'DROP';
          let dropReason = null;
          let domainModule = null;

          if (covered) {
            domainFilter = 'DROP';
            dropReason = 'DROP_COVERED_CANDIDATE';
            domainModule = 'Compatibility→isCovered（Domain/Eligibility 前已失效）';
            caseStats.domainEligibilityDrop += 1;
          } else if (!converted.ok) {
            domainFilter = 'DROP';
            dropReason = converted.dropReason;
            domainModule = 'filterDomainCandidatesPerSpan / windowCandidateToDomainAwarePickResult';
            caseStats.domainEligibilityDrop += 1;
          } else {
            const pick = converted.pick;
            const isBaseOnly =
              bucketDomain == null ||
              vote.insufficientEvidence ||
              (vote.retainedDomains || []).length === 0;
            if (!isBaseOnly && bucketDomain && isSameDomainPick(pick, bucketDomain)) {
              domainFilter = 'KEEP';
              dropReason = null;
              domainModule = 'SameDomain membership (domains includes bucketDomain)';
              caseStats.domainKeep += 1;
            } else if (isBasePick(pick)) {
              domainFilter = 'KEEP';
              dropReason = null;
              domainModule = 'base_term enters every retained bucket';
              caseStats.domainKeep += 1;
            } else if (isBaseOnly) {
              domainFilter = 'KEEP';
              dropReason = null;
              domainModule = 'base-only / insufficientEvidence fallback list';
              caseStats.domainKeep += 1;
            } else {
              domainFilter = 'DROP';
              dropReason = `DROP_CROSS_DOMAIN_FOR_BUCKET(bucket=${bucketDomain}, candidateDomains=${JSON.stringify(
                pick.domains || []
              )})`;
              domainModule = 'filterDomainCandidatesPerSpan SameDomain membership';
              caseStats.domainMembershipDrop += 1;
            }
          }

          let budget = 'DROP';
          let budgetReason = null;
          if (domainFilter !== 'KEEP') {
            budget = 'DROP';
            budgetReason = 'upstream Domain/Eligibility DROP — Budget 未接收';
          } else if (budgetedIds.has(cand.candidateId) || budgetedWords.has(active.replacement)) {
            // surface dedup may keep another id with same word
            const kept =
              (bud?.selectedCandidates || []).find(
                (p) => p.candidateId === cand.candidateId || p.word === active.replacement
              ) || null;
            budget = 'KEEP';
            budgetReason = kept
              ? `in selectedCandidates (perSpanLimit=${perSpanLimit}; keptId=${kept.candidateId})`
              : `in selectedCandidates (perSpanLimit=${perSpanLimit})`;
            caseStats.budgetKeep += 1;
          } else {
            budget = 'DROP';
            // distinguish surface-dedup vs topk
            const orderedWords = [
              ...(filt?.sameDomainCandidates || []),
              ...(filt?.baseCandidates || []),
              ...(filt?.fallbackCandidates || []),
            ].map((p) => p.word);
            const sameSurfaceEarlier = orderedWords.some(
              (w, idx) =>
                w === active.replacement &&
                orderedWords.indexOf(w) < orderedWords.lastIndexOf(w)
            );
            const surfaceAlreadyInBudget = budgetedWords.has(active.replacement);
            if (surfaceAlreadyInBudget || sameSurfaceEarlier) {
              budgetReason = `SURFACE_DEDUP_FIRST_WINS (same surface already budgeted; perSpanLimit=${perSpanLimit})`;
            } else {
              budgetReason = `PER_SPAN_TOPK_EXCEEDED (perSpanLimit=${perSpanLimit}; spanSlotCount=${pathFineSpans.length})`;
            }
            caseStats.budgetDrop += 1;
            budgetDropped.push({
              caseId: c.id,
              bucketDomain,
              spanRaw,
              word: active.replacement,
              candidateId: cand.candidateId,
              budgetReason,
            });
          }

          if (domainFilter === 'DROP') {
            domainDropped.push({
              caseId: c.id,
              bucketDomain,
              spanRaw,
              word: active.replacement,
              candidateId: cand.candidateId,
              dropReason,
              domainModule,
              domains: active.domains || [],
              source: active.source,
              hitKind: active.hitKind,
            });
          }

          const assembly =
            budget === 'KEEP' ? 'YES' : 'NO';
          const assemblyReason =
            budget === 'KEEP'
              ? 'present in Assembly Grid selectedCandidates for this bucket'
              : budgetReason || dropReason || 'not in Assembly Grid';
          if (assembly === 'YES') caseStats.assemblyYes += 1;
          else {
            caseStats.assemblyNo += 1;
            neverAssembly.push({
              caseId: c.id,
              bucketDomain,
              spanRaw,
              word: active.replacement,
              candidateId: cand.candidateId,
              firstDropModule: covered
                ? 'Compatibility'
                : domainFilter === 'DROP'
                  ? 'DomainFilter'
                  : budget === 'DROP'
                    ? 'Budget'
                    : 'Unknown',
              reason: dropReason || budgetReason,
            });
          }

          // CrossPath / KenLM at candidate level: based on sentences that use this pick
          let crossPath = 'DROP';
          let crossPathReason = null;
          let kenlm = 'NO';
          if (assembly !== 'YES') {
            crossPath = 'DROP';
            crossPathReason = 'upstream Assembly Grid 未包含 — CrossPath 未接收该 Candidate';
            kenlm = 'NO';
            caseStats.crossPathDrop += 1;
            caseStats.kenlmNo += 1;
          } else {
            const pickStub = {
              word: active.replacement,
              span: { start: fineSpan.rawStart, end: fineSpan.rawEnd },
            };
            const asmUsing = bucketAsm.filter((combo) => sentenceUsesPick(combo, pickStub));
            const kenlmUsing = kenlmCombos.filter((combo) => sentenceUsesPick(combo, pickStub));
            const uniqueUsing = uniqueBeforeCap.filter((combo) => sentenceUsesPick(combo, pickStub));

            if (!asmUsing.length) {
              // in grid but no enumerated sentence used this surface (combo not generated / only other slots vary)
              crossPath = 'DROP';
              crossPathReason =
                'in Grid but no Path-bucket sentence replacement used this surface (enumerate/dedup within bucket)';
              kenlm = 'NO';
              caseStats.crossPathDrop += 1;
              caseStats.kenlmNo += 1;
              crossPathDropped.push({
                caseId: c.id,
                bucketDomain,
                spanRaw,
                word: active.replacement,
                crossPathReason,
              });
            } else if (kenlmUsing.length) {
              crossPath = 'KEEP';
              crossPathReason = `sentence(s) using this surface survive CrossPath→KenLM (n=${kenlmUsing.length})`;
              kenlm = 'YES';
              caseStats.crossPathKeep += 1;
              caseStats.kenlmYes += 1;
            } else if (uniqueUsing.length && !kenlmUsing.length) {
              crossPath = 'DROP';
              crossPathReason = 'GLOBAL_CAP_SLICE removed sentence(s) that used this surface';
              kenlm = 'NO';
              caseStats.crossPathDrop += 1;
              caseStats.kenlmNo += 1;
              crossPathDropped.push({
                caseId: c.id,
                bucketDomain,
                spanRaw,
                word: active.replacement,
                crossPathReason,
              });
            } else {
              crossPath = 'DROP';
              crossPathReason =
                'EXACT_TEXT_DEDUP first-wins: sentence(s) using this surface removed as duplicate text of an earlier combo';
              kenlm = 'NO';
              caseStats.crossPathDrop += 1;
              caseStats.kenlmNo += 1;
              crossPathDropped.push({
                caseId: c.id,
                bucketDomain,
                spanRaw,
                word: active.replacement,
                crossPathReason,
              });
            }
          }

          // Design premature: eligible same-domain under limit but budget dropped for non-topk reason other than surface dedup of identical surface from higher score — flag TopK when domain kept and count of domain kept ≤ limit but still dropped without surface dedup
          if (
            domainFilter === 'KEEP' &&
            budget === 'DROP' &&
            dropReason == null &&
            budgetReason &&
            budgetReason.startsWith('PER_SPAN_TOPK_EXCEEDED')
          ) {
            // Under frozen design, TopK budget drop is allowed — not premature.
          }
          if (
            domainFilter === 'KEEP' &&
            !covered &&
            elig.eligible &&
            budget === 'DROP' &&
            budgetReason &&
            budgetReason.startsWith('PER_SPAN_TOPK_EXCEEDED')
          ) {
            // allowed by design (budget)
          }
          // Premature relative to frozen "SameDomain keeps multi candidates until budget":
          // eligibility fail with only hitKind would be premature — we check residual exact_term-only is gone
          if (
            !covered &&
            active.hitKind === 'parent_fragment' &&
            dropReason === 'DROP_UNSUPPORTED_RECALL_SOURCE'
          ) {
            // not hitKind
          }
          // Premature: same-domain eligible candidate dropped by eligibility range when ranges match pool attachment by containment only
          if (
            !covered &&
            !elig.eligible &&
            elig.dropReason === 'DROP_RANGE_MISMATCH' &&
            active.syllableStart >= fineSpan.syllableStart &&
            active.syllableEnd <= fineSpan.syllableEnd
          ) {
            // nested incomplete — by contract DROP_INCOMPLETE or RANGE — not premature
          }
          // Flag: domain KEEP path missing for same domain tags due to eligibility null with DROP_COVERED only after compat — OK

          // Premature design flag: candidate has bucketDomain in domains, exact range match, eligible sources, not covered, but Domain DROP for reason other than cross-domain — eligibility structural reasons are by contract
          if (
            bucketDomain &&
            Array.isArray(active.domains) &&
            active.domains.includes(bucketDomain) &&
            (active.source === 'domain_term' || active.source === 'passive_domain_weak') &&
            !covered &&
            domainFilter === 'DROP' &&
            dropReason &&
            dropReason.startsWith('DROP_') &&
            dropReason !== `DROP_CROSS_DOMAIN_FOR_BUCKET` &&
            !String(dropReason).startsWith('DROP_CROSS_DOMAIN')
          ) {
            // same-domain tagged but eligibility rejected — contractually allowed if incomplete coverage etc.
            // Flag as "design-check" only when eligibility would pass if not for a residual gate
            if (elig.eligible === false && elig.dropReason === 'DROP_EMPTY_REPLACEMENT') {
              designPremature.push({
                caseId: c.id,
                kind: 'SAME_DOMAIN_TAGGED_BUT_ELIGIBILITY_REJECT',
                word: active.replacement,
                dropReason: elig.dropReason,
                note: 'domains includes bucketDomain but eligibility rejected — verify contract',
              });
            }
          }

          candidatesOut.push({
            candidateId: cand.candidateId,
            termId: active.termId ?? null,
            word: active.replacement,
            surface: active.replacement,
            source: active.source,
            graphSourceClass:
              active.source === 'base_term'
                ? 'base'
                : active.source === 'domain_term' || active.source === 'passive_domain_weak'
                  ? 'domain'
                  : active.source,
            recallSource: active.recallSource,
            hitKind: active.hitKind,
            priority: active.candidateRank ?? null,
            score: active.score ?? null,
            candidateScore: active.candidateScore ?? null,
            toneScore: active.tonePenalty ?? null,
            toneCompatible: active.toneCompatible ?? null,
            toneReason: active.toneReason ?? null,
            domainTags: active.domains ? [...active.domains] : [],
            compatibility: compatibilityStatus,
            compatibilityDetail: covered
              ? { isCovered: true, coveredBy: active.coveredBy || null }
              : { isCovered: false },
            domainFilter,
            dropReason,
            domainModule,
            budget,
            budgetReason,
            assembly,
            assemblyReason,
            crossPath,
            crossPathReason,
            kenlm,
          });
        }

        // Canonical preservation candidate (not from Recall list)
        const canon = (bud?.selectedCandidates || []).find((p) =>
          String(p.candidateId || '').startsWith('canonical:')
        );
        if (canon) {
          const pickStub = {
            word: canon.word,
            span: { start: fineSpan.rawStart, end: fineSpan.rawEnd },
          };
          const kenlmUsing = kenlmCombos.filter((combo) => sentenceUsesPick(combo, pickStub));
          candidatesOut.push({
            candidateId: canon.candidateId,
            termId: null,
            word: canon.word,
            surface: canon.word,
            source: 'base_term',
            graphSourceClass: 'canonical_raw_preservation',
            recallSource: 'canonical_exact',
            hitKind: 'exact_term',
            priority: null,
            score: 0,
            candidateScore: 0,
            toneScore: null,
            toneCompatible: null,
            toneReason: null,
            domainTags: [],
            compatibility: 'PASS',
            compatibilityDetail: { note: 'canonical not from Recall Compatibility pool' },
            domainFilter: 'KEEP',
            dropReason: null,
            domainModule: 'budgetPerSpanCandidates always merges canonical/raw preservation',
            budget: 'KEEP',
            budgetReason: 'canonical/raw preservation candidate',
            assembly: 'YES',
            assemblyReason: 'canonical in Assembly Grid',
            crossPath: kenlmUsing.length ? 'KEEP' : 'DROP',
            crossPathReason: kenlmUsing.length
              ? 'sentence using canonical surface in KenLM input'
              : 'no KenLM sentence attributed to canonical surface (may be identical to another kept surface)',
            kenlm: kenlmUsing.length ? 'YES' : 'NO',
            isCanonical: true,
          });
        }

        spansOut.push({
          fineSpanId: spanPool.fineSpanId,
          raw: spanRaw,
          rawRange: spanPool.rawRange,
          syllableRange: spanPool.syllableRange,
          recallCandidateCount: (spanPool.candidates || []).length,
          candidates: candidatesOut,
        });
      }

      bucketOut.push({
        bucketDomain,
        perSpanLimit,
        spans: spansOut,
        assemblySentenceCount: bucketAsm.length,
        assemblySentences: bucketAsm.map((x) => x.text),
      });
    }

    pathsOut.push({
      pathId: pr.pathId,
      retainedDomains: retained,
      domainScores: { ...(vote?.domainScores || {}) },
      insufficientEvidence: !!vote?.insufficientEvidence,
      buckets: bucketOut,
    });
  }

  return {
    caseId: c.id,
    fileNum: caseFileNum(c.id),
    rawText,
    kenlmInputTexts: kenlmCombos.map((x) => x.text),
    kenlmInputCount: kenlmCombos.length,
    uniqueBeforeCapCount: uniqueBeforeCap.length,
    assemblyBeforeDedupCount: allAsmBeforeDedup.length,
    stageStats: caseStats,
    paths: pathsOut,
    lists: {
      neverAssembly,
      budgetDropped,
      domainDropped,
      crossPathDropped,
      designPremature,
    },
  };
}

function renderCaseMd(trace) {
  const lines = [];
  lines.push(`# Candidate Provenance — ${trace.caseId}`);
  lines.push('');
  lines.push('## Raw ASR');
  lines.push('');
  lines.push('```text');
  lines.push(trace.rawText);
  lines.push('```');
  lines.push('');
  lines.push('## Stage Stats (this case)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(trace.stageStats, null, 2));
  lines.push('```');
  lines.push('');

  for (const path of trace.paths || []) {
    lines.push(`## Path \`${path.pathId.slice(0, 12)}…\``);
    lines.push('');
    lines.push(`retainedDomains: ${(path.retainedDomains || []).map(String).join(', ') || '(base-only)'}`);
    lines.push('');
    for (const b of path.buckets || []) {
      lines.push(`### Bucket \`${b.bucketDomain ?? 'base-only'}\` (perSpanLimit=${b.perSpanLimit})`);
      lines.push('');
      for (const sp of b.spans || []) {
        lines.push(`#### Span \`${sp.fineSpanId}\``);
        lines.push('');
        lines.push(`Raw: \`${sp.raw}\``);
        lines.push('');
        for (const cand of sp.candidates || []) {
          lines.push('-----');
          lines.push('');
          lines.push(`Candidate: **${cand.word}**`);
          lines.push('');
          lines.push(`- candidateId: \`${cand.candidateId}\``);
          lines.push(`- termId: \`${cand.termId}\``);
          lines.push(`- surface: ${cand.surface}`);
          lines.push(`- source: ${cand.source} (${cand.graphSourceClass})`);
          lines.push(`- recallSource: ${cand.recallSource}`);
          lines.push(`- hitKind: ${cand.hitKind}`);
          lines.push(`- priority(candidateRank): ${cand.priority}`);
          lines.push(`- score / candidateScore: ${cand.score} / ${cand.candidateScore}`);
          lines.push(`- toneScore(tonePenalty): ${cand.toneScore}`);
          lines.push(`- domainTags: ${JSON.stringify(cand.domainTags)}`);
          lines.push(`- compatibility: **${cand.compatibility}**`);
          lines.push(`- domainFilter: **${cand.domainFilter}**`);
          if (cand.dropReason) lines.push(`- dropReason: \`${cand.dropReason}\``);
          if (cand.domainModule) lines.push(`- domainModule: ${cand.domainModule}`);
          lines.push(`- budget: **${cand.budget}**`);
          if (cand.budgetReason) lines.push(`- budgetReason: ${cand.budgetReason}`);
          lines.push(`- assembly: **${cand.assembly}**`);
          lines.push(`- assemblyReason: ${cand.assemblyReason}`);
          lines.push(`- crossPath: **${cand.crossPath}**`);
          if (cand.crossPathReason) lines.push(`- crossPathReason: ${cand.crossPathReason}`);
          lines.push(`- kenlm: **${cand.kenlm}**`);
          lines.push('');
        }
      }
    }
  }

  lines.push('## KenLM Input Sentences');
  lines.push('');
  (trace.kenlmInputTexts || []).forEach((t, i) => {
    lines.push(`${i + 1}. ${t}`);
  });
  if (!(trace.kenlmInputTexts || []).length) lines.push('（无）');
  lines.push('');
  return lines.join('\n');
}

const globalStats = emptyStageStats();
const globalLists = {
  neverAssembly: [],
  budgetDropped: [],
  domainDropped: [],
  crossPathDropped: [],
  designPremature: [],
};
const caseIndex = [];

let i = 0;
for (const c of dialogCases) {
  i += 1;
  let trace;
  try {
    trace = provenanceForCase(c);
  } catch (e) {
    trace = {
      caseId: c.id,
      fileNum: caseFileNum(c.id),
      rawText: c.text,
      error: String(e?.stack || e),
      stageStats: emptyStageStats(),
      paths: [],
      kenlmInputTexts: [],
      lists: {
        neverAssembly: [],
        budgetDropped: [],
        domainDropped: [],
        crossPathDropped: [],
        designPremature: [],
      },
    };
  }
  addStats(globalStats, trace.stageStats || emptyStageStats());
  for (const k of Object.keys(globalLists)) {
    globalLists[k].push(...(trace.lists?.[k] || []));
  }
  caseIndex.push({
    caseId: trace.caseId,
    file: `${trace.fileNum}.md`,
    recall: trace.stageStats?.recallCandidates || 0,
    assemblyYes: trace.stageStats?.assemblyYes || 0,
    kenlmN: (trace.kenlmInputTexts || []).length,
    error: !!trace.error,
  });
  fs.writeFileSync(path.join(casesDir, `${trace.fileNum}.json`), JSON.stringify(trace, null, 2), 'utf8');
  if (!trace.error) {
    fs.writeFileSync(path.join(casesDir, `${trace.fileNum}.md`), renderCaseMd(trace), 'utf8');
  } else {
    fs.writeFileSync(
      path.join(casesDir, `${trace.fileNum}.md`),
      `# ${trace.caseId}\n\nERROR\n\n\`\`\`\n${trace.error}\n\`\`\`\n`,
      'utf8'
    );
  }
  log(`${i}/${dialogCases.length} ${c.id}`);
}

const aggregate = {
  generatedAt: new Date().toISOString(),
  caseCount: dialogCases.length,
  globalStats,
  flow: {
    Recall: globalStats.recallCandidates,
    CompatibilityPass: globalStats.compatibilityPass,
    CompatibilityFail: globalStats.compatibilityFail,
    DomainKeep: globalStats.domainKeep,
    DomainEligibilityDrop: globalStats.domainEligibilityDrop,
    DomainMembershipDrop: globalStats.domainMembershipDrop,
    BudgetKeep: globalStats.budgetKeep,
    BudgetDrop: globalStats.budgetDrop,
    AssemblyYes: globalStats.assemblyYes,
    AssemblyNo: globalStats.assemblyNo,
    CrossPathKeep: globalStats.crossPathKeep,
    CrossPathDrop: globalStats.crossPathDrop,
    KenlmYes: globalStats.kenlmYes,
    KenlmNo: globalStats.kenlmNo,
  },
  // Cap list sizes in aggregate file
  samples: {
    budgetDropped: globalLists.budgetDropped.slice(0, 200),
    domainDroppedEligibility: globalLists.domainDropped
      .filter((x) => x.dropReason && !String(x.dropReason).startsWith('DROP_CROSS_DOMAIN'))
      .slice(0, 200),
    domainDroppedMembership: globalLists.domainDropped
      .filter((x) => String(x.dropReason || '').startsWith('DROP_CROSS_DOMAIN'))
      .slice(0, 200),
    crossPathDropped: globalLists.crossPathDropped.slice(0, 200),
    designPremature: globalLists.designPremature.slice(0, 200),
  },
  counts: {
    budgetDropped: globalLists.budgetDropped.length,
    domainDropped: globalLists.domainDropped.length,
    crossPathDropped: globalLists.crossPathDropped.length,
    designPremature: globalLists.designPremature.length,
    neverAssembly: globalLists.neverAssembly.length,
  },
  caseIndex,
};

fs.writeFileSync(path.join(outDir, 'aggregate.json'), JSON.stringify(aggregate, null, 2), 'utf8');
fs.writeFileSync(path.join(outDir, 'global_lists.json'), JSON.stringify(globalLists, null, 2), 'utf8');
log(`wrote ${outDir}`);
console.log(JSON.stringify({ flow: aggregate.flow, counts: aggregate.counts }, null, 2));
