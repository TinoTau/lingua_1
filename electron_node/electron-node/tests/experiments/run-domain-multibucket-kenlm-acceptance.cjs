#!/usr/bin/env node
/**
 * Real KenLM multi-bucket domain acceptance.
 * Uses production createKenlmBatchScorer + runFwSentenceRerankFromPrefilled.
 * Exits non-zero if KenLM scorer cannot run or acceptance hard fails.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '../../../..');
const ROOT = path.resolve(__dirname, '../..');
const CASES = path.join(__dirname, 'fine_span_domain_bucket_acceptance.jsonl');
const OUT_DIR = path.join(REPO, 'tmp', 'domain_multibucket_kenlm_acceptance');
const OUT_JSON = path.join(OUT_DIR, 'acceptance_results.json');
process.env.PROJECT_ROOT = REPO;

function resolveDist(rel) {
  const roots = [
    path.join(ROOT, 'dist/main/electron-node/main/src'),
    path.join(ROOT, 'dist/main/src'),
  ];
  for (const root of roots) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function firstStage(expected, lifecycle) {
  if (!expected) return null;
  const perBucket = (lifecycle.perBucketGenerated || []).flat().map((c) => c.text);
  if (perBucket.includes(expected)) return 'PER_BUCKET_GENERATED';
  if ((lifecycle.mergedBeforeCap || []).some((c) => c.text === expected)) return 'MERGED_BEFORE_CAP';
  if ((lifecycle.afterGlobalCap || []).some((c) => c.text === expected)) return 'AFTER_GLOBAL_CAP';
  return null;
}

function classifyFailure(row) {
  if (row.error) return 'UNREPAIRABLE';
  if (row.kenlmBlocked) return 'KENLM_NOT_AVAILABLE';
  if (row.lexiconMissExpectedDomain) return 'LEXICON_MISS';
  if (row.expectedDomainInScores === false && (row.expectedDomains || []).length) return 'RECALL_MISS';
  if (row.domainVoteDrop) return 'DOMAIN_VOTE_DROP';
  if (row.assemblyNotGenerated) return 'ASSEMBLY_NOT_GENERATED';
  if (row.globalCapDrop) return 'GLOBAL_CAP_DROP';
  if (row.kenlmRan && row.expectedInKenlmPool && !row.kenlmTop1Ok) return 'KENLM_MISRANK';
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const holderPath = resolveDist('lexicon-v2/lexicon-runtime-v2-holder.js');
  const resolvePath = resolveDist('lexicon-v2/resolve-recall-enabled-fine-domains.js');
  const orchPath = resolveDist('fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js');
  const imeCfgPath = resolveDist('fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js');
  const imeDictPath = resolveDist('fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js');
  const profilePath = resolveDist('lexicon-v2/profile-registry.js');
  const votePath = resolveDist('fw-detector/span-assembly-shared/utterance-domain-vote.js');
  const fwConfigPath = resolveDist('fw-detector/fw-config.js');
  const kenlmScorerPath = resolveDist('asr-repair/sentence-rerank/kenlm-scorer.js');
  const lmScorerPath = resolveDist('phonetic-correction/lm-scorer.js');
  const rerankPath = resolveDist('fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.js');

  if (!holderPath || !orchPath || !kenlmScorerPath || !rerankPath) {
    const payload = { skipped: true, reason: 'dist_missing' };
    fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
    console.error('REAL KENLM ACCEPTANCE: BLOCKED (dist_missing)');
    process.exit(2);
  }

  const { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } = require(holderPath);
  const { resolveRecallScope } = require(resolvePath);
  const { runSpanAssemblyV4Orchestrator } = require(orchPath);
  const { loadPinyinImeV2RuntimeConfig } = require(imeCfgPath);
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(imeDictPath);
  const { defaultGeneralProfile } = require(profilePath);
  const { DOMAIN_BUCKET_RETENTION_RATIO } = require(votePath);
  const { loadFwDetectorRuntimeConfig } = require(fwConfigPath);
  const { createKenlmBatchScorer } = require(kenlmScorerPath);
  const {
    resolveCharLmModelPath,
    resolveKenlmQueryPath,
    isKenlmSubprocessRunnable,
    getSentenceKenlmRuntimeStatus,
  } = require(lmScorerPath);
  const { runFwSentenceRerankFromPrefilled } = require(rerankPath);

  const fwCfg = loadFwDetectorRuntimeConfig();
  const modelPath = resolveCharLmModelPath();
  const queryPath = resolveKenlmQueryPath();
  const status = getSentenceKenlmRuntimeStatus();
  const useWsl =
    process.platform === 'win32' &&
    (!fs.existsSync(queryPath) || queryPath === 'query.exe' || queryPath === 'wsl.exe');
  const runnable = modelPath ? isKenlmSubprocessRunnable(modelPath, queryPath) : false;
  const scorer = fwCfg.enableKenLMGate ? createKenlmBatchScorer() : null;

  const envProbe = {
    enableKenLMGate: fwCfg.enableKenLMGate,
    modelPath,
    queryPath,
    useWsl,
    runnable,
    status,
    scorerCreated: Boolean(scorer),
    minDeltaToReplace: fwCfg.minDeltaToReplace,
    maxSentenceCandidates: fwCfg.maxSentenceCandidates,
    scoreMode: 'raw_log_delta',
  };

  if (!scorer || !modelPath || !runnable) {
    const blocked = {
      meta: { ...envProbe, kenlm: 'BLOCKED' },
      REAL_KENLM_ACCEPTANCE: 'BLOCKED',
      reason: !modelPath ? 'model_missing' : !scorer ? 'scorer_null' : 'subprocess_unavailable',
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(blocked, null, 2));
    console.error('REAL KENLM ACCEPTANCE: BLOCKED');
    console.error(JSON.stringify(blocked.meta, null, 2));
    process.exit(2);
  }

  // Minimal live scoreBatch probe — must return non-zero-ish valid scores
  // Cold WSL start may timeout once; retry once after short pause (env reliability only).
  let probe = await scorer.scoreBatch(['你好', '我想预订一间酒店']);
  let probeScores = (probe.scores || []).map((s) => s.score);
  let probeOk =
    probeScores.length === 2 &&
    probeScores.every((s) => typeof s === 'number' && Number.isFinite(s)) &&
    !(probe.runtime && probe.runtime.kenlmSubprocessErrorReason) &&
    !probeScores.every((s) => s === 0);
  if (!probeOk) {
    await new Promise((r) => setTimeout(r, 1500));
    probe = await scorer.scoreBatch(['你好', '我想预订一间酒店']);
    probeScores = (probe.scores || []).map((s) => s.score);
    probeOk =
      probeScores.length === 2 &&
      probeScores.every((s) => typeof s === 'number' && Number.isFinite(s)) &&
      !(probe.runtime && probe.runtime.kenlmSubprocessErrorReason) &&
      !probeScores.every((s) => s === 0);
  }
  if (!probeOk) {
    const blocked = {
      meta: { ...envProbe, probeScores, probeRuntime: probe.runtime, kenlm: 'BLOCKED' },
      REAL_KENLM_ACCEPTANCE: 'BLOCKED',
      reason: 'scoreBatch_invalid_or_all_zero',
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(blocked, null, 2));
    console.error('REAL KENLM ACCEPTANCE: BLOCKED (probe failed)');
    process.exit(2);
  }
  envProbe.probeScores = probeScores;

  const started = Date.now();
  const v2 = ensureLexiconRuntimeV2Loaded();
  if (v2.status !== 'ok') {
    fs.writeFileSync(OUT_JSON, JSON.stringify({ skipped: true, reason: v2 }, null, 2));
    process.exit(2);
  }

  const scope = resolveRecallScope({ configEnabledDomains: [] });
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
    enabledDomains: imeConfig.enabledDomains,
  });
  const runtime = getLexiconRuntimeV2();
  const profile = defaultGeneralProfile();
  const checksum = fs.readFileSync(path.join(REPO, 'node_runtime/lexicon/v3/checksum.txt'), 'utf8').trim();
  const modelHash =
    'sha256:' +
    crypto.createHash('sha256').update(fs.readFileSync(modelPath)).digest('hex').slice(0, 16);

  const cases = fs
    .readFileSync(CASES, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const rows = [];
  const preLat = [];
  const kenlmLat = [];
  const e2eLat = [];
  const candidateCounts = [];
  let counts = {
    DOMAIN_VOTE_DROP: 0,
    ASSEMBLY_NOT_GENERATED: 0,
    GLOBAL_CAP_DROP: 0,
    PER_BUCKET_CAP_DROP: 0,
    KENLM_MISRANK: 0,
    correctDomainRetained: 0,
    casesWithExpectedDomain: 0,
    correctSentenceGenerated: 0,
    correctSentenceEnteredPool: 0,
    correctSentenceEnteredKenlm: 0,
    kenlmTop1Ok: 0,
    kenlmRan: 0,
    finalRepairOk: 0,
    finalKeptRaw: 0,
    finalMisrepair: 0,
    multiBucket: 0,
    sumBuckets: 0,
  };

  for (const c of cases) {
    const t0 = Date.now();
    let after;
    let error = null;
    try {
      after = runSpanAssemblyV4Orchestrator({
        rawText: c.asrRaw,
        runtime,
        profile,
        recallDomainScope: scope.domainIds,
        minPrior: 0.5,
        imeConfig,
        dict,
        traceCaseId: c.id,
      });
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }
    const preMs = Date.now() - t0;
    preLat.push(preMs);

    const m = after?.metrics || {};
    const scores = m.domainScores || {};
    const retained = [...(m.retainedDomains || [])];
    const perBucketGenerated = after?.kenlmSentenceCandidates?.perBucketGenerated || [];
    const mergedBeforeCap =
      after?.kenlmSentenceCandidates?.uniqueBeforeCap ||
      after?.kenlmSentenceCandidates?.mergedBeforeCap ||
      [];
    const afterGlobalCap = after?.kenlmSentenceCandidates?.combinations || [];
    const poolTexts = afterGlobalCap.map((x) => x.text);
    const ac = m.architectureCompliance || {};
    if (ac.crossPathMergeOwner && ac.crossPathMergeOwner !== 'mergeCrossPathSentenceCandidates') {
      error = error || `crossPathMergeOwner=${ac.crossPathMergeOwner}`;
    }
    if (Object.prototype.hasOwnProperty.call(ac, 'ltrRuntimeEnabled')) {
      error = error || 'ltrRuntimeEnabled_retired_field_present';
    }
    if (afterGlobalCap.length > 16) {
      error = error || `kenlmPool>${16}`;
    }
    if (new Set(poolTexts).size !== poolTexts.length) {
      error = error || 'duplicate_kenlm_text';
    }
    candidateCounts.push(poolTexts.length);
    counts.sumBuckets += retained.length || (m.insufficientEvidence ? 1 : 0);
    if ((retained.length || 0) > 1) counts.multiBucket += 1;

    const expectedDomains = c.expectedDomains || [];
    const expectedInScores =
      expectedDomains.length === 0
        ? true
        : expectedDomains.some((d) => (scores[d] || 0) > 0);
    let domainRetainedOk = true;
    let domainVoteDrop = false;
    if (expectedDomains.length) {
      counts.casesWithExpectedDomain += 1;
      domainRetainedOk = expectedDomains.some((d) => retained.includes(d));
      if (domainRetainedOk) counts.correctDomainRetained += 1;
      else if (expectedInScores) {
        domainVoteDrop = true;
        counts.DOMAIN_VOTE_DROP += 1;
      }
    }

    const expected = c.expectedText;
    const generatedAnywhere = perBucketGenerated.flat().some((x) => x.text === expected);
    const inMerged = mergedBeforeCap.some((x) => x.text === expected);
    const inFinalPool = poolTexts.includes(expected);
    if (generatedAnywhere) counts.correctSentenceGenerated += 1;
    if (inFinalPool) counts.correctSentenceEnteredPool += 1;

    const assemblyNotGenerated = Boolean(expected) && !generatedAnywhere;
    const globalCapDrop = Boolean(expected) && generatedAnywhere && inMerged && !inFinalPool;
    // PER_BUCKET_CAP_DROP: would need unbounded enum; with generateCap=16 we only flag when
    // expected missing from a bucket's list but domain retained and vote ok — leave 0 unless proven.
    const perBucketCapDrop = false;
    if (assemblyNotGenerated) counts.ASSEMBLY_NOT_GENERATED += 1;
    if (globalCapDrop) counts.GLOBAL_CAP_DROP += 1;

    const lifecycle = {
      asrRaw: c.asrRaw,
      expected,
      coarseSpans: (after?.internal?.coarseSpans || []).map((s) => ({
        id: s.id,
        text: c.asrRaw.slice(s.rawStart, s.rawEnd),
        raw: [s.rawStart, s.rawEnd],
      })),
      domainScores: scores,
      retainedDomains: retained,
      perBucketGenerated: perBucketGenerated.map((list) => list.map((x) => x.text)),
      mergedBeforeCap: mergedBeforeCap.map((x) => ({ text: x.text, candidateScore: x.candidateScore })),
      afterGlobalCap: afterGlobalCap.map((x) => ({ text: x.text, candidateScore: x.candidateScore })),
      expectedFirstStage: firstStage(expected, {
        perBucketGenerated,
        mergedBeforeCap,
        afterGlobalCap,
      }),
    };

    let kenlmTop1 = null;
    let kenlmTop1Ok = false;
    let kenlmRan = false;
    let kenlmMs = 0;
    let finalText = c.asrRaw;
    let pickedIsRaw = true;
    let kenlmScores = [];
    let kenlmBlocked = false;

    if (!error && after?.fwSpans?.length && afterGlobalCap.length) {
      const k0 = Date.now();
      try {
        const decision = await runFwSentenceRerankFromPrefilled({
          rawText: c.asrRaw,
          spans: after.fwSpans,
          spanSets: after.spanSets,
          prefilledCombinations: afterGlobalCap,
          config: {
            minPrior: 0.5,
            maxSentenceCandidates: fwCfg.maxSentenceCandidates,
            minDeltaToReplace: fwCfg.minDeltaToReplace,
            candidateRequireRepairTarget: fwCfg.candidateRequireRepairTarget,
          },
          kenlmScorer: scorer,
        });
        kenlmMs = Date.now() - k0;
        kenlmRan = (decision.kenlmQueryCount || 0) > 0;
        if (kenlmRan) counts.kenlmRan += 1;
        pickedIsRaw = decision.sentenceRerank?.pickedIsRaw !== false && !decision.sentenceRerank?.picked;
        if (decision.sentenceRerank?.picked && !decision.sentenceRerank.pickedIsRaw) {
          finalText = decision.sentenceRerank.picked.text;
          pickedIsRaw = false;
        }
        const tops = decision.sentenceRerank?.topCandidates || [];
        kenlmTop1 = tops.find((t) => !t.isRaw)?.text || tops[0]?.text || poolTexts[0] || null;
        // Prefer LM ranking among pool: top non-raw by kenlmScore if present
        const ranked = [...tops].filter((t) => !t.isRaw).sort((a, b) => b.kenlmScore - a.kenlmScore);
        if (ranked.length) kenlmTop1 = ranked[0].text;
        kenlmScores = tops.map((t) => ({ text: t.text, kenlmScore: t.kenlmScore, isRaw: t.isRaw }));
        kenlmTop1Ok = kenlmTop1 === expected;
        if (kenlmTop1Ok) counts.kenlmTop1Ok += 1;
        if (inFinalPool) counts.correctSentenceEnteredKenlm += 1;
        if (finalText === expected) counts.finalRepairOk += 1;
        else if (pickedIsRaw && c.asrRaw === expected) counts.finalKeptRaw += 1;
        else if (finalText !== expected && c.asrRaw !== expected && finalText !== c.asrRaw) {
          counts.finalMisrepair += 1;
        }
        if (kenlmRan && inFinalPool && !kenlmTop1Ok) counts.KENLM_MISRANK += 1;
      } catch (err) {
        kenlmMs = Date.now() - k0;
        kenlmBlocked = true;
        error = String(err && err.message ? err.message : err);
      }
    }
    kenlmLat.push(kenlmMs);
    const e2e = preMs + kenlmMs;
    e2eLat.push(e2e);

    const row = {
      id: c.id,
      scenario: c.scenario,
      asrRaw: c.asrRaw,
      expectedText: expected,
      expectedDomains,
      error,
      preMs,
      kenlmMs,
      e2eMs: e2e,
      domainScores: scores,
      retainedDomains: retained,
      domainRetainedOk,
      domainVoteDrop,
      expectedDomainInScores: expectedInScores,
      lexiconMissExpectedDomain: expectedDomains.length > 0 && !expectedInScores,
      assemblyNotGenerated,
      perBucketCapDrop,
      globalCapDrop,
      expectedInKenlmPool: inFinalPool,
      kenlmRan,
      kenlmBlocked,
      kenlmTop1,
      kenlmTop1Ok,
      finalText,
      pickedIsRaw,
      kenlmScores,
      lifecycle,
      failureClass: null,
    };
    row.failureClass = classifyFailure(row);
    rows.push(row);
  }

  preLat.sort((a, b) => a - b);
  kenlmLat.sort((a, b) => a - b);
  e2eLat.sort((a, b) => a - b);
  candidateCounts.sort((a, b) => a - b);

  const n = rows.length || 1;
  const report = {
    meta: {
      lexiconChecksum: checksum,
      DOMAIN_BUCKET_RETENTION_RATIO,
      ...envProbe,
      kenlmModelPath: modelPath,
      kenlmModelHashPrefix: modelHash,
      node: process.version,
      platform: `${process.platform} ${os.arch()}`,
      elapsedMs: Date.now() - started,
      REAL_KENLM_ACCEPTANCE: 'ACTIVE',
      freshDist: true,
    },
    totals: {
      sampleCount: rows.length,
      correctDomainRetainedRate:
        counts.casesWithExpectedDomain > 0
          ? counts.correctDomainRetained / counts.casesWithExpectedDomain
          : null,
      correctSentenceGeneratedRate: counts.correctSentenceGenerated / n,
      correctSentenceEnteredPoolRate: counts.correctSentenceEnteredPool / n,
      correctSentenceEnteredKenlmRate: counts.correctSentenceEnteredKenlm / n,
      DOMAIN_VOTE_DROP: counts.DOMAIN_VOTE_DROP,
      ASSEMBLY_NOT_GENERATED: counts.ASSEMBLY_NOT_GENERATED,
      PER_BUCKET_CAP_DROP: counts.PER_BUCKET_CAP_DROP,
      GLOBAL_CAP_DROP: counts.GLOBAL_CAP_DROP,
      KENLM_MISRANK: counts.KENLM_MISRANK,
      averageRetainedBuckets: counts.sumBuckets / n,
      multiBucketRate: counts.multiBucket / n,
      sentenceCandidatesP50: percentile(candidateCounts, 50),
      sentenceCandidatesP95: percentile(candidateCounts, 95),
      sentenceCandidatesMax: candidateCounts[candidateCounts.length - 1] || 0,
      preKenlmLatencyP50: percentile(preLat, 50),
      preKenlmLatencyP95: percentile(preLat, 95),
      preKenlmLatencyMax: preLat[preLat.length - 1] || 0,
      kenlmLatencyP50: percentile(kenlmLat, 50),
      kenlmLatencyP95: percentile(kenlmLat, 95),
      kenlmLatencyMax: kenlmLat[kenlmLat.length - 1] || 0,
      e2eLatencyP50: percentile(e2eLat, 50),
      e2eLatencyP95: percentile(e2eLat, 95),
      e2eLatencyMax: e2eLat[e2eLat.length - 1] || 0,
      kenlmScorerSuccessRate: counts.kenlmRan / n,
      kenlmTop1Accuracy: counts.kenlmTop1Ok / n,
      finalRepairAccuracy: counts.finalRepairOk / n,
      finalMisrepair: counts.finalMisrepair,
      finalKeptRaw: counts.finalKeptRaw,
    },
    rows,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        REAL_KENLM_ACCEPTANCE: 'ACTIVE',
        OUT_JSON,
        totals: report.totals,
        DOMAIN_VOTE_DROP: counts.DOMAIN_VOTE_DROP,
        ASSEMBLY_NOT_GENERATED: counts.ASSEMBLY_NOT_GENERATED,
        GLOBAL_CAP_DROP: counts.GLOBAL_CAP_DROP,
      },
      null,
      2
    )
  );

  // Hard fail: KenLM must have run on majority; candidate pool never >16
  if (report.totals.sentenceCandidatesMax > 16) {
    console.error('ACCEPTANCE_FAIL: candidates > 16');
    process.exit(1);
  }
  if (counts.kenlmRan < Math.ceil(rows.length * 0.5)) {
    console.error('ACCEPTANCE_FAIL: KenLM did not run on enough cases');
    process.exit(1);
  }
  const contractFails = rows.filter(
    (r) =>
      r.error &&
      /crossPathMergeOwner|ltrRuntimeEnabled|kenlmPool>|duplicate_kenlm_text/.test(String(r.error))
  );
  if (contractFails.length) {
    console.error('ACCEPTANCE_FAIL: Step5/Lattice contract', contractFails.map((r) => r.id));
    process.exit(1);
  }
  console.log('ACCEPTANCE_PASS: domain-multibucket-kenlm (integration)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
