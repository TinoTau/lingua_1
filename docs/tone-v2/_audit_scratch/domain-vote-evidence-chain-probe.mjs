/**
 * Domain Vote Evidence Chain Audit Probe — READ ONLY.
 * Production path: runSpanAssemblyV4Orchestrator → runDomainAwareAssembly → voteUtteranceDomainFromPool.
 * Evidence expansion uses the same exported production helpers on the same pool (no alternate Vote formula).
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
const outDir = path.resolve(__dirname, 'domain_vote_trace');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[domain-vote-trace] ${m}`);
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
const { buildFineSpanCandidatePool } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js')
);
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const {
  voteUtteranceDomainFromPool,
  buildFineSpanDomainSet,
  DOMAIN_BUCKET_RETENTION_RATIO,
} = require(path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js'));

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

fs.mkdirSync(outDir, { recursive: true });

const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string');

function caseFileNum(id) {
  const m = String(id).match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)).padStart(3, '0') : String(id);
}

function isVoteDomainLabel(domain) {
  return Boolean(domain) && domain !== 'general' && domain !== 'base_term';
}

function isDomainVoteSource(source) {
  return source === 'domain_term' || source === 'passive_domain_weak';
}

/** Mirrors buildFineSpanDomainSet eligibility branches (production code). */
function classifyVoteEligibility(candidate) {
  if (candidate.isCovered) {
    return {
      voteEligible: 'NO',
      ownerModule: 'utterance-domain-vote.buildFineSpanDomainSet',
      decisionFunction: 'buildFineSpanDomainSet',
      reasonCode: 'COVERED_CANDIDATE_NO_VOTE',
      reasonDetail: 'candidate.isCovered === true → continue (skip)',
    };
  }
  if (candidate.source === 'base_term') {
    return {
      voteEligible: 'NO',
      ownerModule: 'utterance-domain-vote.isDomainVoteSource',
      decisionFunction: 'isDomainVoteSource',
      reasonCode: 'BASE_TERM_NO_DOMAIN_VOTE',
      reasonDetail: "source === 'base_term' is not domain_term|passive_domain_weak",
    };
  }
  if (!isDomainVoteSource(candidate.source)) {
    return {
      voteEligible: 'NO',
      ownerModule: 'utterance-domain-vote.isDomainVoteSource',
      decisionFunction: 'isDomainVoteSource',
      reasonCode: 'SOURCE_NOT_DOMAIN_VOTE_ELIGIBLE',
      reasonDetail: `source=${candidate.source} not in {domain_term, passive_domain_weak}`,
    };
  }
  return {
    voteEligible: 'YES',
    ownerModule: 'utterance-domain-vote.buildFineSpanDomainSet',
    decisionFunction: 'buildFineSpanDomainSet',
    reasonCode: 'VALID_DOMAIN_CANDIDATE',
    reasonDetail: 'not covered + domain_term|passive_domain_weak → domains union into FineSpanDomainSet',
  };
}

function structuralKey(candidate) {
  if (candidate.hitKind === 'parent_fragment' && candidate.parentTermId) {
    return `parent:${candidate.parentTermId}`;
  }
  if (candidate.candidateId) return `id:${candidate.candidateId}`;
  return `exact:${candidate.syllableStart}:${candidate.syllableEnd}:${candidate.score}`;
}

/**
 * Expand per-candidate set contribution exactly as buildFineSpanDomainSet walks candidates.
 */
