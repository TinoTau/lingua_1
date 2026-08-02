/**
 * Forced Activation Vote Trace for 6 REVIEW_DOMAIN_MODEL terms.
 * Minimal legal probe: surface as utterance + Mandatory Tone + ASR word times.
 * WITH vs WITHOUT (Probe exclude full compound). No Source mutation in this script.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'forced_activation_six');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { makeCharToneFixtures } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/test-tone-fixtures.js')
);
const { resolveCompatibilityRelations } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/candidate-compatibility-graph.js')
);
const {
  buildFineSpanCandidatePool,
  runDomainAwareAssembly,
} = require(path.join(dist, 'fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { voteUtteranceDomainFromPool, buildFineSpanDomainSet } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);

const SIX = [
  { surface: '回归测试', segments: ['回归', '测试'] },
  { surface: '测试数据', segments: ['测试', '数据'] },
  { surface: '特征工程', segments: ['特征', '工程'] },
  { surface: '迷你吧', segments: ['迷你', '吧'] },
  { surface: '配置文件', segments: ['配置', '文件'] },
  { surface: '集成测试', segments: ['集成', '测试'] },
];

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });
const profile = defaultGeneralProfile();
const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), {
  enabledDomains: ime.enabledDomains,
});
const rt = new LexiconRuntimeV2();
if (rt.loadFromBundleDir(candidateDir).status !== 'ok') throw new Error('load fail');
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

function tonesOf(word) {
  const row =
    db.prepare(`SELECT tone_pinyin_key, pinyin_key FROM term WHERE word=? AND enabled=1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key, pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(
      word
    );
  if (!row) throw new Error(`missing ${word}`);
  const tones = String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      const n = m ? Number(m[1]) : 1;
      return n >= 1 && n <= 5 ? n : 1;
    });
  return { tones, pinyin_key: row.pinyin_key, tone_pinyin_key: row.tone_pinyin_key };
}

function domainsOf(word) {
  return db
    .prepare(`SELECT domain_id FROM domain_lexicon WHERE word=? AND enabled=1`)
    .all(word)
    .map((r) => r.domain_id)
    .sort();
}

function wrapExclude(runtime, word) {
  return new Proxy(runtime, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      if (String(prop).startsWith('lookup')) {
        return function (...args) {
          const out = val.apply(target, args);
          if (Array.isArray(out)) return out.filter((h) => String(h?.word || '') !== word);
          return out;
        };
      }
      return function (...args) {
        return val.apply(target, args);
      };
    },
  });
}

function isVoteDomainLabel(d) {
  return Boolean(d) && d !== 'general' && d !== 'base_term';
}

function analyze(runtime, surface) {
  const { tones, pinyin_key, tone_pinyin_key } = tonesOf(surface);
  const fix = makeCharToneFixtures(surface, tones);
  const chars = [...surface];
  const words = chars.map((ch, i) => ({
    word: ch,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    probability: 0.99,
  }));
  const asrSegments = [
    { text: surface, start: 0, end: (chars.length - 1) * 0.1 + 0.09, words },
  ];
  const wordTimeSpans = words.map((w, i) => ({
    word: w.word,
    rawStart: i,
    rawEnd: i + 1,
    start: w.start,
    end: w.end,
  }));

  const syl = String(pinyin_key).split('|').filter(Boolean);
  const exact = recallSpanTopKV2(runtime, {
    syllables: syl,
    windowText: surface,
    termLength: syl.length,
    topK: 5,
    perSpanLimit: 5,
    profile,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  const exactHit = exact.hits.find((h) => h.hotword.word === surface);

  const partition = partitionCoarseSpans({ rawText: surface, imeConfig: ime, dict, asrSegments });
  const lattice = runLatticeFineSpanGeneration({
    rawText: surface,
    runtime,
    profile,
    domainIds,
    minPrior: fw.minPrior,
    imeConfig: ime,
    dict,
    coarseSpans: partition.coarseSpans,
    acousticSlices: fix.acousticSlices,
    wordTimeSpans,
    toneTimestampOnlyEnabled: true,
  });
  if (!lattice.ok) throw new Error(lattice.message);

  const edgeHits = [];
  for (const e of lattice.lexicalEdges || []) {
    for (const c of e.candidates || []) {
      if (c.replacement === surface) {
        edgeHits.push({
          edgeId: e.edgeId,
          range: `${e.syllableStart}:${e.syllableEnd}`,
          source: c.source,
          domains: c.domains || [],
          termId: c.termId,
          hitKind: c.hitKind,
        });
      }
    }
  }

  const pathTraces = [];
  for (const view of lattice.pathFineSpanViews) {
    const pathFineSpans = view.pathFineSpans;
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates);
    const compatibility = resolveCompatibilityRelations(pathCandidates, null);
    const pool = buildFineSpanCandidatePool(
      compatibility.activeCandidates,
      partition.coarseSpans,
      pathFineSpans
    );
    const vote = voteUtteranceDomainFromPool(pool);
    const eligible = [];
    for (const span of pool) {
      for (const c of span.candidates) {
        const fine = (c.domains || []).filter(isVoteDomainLabel);
        const ok =
          !c.isCovered &&
          (c.source === 'domain_term' || c.source === 'passive_domain_weak') &&
          fine.length > 0;
        if (ok) {
          eligible.push({
            replacement: c.replacement,
            source: c.source,
            domains: fine,
            range: `${c.syllableStart}:${c.syllableEnd}`,
            isCompound: c.replacement === surface,
            fineSpanId: span.fineSpanId,
            domainSet: [...buildFineSpanDomainSet(span.candidates)],
          });
        }
      }
    }
    const assembly = runDomainAwareAssembly(
      compatibility.activeCandidates,
      partition.coarseSpans,
      surface,
      pathFineSpans,
      []
    );
    pathTraces.push({
      pathId: view.pathId,
      includesCompoundEdge: pathFineSpans.some((s) =>
        (s.candidates || []).some((c) => c.replacement === surface)
      ),
      domainScores: { ...vote.domainScores },
      retainedDomains: [...vote.retainedDomains],
      bucketDomains:
        vote.insufficientEvidence || !vote.retainedDomains.length
          ? [null]
          : [...vote.retainedDomains],
      bucketCount: assembly.bucketSpanSets.length,
      eligible,
    });
  }

  const orch = runSpanAssemblyV4Orchestrator({
    rawText: surface,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fw.minPrior,
    imeConfig: ime,
    dict,
    domainPriors: [],
    acousticSlices: fix.acousticSlices,
    asrSegments,
    segmentTimeOffsetsSec: [0],
    segmentCharOffsets: [0],
    asrSegmentNodeBatchIndices: [0],
  });

  // Prefer a path that includes the compound for vote attribution; else primary
  const compoundPath =
    pathTraces.find((p) => p.includesCompoundEdge && p.eligible.some((e) => e.isCompound)) ||
    pathTraces.find((p) => p.eligible.some((e) => e.isCompound)) ||
    pathTraces[0];

  return {
    pinyin_key,
    tone_pinyin_key,
    exactRecall: Boolean(exactHit),
    exactHit: exactHit
      ? {
          termId: exactHit.hotword.id,
          domains: exactHit.hotword.domains || [],
          repairTarget: exactHit.hotword.repairTarget === true,
          prior: exactHit.hotword.priorScore,
        }
      : null,
    edgeHits,
    compoundInEdges: edgeHits.length > 0,
    pathCount: pathTraces.length,
    compoundPath,
    pathTraces,
    orchDomains: [...(orch.metrics?.retainedDomains || [])],
    final: orch.kenlmSentenceCandidates?.combinations?.[0]?.text || '',
  };
}

const results = [];
for (const item of SIX) {
  const compoundDomains = domainsOf(item.surface);
  const segmentDomains = Object.fromEntries(item.segments.map((s) => [s, domainsOf(s)]));
  const withR = analyze(rt, item.surface);
  const withoutR = analyze(wrapExclude(rt, item.surface), item.surface);

  const withRet = withR.compoundPath?.retainedDomains || [];
  const withoutRet = withoutR.compoundPath?.retainedDomains || [];
  const withScores = withR.compoundPath?.domainScores || {};
  const withoutScores = withoutR.compoundPath?.domainScores || {};
  const compoundVoted = (withR.compoundPath?.eligible || []).filter((e) => e.isCompound);
  const lost = withRet.filter((d) => !withoutRet.includes(d));
  const compoundContrib = [...new Set(compoundVoted.flatMap((e) => e.domains))];
  const effectiveLost = lost.filter((d) => compoundContrib.includes(d));

  const atomsTooBroad = true; // already established in prior audit for these six
  let classification;
  let reason;
  if (
    compoundDomains.length &&
    withR.exactRecall &&
    compoundVoted.length &&
    effectiveLost.length &&
    atomsTooBroad
  ) {
    classification = 'KEEP_DOMAIN_ATOMIC';
    reason =
      'Forced activation: compound enters domain_term Vote; deleting loses fine-domain presence; atoms cannot safely carry tags';
  } else if (
    !compoundDomains.length ||
    !withR.exactRecall ||
    (!compoundVoted.length && !effectiveLost.length)
  ) {
    // Cannot produce effective domain vote under legal production recall+tone
    if (!compoundDomains.length) {
      classification = 'DELETE_DOMAIN_SAFE';
      reason = 'No compound fine domain tags; Vote does not depend on compound';
    } else if (!withR.exactRecall) {
      classification = 'DELETE_DOMAIN_SAFE';
      reason =
        'Compound has domain tags but Exact Recall fails under legal tone/pinyin — cannot produce effective domain vote in production path';
    } else if (withR.compoundInEdges && !compoundVoted.length) {
      classification = 'DELETE_DOMAIN_SAFE';
      reason =
        'Compound recalled as edge but not vote-eligible (no fine domains on hit) or not on voting path; domain presence not compound-dependent in practice';
    } else {
      classification = 'DELETE_DOMAIN_SAFE';
      reason =
        'Forced activation: no effective retainedDomains loss attributable to compound under minimal legal probe';
    }
  } else {
    classification = 'DELETE_DOMAIN_SAFE';
    reason = 'Forced activation did not prove domain-semantic necessity';
  }

  results.push({
    surface: item.surface,
    segments: item.segments,
    compoundDomains,
    segmentDomains,
    classification,
    reason,
    with: withR,
    without: withoutR,
    withRetainedDomains: withRet,
    withoutRetainedDomains: withoutRet,
    withDomainScores: withScores,
    withoutDomainScores: withoutScores,
    compoundVoteEligible: compoundVoted,
    effectiveLost,
    lostDomains: lost,
  });
}

fs.writeFileSync(path.join(outDir, 'forced_activation_six.json'), JSON.stringify({ results }, null, 2));
fs.writeFileSync(
  path.join(repo, 'docs/tone-v2/forced_activation_six_closure.csv'),
  [
    'surface,classification,compoundDomains,withRetained,withoutRetained,effectiveLost,exactRecall,compoundVoted,reason',
    ...results.map((r) =>
      [
        r.surface,
        r.classification,
        r.compoundDomains.join('|'),
        r.withRetainedDomains.join('|'),
        r.withoutRetainedDomains.join('|'),
        r.effectiveLost.join('|'),
        r.with.exactRecall,
        r.compoundVoteEligible.map((e) => e.domains.join('+')).join(';'),
        `"${r.reason.replace(/"/g, '""')}"`,
      ].join(',')
    ),
  ].join('\n') + '\n'
);

console.log(
  JSON.stringify(
    {
      KEEP_DOMAIN_ATOMIC: results.filter((r) => r.classification === 'KEEP_DOMAIN_ATOMIC').map((r) => r.surface),
      DELETE_DOMAIN_SAFE: results.filter((r) => r.classification === 'DELETE_DOMAIN_SAFE').map((r) => r.surface),
      detail: results.map((r) => ({
        s: r.surface,
        class: r.classification,
        domains: r.compoundDomains,
        exact: r.with.exactRecall,
        voted: r.compoundVoteEligible.length > 0,
        lost: r.effectiveLost,
        withRet: r.withRetainedDomains,
        withoutRet: r.withoutRetainedDomains,
      })),
    },
    null,
    2
  )
);

db.close();