function expandSpanVoteContributions(candidates) {
  const seenKeys = new Set();
  const rows = [];
  for (const candidate of candidates) {
    const elig = classifyVoteEligibility(candidate);
    const key = structuralKey(candidate);
    let enteredSet = false;
    let structuralDedupeSkip = false;
    const domainsAdded = [];
    if (elig.voteEligible === 'YES') {
      if (seenKeys.has(key)) {
        structuralDedupeSkip = true;
      } else {
        seenKeys.add(key);
        enteredSet = true;
        for (const d of candidate.domains ?? []) {
          if (isVoteDomainLabel(d)) domainsAdded.push(d);
        }
      }
    }
    rows.push({
      candidateId: candidate.candidateId,
      word: candidate.replacement,
      eligibility: elig,
      structuralKey: key,
      structuralDedupeSkip,
      enteredFineSpanDomainSet: enteredSet,
      domainsAddedToSet: domainsAdded,
      multiDomainTags: (candidate.domains ?? []).filter(isVoteDomainLabel),
      multiDomainVotesSeparately: (candidate.domains ?? []).filter(isVoteDomainLabel).length > 1,
      weightSplit: false,
      normalizedAcrossDomains: false,
      top1DomainTruncate: false,
      contributionModel:
        'presence_union: each domain tag added to FineSpanDomainSet once; score +=1 per span later',
    });
  }
  return rows;
}

function retentionReasonForDomain(domain, score, vote) {
  const maxCount = vote.maxCount ?? 0;
  const threshold = maxCount * DOMAIN_BUCKET_RETENTION_RATIO;
  const ratio = maxCount > 0 ? score / maxCount : 0;
  const absoluteGap = maxCount - score;
  const retained = (vote.retainedDomains || []).includes(domain);

  let reasonCode;
  if (vote.insufficientEvidence || maxCount === 0) {
    reasonCode = 'INSUFFICIENT_EVIDENCE';
  } else if (vote.isTie && score === maxCount) {
    reasonCode = 'TIED_TOP';
  } else if (!vote.isTie && score === maxCount && (vote.retainedDomains || []).length === 1) {
    reasonCode = 'UNIQUE_TOP';
  } else if (!vote.isTie && score === maxCount) {
    // unique max but ratio path retained only max when others below threshold
    reasonCode = (vote.retainedDomains || []).length === 1 ? 'UNIQUE_TOP' : 'WITHIN_RATIO_THRESHOLD';
  } else if (!vote.isTie && score >= threshold) {
    reasonCode = 'WITHIN_RATIO_THRESHOLD';
  } else if (!vote.isTie && score < threshold) {
    reasonCode = 'BELOW_RATIO_THRESHOLD';
  } else if (vote.isTie && score < maxCount) {
    reasonCode = 'BELOW_TIED_MAX';
  } else {
    reasonCode = 'OTHER_REAL_CODE_REASON';
  }

  return {
    retained: retained ? 'YES' : 'NO',
    reasonCode,
    topScore: maxCount,
    domainScore: score,
    scoreRatio: ratio,
    absoluteGap,
    configuredThreshold: DOMAIN_BUCKET_RETENTION_RATIO,
    thresholdAbsolute: threshold,
    isTie: Boolean(vote.isTie),
    actualComparisonResult: vote.isTie
      ? `isTie: retain all with count===maxCount(${maxCount}); this score=${score}`
      : `retain iff count>=maxCount*${DOMAIN_BUCKET_RETENTION_RATIO} (=${threshold}); this score=${score}`,
  };
}

function reconstructBucketDomains(vote) {
  if (vote.insufficientEvidence || !vote.retainedDomains?.length) return [null];
  return [...vote.retainedDomains];
}

function scoresEqual(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  }
  return true;
}

function buildPathTrace(rawText, pathResult, pathIndex) {
  const pathFineSpans = pathResult.pathFineSpans || [];
  const productionVote = pathResult.assemblyResult?.vote;
  const pathCandidates = pathFineSpans.flatMap((s) => s.candidates || []);
  const compatibility = resolveCompatibilityRelations(pathCandidates);
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

  // Replay production Vote on identical pool shape for reconciliation (same function).
  const replayVote = voteUtteranceDomainFromPool(pool);

  const fineSpansOut = [];
  const allCandidatesOut = [];
  const contributionsByDomain = {};
  const spanDomainSets = [];
  const multiDomainInstances = [];

  for (let si = 0; si < pool.length; si++) {
    const spanPool = pool[si];
    const pfs = pathFineSpans[si];
    const domainSet = buildFineSpanDomainSet(spanPool.candidates);
    spanDomainSets.push([...domainSet].sort());
    const contribRows = expandSpanVoteContributions(spanPool.candidates);

    fineSpansOut.push({
      fineSpanId: spanPool.fineSpanId,
      rawRange: spanPool.rawRange,
      rawText: rawText.slice(spanPool.rawRange[0], spanPool.rawRange[1]),
      syllableRange: spanPool.syllableRange,
      coarseSpanIds: spanPool.coarseSpanIds || pfs?.coarseSpanIds || [],
      pathId: pathResult.pathId,
      fineSpanDomainSet: [...domainSet].sort(),
    });

    for (const cand of spanPool.candidates) {
      const elig = classifyVoteEligibility(cand);
      const row = contribRows.find((r) => r.candidateId === cand.candidateId);
      allCandidatesOut.push({
        candidateId: cand.candidateId,
        word: cand.replacement,
        surface: cand.replacement,
        source: cand.source,
        recallSource: cand.recallSource,
        hitKind: cand.hitKind,
        rawRange: [cand.rawStart, cand.rawEnd],
        fineSpanId: spanPool.fineSpanId,
        candidateRank: cand.candidateRank,
        score: cand.score,
        toneScore: cand.toneCompatible,
        tonePenalty: cand.tonePenalty,
        domainTags: [...(cand.domains || [])],
        isBase: cand.source === 'base_term',
        isCanonical: false,
        compatibilityStatus: cand.isCovered ? 'covered' : 'active',
        eligibilityStatus: elig,
        voteEligible: elig.voteEligible,
        ownerModule: elig.ownerModule,
        decisionFunction: elig.decisionFunction,
        reasonCode: elig.reasonCode,
        reasonDetail: elig.reasonDetail,
        structuralDedupeSkip: row?.structuralDedupeSkip ?? false,
        enteredFineSpanDomainSet: row?.enteredFineSpanDomainSet ?? false,
        domainsAddedToSet: row?.domainsAddedToSet ?? [],
      });

      if ((cand.domains || []).filter(isVoteDomainLabel).length > 1 && elig.voteEligible === 'YES') {
        multiDomainInstances.push({
          candidateId: cand.candidateId,
          word: cand.replacement,
          fineSpanId: spanPool.fineSpanId,
          domainTags: [...cand.domains],
          votesEachDomainSeparately: true,
          eachDomainSamePresenceContribution: true,
          weightSplit: false,
          normalized: false,
          top1Truncate: false,
          enteredSet: row?.enteredFineSpanDomainSet ?? false,
          structuralDedupeSkip: row?.structuralDedupeSkip ?? false,
        });
      }
    }

    for (const domain of domainSet) {
      if (!contributionsByDomain[domain]) contributionsByDomain[domain] = [];
      const evidenceCands = contribRows
        .filter((r) => r.enteredFineSpanDomainSet && r.domainsAddedToSet.includes(domain))
        .map((r) => ({
          candidateId: r.candidateId,
          word: r.word,
          domainsAdded: r.domainsAddedToSet,
        }));
      contributionsByDomain[domain].push({
        fineSpanId: spanPool.fineSpanId,
        value: 1,
        formula: 'presence: domain ∈ FineSpanDomainSet(span) → +1 once per span',
        evidenceCandidates: evidenceCands,
      });
    }
  }

  const reconstructedScores = {};
  for (const [domain, parts] of Object.entries(contributionsByDomain)) {
    reconstructedScores[domain] = parts.reduce((s, p) => s + p.value, 0);
  }

  const scoreReconcileOk =
    scoresEqual(productionVote?.domainScores, reconstructedScores) &&
    scoresEqual(productionVote?.domainScores, replayVote.domainScores);

  const ranked = Object.entries(productionVote?.domainScores || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const ranking = ranked.map(([domain, rawScore], idx) => {
    const contribs = contributionsByDomain[domain] || [];
    const evidenceFineSpanIds = contribs.map((c) => c.fineSpanId);
    const evidenceCandList = [];
    for (const c of contribs) {
      for (const ec of c.evidenceCandidates) {
        evidenceCandList.push({
          fineSpanId: c.fineSpanId,
          candidateId: ec.candidateId,
          word: ec.word,
        });
      }
    }
    return {
      rank: idx + 1,
      domain,
      rawVoteScore: rawScore,
      adjustedScore: rawScore,
      evidenceFineSpanCount: evidenceFineSpanIds.length,
      evidenceCandidateCount: evidenceCandList.length,
      evidenceFineSpanList: evidenceFineSpanIds,
      evidenceCandidateList: evidenceCandList,
      retention: retentionReasonForDomain(domain, rawScore, productionVote),
    };
  });

  const bucketDomains = reconstructBucketDomains(productionVote);
  const bucketDomainsFromVote = productionVote?.insufficientEvidence
    ? []
    : [...(productionVote?.retainedDomains || [])];
  const bucketMatch =
    JSON.stringify(bucketDomains) ===
    JSON.stringify(
      productionVote?.insufficientEvidence || !productionVote?.retainedDomains?.length
        ? [null]
        : [...productionVote.retainedDomains]
    );

  const baseCandidates = allCandidatesOut.filter((c) => c.isBase);
  const baseInVoteInput = baseCandidates.length;
  const baseContributedDomainVote = baseCandidates.filter((c) => c.enteredFineSpanDomainSet).length;

  return {
    pathId: pathResult.pathId,
    pathIndex,
    boundaryKey: pathResult.boundaryKey,
    fineSpans: fineSpansOut,
    candidates: allCandidatesOut,
    spanDomainSets,
    contributionsByDomain,
    reconstructedScores,
    productionVote: {
      domainScores: { ...(productionVote?.domainScores || {}) },
      retainedDomains: [...(productionVote?.retainedDomains || [])],
      insufficientEvidence: Boolean(productionVote?.insufficientEvidence),
      maxCount: productionVote?.maxCount,
      runnerUpCount: productionVote?.runnerUpCount,
      isTie: Boolean(productionVote?.isTie),
      utteranceDomain: productionVote?.utteranceDomain,
      winnerScore: productionVote?.winnerScore,
      voteMargin: productionVote?.voteMargin,
      parentTermVoteCount: productionVote?.parentTermVoteCount,
    },
    replayVote: {
      domainScores: { ...replayVote.domainScores },
      retainedDomains: [...replayVote.retainedDomains],
      insufficientEvidence: replayVote.insufficientEvidence,
      isTie: replayVote.isTie,
      maxCount: replayVote.maxCount,
    },
    scoreReconcileOk,
    ranking,
    retentionRatio: DOMAIN_BUCKET_RETENTION_RATIO,
    retainedDomains: [...(productionVote?.retainedDomains || [])],
    insufficientEvidence: Boolean(productionVote?.insufficientEvidence),
    baseOnly:
      Boolean(productionVote?.insufficientEvidence) ||
      !(productionVote?.retainedDomains || []).length,
    bucketDomains,
    bucketDomainsFromVote,
    bucketMatch,
    bucketSpanSetsLength: pathResult.assemblyResult?.bucketSpanSets?.length ?? null,
    multiDomainInstances,
    baseHandling: {
      enteredCandidatePool: baseInVoteInput,
      contributedConcreteDomainVote: baseContributedDomainVote,
      affectsInsufficientEvidenceOnlyViaAbsenceOfDomainVotes: true,
      note: 'Base enters pool / every bucket for Assembly; Vote excludes via isDomainVoteSource',
    },
    priors: {
      inputDomainPriors: [],
      priorSource: 'orchestrator input domainPriors (empty for dialog_200 probe)',
      priorValue: null,
      priorAppliedAt: 'NOT_APPLIED_TO_VOTE',
      priorContribution: 0,
      statement: 'No domain priors provided',
    },
    llm: {
      llmDomainInput: null,
      llmDomainResult: null,
      llmWeight: null,
      llmAdjustment: null,
      statement: 'LLM did not participate in this Vote',
    },
    formulaSSOT: {
      text: 'domainScores[domain] = number of distinct fine spans that present the domain',
      code: 'accumulateSpanDomainSets(buildFineSpanDomainSet(span.candidates) for each span)',
      notUsed: [
        'candidateScore mass',
        'toneFactor weight',
        'priorFactor in Vote',
        'llmFactor in Vote',
        'domains.length fan-out split',
        'per-span Top1 only vote',
      ],
    },
  };
}

function toMarkdown(caseMeta, paths) {
  const lines = [];
  lines.push(`# Domain Vote Trace — Case ${caseMeta.fileNum}`);
  lines.push('');
  lines.push('## 6.1 Raw');
  lines.push('');
  lines.push(`- Case ID: \`${caseMeta.id}\``);
  lines.push(`- Scenario: \`${caseMeta.scenario || ''}\``);
  lines.push(`- Raw ASR Text: ${JSON.stringify(caseMeta.rawText)}`);
  lines.push('');

  for (const p of paths) {
    lines.push(`## Path \`${p.pathId}\` (index ${p.pathIndex})`);
    lines.push('');
    lines.push('### 6.2 FineSpan 列表');
    lines.push('');
    for (const fs of p.fineSpans) {
      lines.push(
        `- \`${fs.fineSpanId}\` rawRange=[${fs.rawRange}] rawText=${JSON.stringify(fs.rawText)} syllableRange=[${fs.syllableRange}] coarseSpanIds=${JSON.stringify(fs.coarseSpanIds)} pathId=${fs.pathId} FineSpanDomainSet=${JSON.stringify(fs.fineSpanDomainSet)}`
      );
    }
    lines.push('');
    lines.push('### 6.3 FineSpan Candidate 全量');
    lines.push('');
    for (const c of p.candidates) {
      lines.push(
        `- id=${c.candidateId} word=${JSON.stringify(c.word)} source=${c.source} recallSource=${c.recallSource} hitKind=${c.hitKind} fineSpan=${c.fineSpanId} rank=${c.candidateRank} score=${c.score} tonePenalty=${c.tonePenalty ?? 'n/a'} domainTags=${JSON.stringify(c.domainTags)} isBase=${c.isBase} compat=${c.compatibilityStatus}`
      );
    }
    lines.push('');
    lines.push('### 6.4 Vote Eligibility');
    lines.push('');
    for (const c of p.candidates) {
      lines.push(
        `- ${c.candidateId} (${JSON.stringify(c.word)}): voteEligible=${c.voteEligible} reasonCode=${c.reasonCode} owner=${c.ownerModule} fn=${c.decisionFunction} detail=${c.reasonDetail}; structuralDedupeSkip=${c.structuralDedupeSkip}; enteredFineSpanDomainSet=${c.enteredFineSpanDomainSet}; domainsAdded=${JSON.stringify(c.domainsAddedToSet)}`
      );
    }
    lines.push('');
    lines.push('### 6.5–6.8 Candidate / Domain Contribution (Presence SSOT)');
    lines.push('');
    lines.push('```text');
    lines.push(p.formulaSSOT.text);
    lines.push(p.formulaSSOT.code);
    lines.push('```');
    lines.push('');
    for (const [domain, parts] of Object.entries(p.contributionsByDomain).sort()) {
      lines.push(`#### Domain: \`${domain}\``);
      lines.push('');
      parts.forEach((part, i) => {
        lines.push(
          `- Contribution ${i + 1}: fineSpan=${part.fineSpanId} value=${part.value} evidenceCandidates=${JSON.stringify(part.evidenceCandidates.map((e) => e.word))}`
        );
      });
      lines.push(
        `- Subtotal (presence count): ${p.reconstructedScores[domain]} | production domainScores: ${p.productionVote.domainScores[domain]}`
      );
      lines.push(`- Prior adjustment: none (Vote)`);
      lines.push(`- LLM adjustment: none (Vote)`);
      lines.push(`- Final score: ${p.productionVote.domainScores[domain]}`);
      lines.push('');
    }
    lines.push(`- scoreReconcileOk: **${p.scoreReconcileOk}**`);
    lines.push('');
    lines.push('### 6.6 Multi-Domain Candidate Instances');
    lines.push('');
    if (!p.multiDomainInstances.length) {
      lines.push('- (none with voteEligible=YES and >1 domainTags)');
    } else {
      for (const m of p.multiDomainInstances) {
        lines.push(
          `- ${m.word} tags=${JSON.stringify(m.domainTags)} votesEachDomainSeparately=${m.votesEachDomainSeparately} weightSplit=${m.weightSplit} normalized=${m.normalized} top1Truncate=${m.top1Truncate} enteredSet=${m.enteredSet}`
        );
      }
    }
    lines.push('');
    lines.push('### 6.7 Base Candidate');
    lines.push('');
    lines.push(JSON.stringify(p.baseHandling, null, 2));
    lines.push('');
    lines.push('### 6.9 Prior Domain');
    lines.push('');
    lines.push(`- ${p.priors.statement}`);
    lines.push(`- priorAppliedAt: ${p.priors.priorAppliedAt}`);
    lines.push('');
    lines.push('### 6.10 CPU LLM');
    lines.push('');
    lines.push(`- ${p.llm.statement}`);
    lines.push('');
    lines.push('### 6.11 Domain Ranking');
    lines.push('');
    for (const r of p.ranking) {
      lines.push(
        `- Rank ${r.rank}: ${r.domain} raw=${r.rawVoteScore} adjusted=${r.adjustedScore} fineSpanCount=${r.evidenceFineSpanCount} candidateCount=${r.evidenceCandidateCount} spans=${JSON.stringify(r.evidenceFineSpanList)} cands=${JSON.stringify(r.evidenceCandidateList.map((x) => x.word))}`
      );
    }
    lines.push('');
    lines.push('### 6.12 Retention Decision');
    lines.push('');
    for (const r of p.ranking) {
      const ret = r.retention;
      lines.push(
        `- ${r.domain}: retained=${ret.retained} reason=${ret.reasonCode} topScore=${ret.topScore} domainScore=${ret.domainScore} scoreRatio=${ret.scoreRatio} absoluteGap=${ret.absoluteGap} threshold=${ret.configuredThreshold} thresholdAbs=${ret.thresholdAbsolute} comparison=${ret.actualComparisonResult}`
      );
    }
    if (!p.ranking.length) {
      lines.push('- NO_DOMAIN_EVIDENCE → insufficientEvidence');
    }
    lines.push('');
    lines.push('### 6.13 retainedDomains');
    lines.push('');
    lines.push(`- retainedDomains: ${JSON.stringify(p.retainedDomains)}`);
    lines.push(`- insufficientEvidence: ${p.insufficientEvidence}`);
    lines.push(`- baseOnly: ${p.baseOnly}`);
    lines.push(`- isTie: ${p.productionVote.isTie}`);
    lines.push(`- maxCount: ${p.productionVote.maxCount}`);
    lines.push('');
    lines.push('### 6.14 SameDomain Bucket Handoff');
    lines.push('');
    lines.push(`- retainedDomains from Vote: ${JSON.stringify(p.retainedDomains)}`);
    lines.push(
      `- bucketDomains actually created (reconstructed from Vote handoff formula): ${JSON.stringify(p.bucketDomains)}`
    );
    lines.push(`- bucketSpanSets.length: ${p.bucketSpanSetsLength}`);
    lines.push(`- bucketMatch (formula ↔ retained handoff): ${p.bucketMatch}`);
    lines.push('');
  }
  return lines.join('\n');
}

const aggregate = {
  cases: [],
  noEvidence: [],
  multiRetain: [],
  singleRetain: [],
  priorChanged: [],
  llmAdjusted: [],
  multiDomainWord: [],
  unreconciled: [],
  bucketMismatch: [],
};

const limit = process.env.DOMAIN_VOTE_TRACE_LIMIT
  ? parseInt(process.env.DOMAIN_VOTE_TRACE_LIMIT, 10)
  : dialogCases.length;

for (let i = 0; i < limit; i++) {
  const c = dialogCases[i];
  const fileNum = caseFileNum(c.id);
  log(`case ${i + 1}/${limit} id=${c.id} file=${fileNum}`);

  const orch = runSpanAssemblyV4Orchestrator({
    rawText: c.text,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    traceCaseId: c.id,
  });

  const paths = (orch.pathAssemblyResults || []).map((pr, idx) =>
    buildPathTrace(c.text, pr, idx)
  );

  const caseMeta = {
    id: c.id,
    fileNum,
    scenario: c.scenario || c.tag || '',
    rawText: c.text,
  };

  const jsonOut = {
    case: caseMeta,
    productionEntry:
      'runFwDetectorOrchestrator → runFwDetectorV4Path → runSpanAssemblyV4Orchestrator → runDomainAwareAssembly → voteUtteranceDomainFromPool',
    paths,
  };

  fs.writeFileSync(path.join(outDir, `${fileNum}.json`), JSON.stringify(jsonOut, null, 2));
  fs.writeFileSync(path.join(outDir, `${fileNum}.md`), toMarkdown(caseMeta, paths));

  // Aggregate on path 0 (primary path assembly order)
  const p0 = paths[0];
  if (!p0) continue;

  const retentionReasons = p0.ranking
    .filter((r) => r.retention.retained === 'YES')
    .map((r) => `${r.domain}:${r.retention.reasonCode}`);

  aggregate.cases.push({
    caseId: c.id,
    fileNum,
    raw: c.text,
    domainRanking: p0.ranking.map((r) => ({ domain: r.domain, score: r.rawVoteScore })),
    retainedDomains: p0.retainedDomains,
    retentionReasons,
    insufficientEvidence: p0.insufficientEvidence,
    isTie: p0.productionVote.isTie,
  });

  if (p0.insufficientEvidence || !p0.retainedDomains.length) {
    aggregate.noEvidence.push({
      caseId: c.id,
      fileNum,
      reason: 'selectRetainedDomains: ranked.length===0 → insufficientEvidence',
      domainScores: p0.productionVote.domainScores,
    });
  } else if (p0.retainedDomains.length > 1) {
    aggregate.multiRetain.push({
      caseId: c.id,
      fileNum,
      retainedDomains: p0.retainedDomains,
      isTie: p0.productionVote.isTie,
      reason: p0.productionVote.isTie ? 'TIED_TOP' : 'WITHIN_RATIO_THRESHOLD',
      scores: p0.productionVote.domainScores,
      maxCount: p0.productionVote.maxCount,
    });
  } else {
    aggregate.singleRetain.push({
      caseId: c.id,
      fileNum,
      retainedDomains: p0.retainedDomains,
      scores: p0.productionVote.domainScores,
      maxCount: p0.productionVote.maxCount,
      runnerUpCount: p0.productionVote.runnerUpCount,
    });
  }

  for (const p of paths) {
    if (!p.scoreReconcileOk) {
      aggregate.unreconciled.push({
        caseId: c.id,
        pathId: p.pathId,
        production: p.productionVote.domainScores,
        reconstructed: p.reconstructedScores,
        replay: p.replayVote.domainScores,
      });
    }
    if (!p.bucketMatch || p.bucketSpanSetsLength !== p.bucketDomains.length) {
      aggregate.bucketMismatch.push({
        caseId: c.id,
        pathId: p.pathId,
        retainedDomains: p.retainedDomains,
        bucketDomains: p.bucketDomains,
        bucketSpanSetsLength: p.bucketSpanSetsLength,
        bucketMatch: p.bucketMatch,
      });
    }
    for (const m of p.multiDomainInstances) {
      aggregate.multiDomainWord.push({
        caseId: c.id,
        pathId: p.pathId,
        ...m,
      });
    }
  }
}

fs.writeFileSync(path.join(outDir, '_aggregate.json'), JSON.stringify(aggregate, null, 2));

function writeSummary() {
  const lines = [];
  lines.push('# domain_vote_trace_summary');
  lines.push('');
  lines.push('READ ONLY objective aggregate — no semantic domain judgment.');
  lines.push('');
  lines.push('## A. Each Case retainedDomains (path 0)');
  lines.push('');
  for (const row of aggregate.cases) {
    lines.push(
      `- ${row.fileNum} / ${row.caseId}: ranking=${JSON.stringify(row.domainRanking)} retained=${JSON.stringify(row.retainedDomains)} reasons=${JSON.stringify(row.retentionReasons)} insufficient=${row.insufficientEvidence}`
    );
  }
  lines.push('');
  lines.push('## B. No domain evidence');
  lines.push('');
  lines.push(`count=${aggregate.noEvidence.length}`);
  for (const row of aggregate.noEvidence) {
    lines.push(`- ${row.fileNum}: ${row.reason} scores=${JSON.stringify(row.domainScores)}`);
  }
  lines.push('');
  lines.push('## C. Multi-domain retained');
  lines.push('');
  lines.push(`count=${aggregate.multiRetain.length}`);
  for (const row of aggregate.multiRetain) {
    lines.push(
      `- ${row.fileNum}: retained=${JSON.stringify(row.retainedDomains)} reason=${row.reason} isTie=${row.isTie} maxCount=${row.maxCount} scores=${JSON.stringify(row.scores)}`
    );
  }
  lines.push('');
  lines.push('## D. Single-domain retained');
  lines.push('');
  lines.push(`count=${aggregate.singleRetain.length}`);
  for (const row of aggregate.singleRetain) {
    lines.push(
      `- ${row.fileNum}: retained=${JSON.stringify(row.retainedDomains)} max=${row.maxCount} runnerUp=${row.runnerUpCount} scores=${JSON.stringify(row.scores)}`
    );
  }
  lines.push('');
  lines.push('## E. Prior-changed ranking');
  lines.push('');
  lines.push(
    'count=0 — Vote function does not accept domainPriors; dialog_200 probe passed domainPriors:[]. Counterfactual N/A inside Vote.'
  );
  lines.push('');
  lines.push('## F. LLM-adjusted');
  lines.push('');
  lines.push('count=0 — LLM did not participate in Vote.');
  lines.push('');
  lines.push('## G. Multi-domain word contributions');
  lines.push('');
  lines.push(`count=${aggregate.multiDomainWord.length}`);
  for (const row of aggregate.multiDomainWord) {
    lines.push(
      `- ${row.caseId}/${row.pathId}: ${row.word} tags=${JSON.stringify(row.domainTags)} enteredSet=${row.enteredSet} weightSplit=${row.weightSplit}`
    );
  }
  lines.push('');
  lines.push('## H. Unreconciled scores');
  lines.push('');
  lines.push(`count=${aggregate.unreconciled.length}`);
  for (const row of aggregate.unreconciled) {
    lines.push(`- ${JSON.stringify(row)}`);
  }
  lines.push('');
  lines.push('## I. Vote vs Bucket mismatch');
  lines.push('');
  lines.push(`count=${aggregate.bucketMismatch.length}`);
  for (const row of aggregate.bucketMismatch) {
    lines.push(`- ${JSON.stringify(row)}`);
  }
  lines.push('');
  fs.writeFileSync(path.join(outDir, '..', 'domain_vote_trace_summary.md'), lines.join('\n'));
}

writeSummary();
log(`done cases=${aggregate.cases.length} unreconciled=${aggregate.unreconciled.length} bucketMismatch=${aggregate.bucketMismatch.length}`);
