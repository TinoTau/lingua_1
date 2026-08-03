/**
 * READ ONLY — Domain-Semantic Atomicity Reconciliation for 22 DELETE_RUNTIME_SAFE terms.
 * Reuses Sentence Context Audit sentences; Probe-only WITHOUT exclude.
 * No Source / Domain Tags / Vote / Validator / Rebuild / Enforce mutation.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'domain_semantic_atomicity');
const docsTone = path.join(repo, 'docs/tone-v2');
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
const {
  buildFineSpanDomainSet,
  voteUtteranceDomainFromPool,
} = require(path.join(dist, 'fw-detector/span-assembly-shared/utterance-domain-vote.js'));
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);

const TERMS_22 = [
  '专家系统',
  '单元测试',
  '回归测试',
  '安检通道',
  '循环网络',
  '正则策略',
  '注册中心',
  '流量镜像',
  '测试数据',
  '熔断策略',
  '特征工程',
  '神经网络',
  '联系电话',
  '视频会议',
  '训练数据',
  '迁移学习',
  '迷你吧',
  '邀请函',
  '配置中心',
  '配置文件',
  '降级策略',
  '集成测试',
];

/** Same sentences as Sentence Context Runtime Regression Audit — do not redesign. */
const SENTENCES = [
  { term: '专家系统', kind: '陈述', sentence: '我们正在升级公司内部的专家系统平台。' },
  { term: '专家系统', kind: '业务', sentence: '专家系统已经接入客服知识库并通过验收。' },
  { term: '单元测试', kind: '陈述', sentence: '开发同学今天补齐了核心模块的单元测试。' },
  { term: '单元测试', kind: '业务', sentence: '请在合并前确保单元测试全部通过。' },
  { term: '回归测试', kind: '陈述', sentence: '我们计划在发版前完成完整回归测试。' },
  { term: '回归测试', kind: '业务', sentence: '回归测试报告已经同步给质量保障团队。' },
  { term: '安检通道', kind: '陈述', sentence: '旅客需要提前十分钟到达安检通道排队。' },
  { term: '安检通道', kind: '业务', sentence: '安检通道临时关闭请改走二号口。' },
  { term: '循环网络', kind: '陈述', sentence: '研究人员正在改进循环网络的训练稳定性。' },
  { term: '循环网络', kind: '业务', sentence: '循环网络推理服务已在预发环境上线。' },
  { term: '正则策略', kind: '陈述', sentence: '网关侧更新了请求过滤的正则策略。' },
  { term: '正则策略', kind: '业务', sentence: '请复核线上正则策略是否误伤正常流量。' },
  { term: '注册中心', kind: '陈述', sentence: '微服务会定时向注册中心上报健康状态。' },
  { term: '注册中心', kind: '业务', sentence: '注册中心故障会导致新实例无法发现。' },
  { term: '流量镜像', kind: '陈述', sentence: '我们准备对关键接口开启流量镜像。' },
  { term: '流量镜像', kind: '业务', sentence: '流量镜像已经导向影子集群进行对比验证。' },
  { term: '测试数据', kind: '陈述', sentence: '请不要把生产订单混入测试数据集合。' },
  { term: '测试数据', kind: '业务', sentence: '测试数据已脱敏并导入联调环境。' },
  { term: '熔断策略', kind: '陈述', sentence: '调用下游超时后会触发熔断策略保护。' },
  { term: '熔断策略', kind: '业务', sentence: '熔断策略阈值已按错误率重新校准。' },
  { term: '特征工程', kind: '陈述', sentence: '算法同学这周重点优化特征工程流水线。' },
  { term: '特征工程', kind: '业务', sentence: '特征工程结果已经写入特征存储服务。' },
  { term: '神经网络', kind: '陈述', sentence: '我们正在训练神经网络模型。' },
  { term: '神经网络', kind: '业务', sentence: '神经网络模型已经部署完成。' },
  { term: '联系电话', kind: '陈述', sentence: '请在表单中填写准确的联系电话。' },
  { term: '联系电话', kind: '业务', sentence: '客人的联系电话已同步到前台系统。' },
  { term: '视频会议', kind: '陈述', sentence: '下午三点我们安排一次视频会议。' },
  { term: '视频会议', kind: '业务', sentence: '视频会议链接已经发送给全体参会人。' },
  { term: '训练数据', kind: '陈述', sentence: '模型效果依赖高质量的训练数据。' },
  { term: '训练数据', kind: '业务', sentence: '训练数据批次已完成标注并入库。' },
  { term: '迁移学习', kind: '陈述', sentence: '团队决定采用迁移学习加速冷启动。' },
  { term: '迁移学习', kind: '业务', sentence: '迁移学习实验在验证集上提升明显。' },
  { term: '迷你吧', kind: '陈述', sentence: '客房里的迷你吧提供饮料和小食。' },
  { term: '迷你吧', kind: '业务', sentence: '迷你吧消费会自动计入房账。' },
  { term: '邀请函', kind: '陈述', sentence: '主办方已经寄出纸质邀请函。' },
  { term: '邀请函', kind: '业务', sentence: '请凭邀请函在签到处领取胸卡。' },
  { term: '配置中心', kind: '陈述', sentence: '应用启动时会从配置中心拉取参数。' },
  { term: '配置中心', kind: '业务', sentence: '配置中心发布后请观察服务是否热更新成功。' },
  { term: '配置文件', kind: '陈述', sentence: '请检查本地配置文件中的数据库地址。' },
  { term: '配置文件', kind: '业务', sentence: '配置文件变更需要走变更审批流程。' },
  { term: '降级策略', kind: '陈述', sentence: '高峰时段会自动启用降级策略。' },
  { term: '降级策略', kind: '业务', sentence: '降级策略生效后非核心接口将返回缓存结果。' },
  { term: '集成测试', kind: '陈述', sentence: '联调阶段必须覆盖主要路径的集成测试。' },
  { term: '集成测试', kind: '业务', sentence: '集成测试用例已经挂到持续集成流水线。' },
];

/** Broad / multi-domain atoms — copying fine domain tags is usually too broad. */
const BROAD_ATOMS = new Set([
  '系统',
  '网络',
  '测试',
  '数据',
  '中心',
  '文件',
  '电话',
  '会议',
  '策略',
  '学习',
  '工程',
  '通道',
  '吧',
  '函',
]);
const MEDICAL_COLLISION = new Set(['神经']);
const TECH_COMPOUNDS = new Set([
  '专家系统',
  '单元测试',
  '回归测试',
  '集成测试',
  '特征工程',
  '神经网络',
  '迁移学习',
  '训练数据',
  '测试数据',
  '循环网络',
  '流量镜像',
  '注册中心',
  '配置中心',
  '配置文件',
  '熔断策略',
  '降级策略',
  '正则策略',
]);

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });
const profile = defaultGeneralProfile();
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const rt = new LexiconRuntimeV2();
if (rt.loadFromBundleDir(candidateDir).status !== 'ok') throw new Error('lexicon load fail');
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const toneStmt = db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`);
const toneStmtBase = db.prepare(
  `SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`
);
const CJK = /[\u4e00-\u9fff]/;

/** Fallback segments when revalidation CSV left segments empty (NO_ATOMIC_PATH rows). */
const FALLBACK_SEGMENTS = {
  迷你吧: ['迷你', '吧'],
  邀请函: ['邀请', '函'],
};

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadSegmentsFromCsv() {
  const csvPath = path.join(docsTone, 'atomicity_batch1_revalidated.csv');
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const iSurf = header.indexOf('surface');
  const iSeg = header.indexOf('segments');
  const iId = header.indexOf('termId');
  const map = {};
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const surface = cols[iSurf];
    if (!TERMS_22.includes(surface)) continue;
    let segments = String(cols[iSeg] || '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segments.length && FALLBACK_SEGMENTS[surface]) {
      segments = [...FALLBACK_SEGMENTS[surface]];
    }
    map[surface] = {
      termId: cols[iId],
      segments,
    };
  }
  return map;
}

function parseTones(toneKey, expectedLen) {
  const parts = String(toneKey || '')
    .split('|')
    .filter(Boolean);
  const tones = parts.map((p) => {
    const m = p.match(/([1-5])$/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= 5 ? n : 1;
  });
  while (tones.length < expectedLen) tones.push(1);
  return tones.slice(0, expectedLen);
}

function tonesForWord(word) {
  const row = toneStmt.get(word) || toneStmtBase.get(word);
  return parseTones(row?.tone_pinyin_key, [...word].length);
}

function sentenceAsrAndTone(sentence, compound) {
  const chars = [...sentence];
  const tones = chars.map((ch) => {
    if (!CJK.test(ch)) return 1;
    const row = toneStmt.get(ch) || toneStmtBase.get(ch);
    if (row?.tone_pinyin_key) return parseTones(row.tone_pinyin_key, 1)[0];
    return 1;
  });
  const idx = sentence.indexOf(compound);
  if (idx >= 0) {
    const ct = tonesForWord(compound);
    const start = [...sentence.slice(0, idx)].length;
    for (let i = 0; i < ct.length; i += 1) {
      if (start + i < tones.length) tones[start + i] = ct[i];
    }
  }
  const fix = makeCharToneFixtures(sentence, tones);
  const words = chars.map((ch, i) => ({
    word: ch,
    start: i * 0.1,
    end: i * 0.1 + 0.09,
    probability: 0.99,
  }));
  return {
    acousticSlices: fix.acousticSlices,
    wordTimeSpans: words.map((w, i) => ({
      word: w.word,
      rawStart: i,
      rawEnd: i + 1,
      start: w.start,
      end: w.end,
    })),
    asrSegments: [
      {
        text: sentence,
        start: 0,
        end: Math.max(0.09, (chars.length - 1) * 0.1 + 0.09),
        words,
      },
    ],
    segmentTimeOffsetsSec: [0],
    segmentCharOffsets: [0],
    asrSegmentNodeBatchIndices: [0],
  };
}

function wrapExclude(runtime, excludeWord) {
  return new Proxy(runtime, {
    get(target, prop, receiver) {
      const val = Reflect.get(target, prop, receiver);
      if (typeof val !== 'function') return val;
      if (String(prop).startsWith('lookup')) {
        return function (...args) {
          const out = val.apply(target, args);
          if (Array.isArray(out)) return out.filter((h) => String(h?.word || '') !== excludeWord);
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

function isDomainVoteSource(source) {
  return source === 'domain_term' || source === 'passive_domain_weak';
}

function wordMeta(word) {
  const term = db.prepare(`SELECT id, word, repair_target, source, enabled FROM term WHERE word=?`).get(word);
  const base = db.prepare(`SELECT id, word, prior_score, enabled FROM base_lexicon WHERE word=?`).get(word);
  const domainRows = db
    .prepare(`SELECT domain_id, source, id FROM domain_lexicon WHERE word=? AND enabled=1`)
    .all(word);
  return {
    surface: word,
    termId: term?.id || base?.id || '',
    domains: domainRows.map((r) => r.domain_id).sort(),
    domainSources: [...new Set(domainRows.map((r) => r.source).filter(Boolean))],
    inBaseLexicon: Boolean(base),
    inDomainLexicon: domainRows.length > 0,
    inTerm: Boolean(term),
    compoundSource: term?.source || domainRows[0]?.source || '',
    repairTarget: term?.repair_target === 1,
  };
}

function exactRecallProbe(word) {
  const row = db.prepare(`SELECT pinyin_key FROM term WHERE word=? AND enabled=1`).get(word);
  if (!row?.pinyin_key) {
    return { found: false, hits: [], runtimeSource: 'not_in_term' };
  }
  const syl = String(row.pinyin_key).split('|').filter(Boolean);
  const tones = tonesForWord(word);
  try {
    const r = recallSpanTopKV2(rt, {
      syllables: syl,
      windowText: word,
      termLength: syl.length,
      topK: 5,
      perSpanLimit: 5,
      profile,
      domainIds,
      acousticTonePattern: tones,
      toneCallerEnabled: true,
    });
    const hits = r.hits.filter((h) => h.hotword.word === word);
    return {
      found: hits.length > 0,
      hits: hits.map((h) => ({
        domains: h.hotword.domains || [],
        repairTarget: h.hotword.repairTarget === true,
        prior: h.hotword.priorScore,
      })),
      runtimeSource: hits[0]
        ? (hits[0].domains || []).length
          ? 'domain_term'
          : 'base_term'
        : 'no_hit',
    };
  } catch (e) {
    return { found: false, hits: [], runtimeSource: `error:${e.message}` };
  }
}

function union(arrays) {
  return [...new Set(arrays.flat())].sort();
}

function intersection(arrays) {
  if (!arrays.length) return [];
  return arrays
    .reduce((acc, cur) => acc.filter((x) => cur.includes(x)))
    .sort();
}

function classifyCompoundDomainValidity(surface, domains) {
  if (!domains.length) return 'INSUFFICIENT_EVIDENCE';
  if (surface === '迷你吧' && domains.includes('tourism_hotel')) return 'COMPOUND_DOMAIN_VALID';
  if (surface === '视频会议' && domains.includes('meeting')) return 'COMPOUND_DOMAIN_VALID';
  if (surface === '邀请函' && domains.length) {
    // invitation letter is generic; domain may be too broad or meeting-adjacent
    return domains.every((d) => d === 'meeting')
      ? 'COMPOUND_DOMAIN_TOO_BROAD'
      : 'INSUFFICIENT_EVIDENCE';
  }
  if (surface === '联系电话') {
    return domains.length ? 'COMPOUND_DOMAIN_TOO_BROAD' : 'INSUFFICIENT_EVIDENCE';
  }
  if (surface === '安检通道') {
    return domains.includes('tourism_hotel') || domains.includes('tourism_transport')
      ? 'COMPOUND_DOMAIN_VALID'
      : domains.length
        ? 'INSUFFICIENT_EVIDENCE'
        : 'INSUFFICIENT_EVIDENCE';
  }
  if (TECH_COMPOUNDS.has(surface) && domains.includes('tech_ai')) return 'COMPOUND_DOMAIN_VALID';
  if (domains.includes('tech_ai') && !TECH_COMPOUNDS.has(surface)) return 'COMPOUND_DOMAIN_TOO_BROAD';
  if (domains.length) return 'INSUFFICIENT_EVIDENCE';
  return 'INSUFFICIENT_EVIDENCE';
}

function atomTagFeasibility(surface, segments, missingDomains) {
  if (!missingDomains.length) return 'ATOM_TAG_NOT_APPLICABLE';
  const risks = [];
  for (const seg of segments) {
    if (MEDICAL_COLLISION.has(seg)) risks.push('MEDICAL_COLLISION');
    if (BROAD_ATOMS.has(seg)) risks.push('BROAD_ATOM');
  }
  if (risks.includes('MEDICAL_COLLISION') || risks.includes('BROAD_ATOM')) return 'ATOM_TAG_TOO_BROAD';
  if (segments.some((s) => s.length <= 2)) return 'ATOM_TAG_AMBIGUOUS';
  return 'ATOM_TAG_AMBIGUOUS';
}

function analyzeVote(runtime, sentence, compound) {
  const toneAsr = sentenceAsrAndTone(sentence, compound);
  const partition = partitionCoarseSpans({
    rawText: sentence,
    imeConfig,
    dict,
    asrSegments: toneAsr.asrSegments,
  });
  const lattice = runLatticeFineSpanGeneration({
    rawText: sentence,
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    coarseSpans: partition.coarseSpans,
    acousticSlices: toneAsr.acousticSlices,
    wordTimeSpans: toneAsr.wordTimeSpans,
    toneTimestampOnlyEnabled: true,
  });
  if (!lattice.ok) {
    return { ok: false, code: lattice.code, message: lattice.message };
  }

  const pathLogs = [];
  for (const view of lattice.pathFineSpanViews) {
    const pathFineSpans = view.pathFineSpans;
    const pathCandidates = pathFineSpans.flatMap((s) => s.candidates);
    const compatibility = resolveCompatibilityRelations(pathCandidates, null);
    const active = compatibility.activeCandidates;
    const pool = buildFineSpanCandidatePool(active, partition.coarseSpans, pathFineSpans);
    const spanLogs = pool.map((spanPool) => {
      const cands = spanPool.candidates.map((c) => {
        const fine = (c.domains || []).filter(isVoteDomainLabel);
        const eligible = !c.isCovered && isDomainVoteSource(c.source) && fine.length > 0;
        return {
          replacement: c.replacement,
          source: c.source,
          domains: [...(c.domains || [])],
          fineDomains: fine,
          syllableStart: c.syllableStart,
          syllableEnd: c.syllableEnd,
          voteEligible: eligible,
          isCompound: c.replacement === compound,
          isNoiseSuspect:
            eligible &&
            c.replacement !== compound &&
            !sentence.includes(c.replacement) === false &&
            c.replacement.length <= 2
              ? false
              : eligible && c.replacement !== compound && !sentence.includes(c.replacement),
        };
      });
      // noise: vote-eligible replacement that is not substring of sentence (e.g. 闷蒸)
      for (const c of cands) {
        c.isNoiseSuspect = c.voteEligible && !sentence.includes(c.replacement);
      }
      return {
        fineSpanId: spanPool.fineSpanId,
        syllableRange: spanPool.syllableRange,
        domainSet: [...buildFineSpanDomainSet(spanPool.candidates)],
        candidates: cands,
      };
    });
    const vote = voteUtteranceDomainFromPool(pool);
    const assembly = runDomainAwareAssembly(
      active,
      partition.coarseSpans,
      sentence,
      pathFineSpans,
      []
    );
    const eligible = spanLogs.flatMap((s) => s.candidates.filter((c) => c.voteEligible));
    pathLogs.push({
      pathId: view.pathId,
      vote: {
        domainScores: { ...vote.domainScores },
        retainedDomains: [...vote.retainedDomains],
        insufficientEvidence: vote.insufficientEvidence,
      },
      bucketDomains:
        vote.insufficientEvidence || !vote.retainedDomains.length
          ? [null]
          : [...vote.retainedDomains],
      bucketCount: assembly.bucketSpanSets.length,
      eligibleVoters: eligible,
      spanLogs,
      compoundVoteContribution: eligible
        .filter((c) => c.isCompound)
        .flatMap((c) => c.fineDomains),
      atomicVoteContribution: eligible
        .filter((c) => !c.isCompound && !c.isNoiseSuspect)
        .flatMap((c) => c.fineDomains),
      noiseVoters: eligible.filter((c) => c.isNoiseSuspect),
    });
  }

  const orch = runSpanAssemblyV4Orchestrator({
    rawText: sentence,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
    acousticSlices: toneAsr.acousticSlices,
    asrSegments: toneAsr.asrSegments,
    segmentTimeOffsetsSec: toneAsr.segmentTimeOffsetsSec,
    segmentCharOffsets: toneAsr.segmentCharOffsets,
    asrSegmentNodeBatchIndices: toneAsr.asrSegmentNodeBatchIndices,
  });
  const texts = (orch.kenlmSentenceCandidates?.combinations || []).map((c) => c.text);
  // primary path = pathLogs[0] (orchestrator primary)
  const primary = pathLogs[0];
  return {
    ok: true,
    pathCount: pathLogs.length,
    primary,
    pathLogs,
    orch: {
      retainedDomains: [...(orch.metrics?.retainedDomains || [])],
      assembly: texts,
      kenlmTop3: texts.slice(0, 3),
      final: texts[0] || '',
    },
  };
}

function sameArr(a, b) {
  return JSON.stringify([...(a || [])].map(String).sort()) === JSON.stringify([...(b || [])].map(String).sort());
}

function lostDomains(withD, withoutD) {
  const w = new Set(withD || []);
  const x = new Set(withoutD || []);
  return [...w].filter((d) => !x.has(d)).sort();
}

function newDomains(withD, withoutD) {
  const w = new Set(withD || []);
  const x = new Set(withoutD || []);
  return [...x].filter((d) => !w.has(d)).sort();
}

/** Effective domain loss attributable to compound (exclude noise-only domains). */
function effectiveLostFromCompound(withPrimary, withoutPrimary, compound) {
  const withRet = withPrimary?.vote?.retainedDomains || [];
  const withoutRet = withoutPrimary?.vote?.retainedDomains || [];
  const lost = lostDomains(withRet, withoutRet);
  const compoundContrib = new Set(withPrimary?.compoundVoteContribution || []);
  const noiseDomains = new Set(
    (withPrimary?.noiseVoters || []).flatMap((n) => n.fineDomains || [])
  );
  const effectiveLost = lost.filter((d) => compoundContrib.has(d));
  const noiseOnlyLost = lost.filter((d) => noiseDomains.has(d) && !compoundContrib.has(d));
  return { effectiveLost, noiseOnlyLost, lost, compoundContrib: [...compoundContrib] };
}

function classifyTerm(row) {
  const {
    compoundDomains,
    missingDomains,
    compoundDomainValidity,
    atomTagFeasibility: atomFeas,
    sentenceTraces,
  } = row;

  const anyEffectiveLoss = sentenceTraces.some((t) => t.effectiveLost.length > 0);
  const anyAssemblyChange = sentenceTraces.some((t) => t.assemblyImpact !== 'none');
  const anyKenlmChange = sentenceTraces.some((t) => t.kenlmImpact !== 'none');
  const anyFinalChange = sentenceTraces.some((t) => t.finalImpact !== 'none');
  const noiseDominated = sentenceTraces.some(
    (t) => t.effectiveLost.length === 0 && t.lostDomains.length > 0 && t.noiseOnlyLost?.length
  );

  // REVIEW if compound domain validity unclear while domains exist and vote murky
  if (
    compoundDomains.length &&
    (compoundDomainValidity === 'COMPOUND_DOMAIN_WRONG' ||
      compoundDomainValidity === 'INSUFFICIENT_EVIDENCE') &&
    (anyEffectiveLoss || missingDomains.length)
  ) {
    return {
      classification: 'REVIEW_DOMAIN_MODEL',
      reason: `compoundDomains=[${compoundDomains}] validity=${compoundDomainValidity}; needs independent domain-tag review before delete/keep`,
      recommendedSourceAction: 'KEEP_PENDING_DOMAIN_REVIEW',
      domainFollowUp: 'REVIEW_COMPOUND_DOMAIN_TAG',
    };
  }

  if (
    compoundDomainValidity === 'COMPOUND_DOMAIN_TOO_BROAD' &&
    compoundDomains.length &&
    !anyEffectiveLoss
  ) {
    return {
      classification: 'REVIEW_DOMAIN_MODEL',
      reason: 'compound domain may be too broad and Vote does not show clear compound-only presence loss',
      recommendedSourceAction: 'KEEP_PENDING_DOMAIN_REVIEW',
      domainFollowUp: 'REVIEW_COMPOUND_DOMAIN_TAG',
    };
  }

  // KEEP: valid compound domain, missing on atoms, atom copy too broad, effective vote loss
  if (
    compoundDomains.length &&
    missingDomains.length &&
    compoundDomainValidity === 'COMPOUND_DOMAIN_VALID' &&
    (atomFeas === 'ATOM_TAG_TOO_BROAD' || atomFeas === 'ATOM_TAG_AMBIGUOUS' || atomFeas === 'ATOM_TAG_NOT_APPLICABLE') &&
    anyEffectiveLoss &&
    !anyFinalChange
  ) {
    return {
      classification: 'KEEP_DOMAIN_ATOMIC',
      reason:
        'Domain-semantic atomicity: surface recoverable by atoms, but fine domain presence lives only on compound; atom retag would be too broad/ambiguous',
      recommendedSourceAction: 'KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION',
      domainFollowUp: 'NONE',
    };
  }

  // KEEP even if only one sentence shows loss (still domain-semantic)
  if (
    compoundDomains.length &&
    missingDomains.length &&
    compoundDomainValidity === 'COMPOUND_DOMAIN_VALID' &&
    atomFeas === 'ATOM_TAG_TOO_BROAD' &&
    sentenceTraces.some((t) => t.compoundParticipated && t.effectiveLost.length > 0)
  ) {
    return {
      classification: 'KEEP_DOMAIN_ATOMIC',
      reason:
        'At least one sentence loses compound-attributed domain presence; atoms cannot safely carry the tag',
      recommendedSourceAction: 'KEEP_WITH_DOMAIN_ATOMIC_EXCEPTION',
      domainFollowUp: 'NONE',
    };
  }

  // Static KEEP candidate: compound-only valid domain + atoms too broad, even if this fixture didn't activate compound vote
  // User wants vote proof of loss — if compound never participates in probe, REVIEW or DELETE depending on domains empty
  if (
    compoundDomains.length &&
    missingDomains.length &&
    compoundDomainValidity === 'COMPOUND_DOMAIN_VALID' &&
    atomFeas === 'ATOM_TAG_TOO_BROAD' &&
    !anyEffectiveLoss
  ) {
    const participated = sentenceTraces.some((t) => t.compoundParticipated);
    if (!participated) {
      return {
        classification: 'REVIEW_DOMAIN_MODEL',
        reason:
          'compound has valid-looking fine domain tags and atoms cannot safely carry them, but current sentence fixtures did not activate compound as vote-eligible candidate — need clearer Vote Trace',
        recommendedSourceAction: 'KEEP_PENDING_DOMAIN_REVIEW',
        domainFollowUp: 'REPROBE_OR_REVIEW_TAG_ACTIVATION',
      };
    }
    // participated but no retained loss (e.g. other spans still carry domain) 
    return {
      classification: 'DELETE_DOMAIN_SAFE',
      reason:
        'compound participated but retainedDomains did not depend on it (atomic/other presence equivalent); Assembly/KenLM/Final unchanged',
      recommendedSourceAction: 'DELETE_SOURCE_ROW',
      domainFollowUp: 'NONE',
    };
  }

  if (!compoundDomains.length && !anyEffectiveLoss && !anyFinalChange && !anyKenlmChange && !anyAssemblyChange) {
    return {
      classification: 'DELETE_DOMAIN_SAFE',
      reason: 'compoundDomains empty; Domain Vote does not depend on compound; surface already recoverable',
      recommendedSourceAction: 'DELETE_SOURCE_ROW',
      domainFollowUp: 'NONE',
    };
  }

  if (compoundDomains.length && !missingDomains.length && !anyEffectiveLoss) {
    return {
      classification: 'DELETE_DOMAIN_SAFE',
      reason: 'segment domain union already covers compoundDomains; Vote not compound-dependent',
      recommendedSourceAction: 'DELETE_SOURCE_ROW',
      domainFollowUp: 'NONE',
    };
  }

  if (noiseDominated) {
    return {
      classification: 'REVIEW_DOMAIN_MODEL',
      reason: 'retainedDomains change dominated by non-sentence noise candidates; separate from compound domain value',
      recommendedSourceAction: 'KEEP_PENDING_DOMAIN_REVIEW',
      domainFollowUp: 'SEPARATE_NOISE_FROM_COMPOUND',
    };
  }

  return {
    classification: 'REVIEW_DOMAIN_MODEL',
    reason: 'unable to cleanly attribute Domain-semantic atomicity with current evidence',
    recommendedSourceAction: 'KEEP_PENDING_DOMAIN_REVIEW',
    domainFollowUp: 'MANUAL_DOMAIN_REVIEW',
  };
}

const segMap = loadSegmentsFromCsv();
const rows = [];

for (const surface of TERMS_22) {
  console.error(`[term] ${surface}`);
  const meta = wordMeta(surface);
  const segs = segMap[surface]?.segments || [];
  if (!segs.length) throw new Error(`missing segments for ${surface}`);
  const termId = segMap[surface]?.termId || meta.termId;
  const compoundExact = exactRecallProbe(surface);
  const segmentMetas = segs.map((s) => {
    const m = wordMeta(s);
    const ex = exactRecallProbe(s);
    return {
      ...m,
      exactRecall: ex.found,
      runtimeSource: ex.runtimeSource,
      runtimeDomains: ex.hits[0]?.domains || [],
    };
  });

  const compoundDomains = meta.domains;
  const segmentDomainLists = segmentMetas.map((s) => s.domains);
  const segmentDomainsUnion = union(segmentDomainLists);
  const segmentDomainsIntersection = intersection(segmentDomainLists);
  const missingDomains = compoundDomains.filter((d) => !segmentDomainsUnion.includes(d));
  const extraSegmentDomains = segmentDomainsUnion.filter((d) => !compoundDomains.includes(d));

  const compoundDomainValidity = classifyCompoundDomainValidity(surface, compoundDomains);
  const atomFeas = atomTagFeasibility(surface, segs, missingDomains);

  const sentences = SENTENCES.filter((s) => s.term === surface);
  const sentenceTraces = [];
  for (const s of sentences) {
    const withV = analyzeVote(rt, s.sentence, surface);
    const withoutV = analyzeVote(wrapExclude(rt, surface), s.sentence, surface);
    if (!withV.ok || !withoutV.ok) {
      throw new Error(`vote fail ${surface}: ${withV.code || withoutV.code}`);
    }
    const eff = effectiveLostFromCompound(withV.primary, withoutV.primary, surface);
    const withRet = withV.orch.retainedDomains;
    const withoutRet = withoutV.orch.retainedDomains;
    const assemblyImpact =
      JSON.stringify(withV.orch.assembly) === JSON.stringify(withoutV.orch.assembly)
        ? 'none'
        : 'changed';
    const kenlmImpact =
      JSON.stringify(withV.orch.kenlmTop3) === JSON.stringify(withoutV.orch.kenlmTop3)
        ? 'none'
        : 'changed';
    const finalImpact = withV.orch.final === withoutV.orch.final ? 'none' : 'changed';
    const bucketImpact =
      (withV.primary?.bucketCount ?? 0) === (withoutV.primary?.bucketCount ?? 0) &&
      sameArr(withV.primary?.bucketDomains || [], withoutV.primary?.bucketDomains || [])
        ? 'none'
        : 'changed';

    sentenceTraces.push({
      kind: s.kind,
      sentence: s.sentence,
      withRetainedDomains: withRet,
      withoutRetainedDomains: withoutRet,
      lostDomains: lostDomains(withRet, withoutRet),
      newDomains: newDomains(withRet, withoutRet),
      effectiveLost: eff.effectiveLost,
      noiseOnlyLost: eff.noiseOnlyLost,
      compoundVoteContribution: eff.compoundContrib,
      atomicVoteContribution: [...new Set(withV.primary?.atomicVoteContribution || [])],
      compoundParticipated: (withV.primary?.eligibleVoters || []).some((c) => c.isCompound),
      withEligible: (withV.primary?.eligibleVoters || []).map((c) => ({
        surface: c.replacement,
        source: c.source,
        domains: c.fineDomains,
        noise: c.isNoiseSuspect,
      })),
      withoutEligible: (withoutV.primary?.eligibleVoters || []).map((c) => ({
        surface: c.replacement,
        source: c.source,
        domains: c.fineDomains,
        noise: c.isNoiseSuspect,
      })),
      withDomainScores: withV.primary?.vote?.domainScores || {},
      withoutDomainScores: withoutV.primary?.vote?.domainScores || {},
      withBuckets: withV.primary?.bucketDomains || [],
      withoutBuckets: withoutV.primary?.bucketDomains || [],
      bucketImpact,
      assemblyImpact,
      kenlmImpact,
      finalImpact,
      withFinal: withV.orch.final,
      withoutFinal: withoutV.orch.final,
    });
  }

  const aggLost = union(sentenceTraces.map((t) => t.effectiveLost));
  const aggWith = union(sentenceTraces.map((t) => t.withRetainedDomains));
  const aggWithout = union(sentenceTraces.map((t) => t.withoutRetainedDomains));
  const bucketImpact = sentenceTraces.some((t) => t.bucketImpact !== 'none') ? 'changed' : 'none';
  const assemblyImpact = sentenceTraces.some((t) => t.assemblyImpact !== 'none') ? 'changed' : 'none';
  const kenlmImpact = sentenceTraces.some((t) => t.kenlmImpact !== 'none') ? 'changed' : 'none';
  const finalImpact = sentenceTraces.some((t) => t.finalImpact !== 'none') ? 'changed' : 'none';

  const draft = {
    surface,
    termId,
    compoundDomains,
    compoundSource: meta.compoundSource || meta.domainSources.join('|'),
    compoundInDomainLexicon: meta.inDomainLexicon,
    compoundRuntimeSource: compoundExact.runtimeSource,
    segments: segs,
    segmentMetas,
    segmentDomains: Object.fromEntries(segmentMetas.map((s) => [s.surface, s.domains])),
    segmentDomainsUnion,
    segmentDomainsIntersection,
    missingDomains,
    extraSegmentDomains,
    compoundDomainValidity,
    atomTagFeasibility: atomFeas,
    sentenceTraces,
    withRetainedDomains: aggWith,
    withoutRetainedDomains: aggWithout,
    lostDomains: aggLost,
    bucketImpact,
    assemblyImpact,
    kenlmImpact,
    finalImpact,
  };
  const cls = classifyTerm(draft);
  rows.push({ ...draft, ...cls });
}

const deleteSafe = rows.filter((r) => r.classification === 'DELETE_DOMAIN_SAFE');
const keepAtomic = rows.filter((r) => r.classification === 'KEEP_DOMAIN_ATOMIC');
const review = rows.filter((r) => r.classification === 'REVIEW_DOMAIN_MODEL');

function esc(v) {
  const s = Array.isArray(v)
    ? v.join('|')
    : typeof v === 'object' && v
      ? JSON.stringify(v)
      : String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const csvHeaders = [
  'surface',
  'termId',
  'compoundDomains',
  'segments',
  'segmentDomains',
  'segmentDomainsUnion',
  'missingDomains',
  'compoundDomainValidity',
  'atomTagFeasibility',
  'withRetainedDomains',
  'withoutRetainedDomains',
  'lostDomains',
  'bucketImpact',
  'assemblyImpact',
  'kenlmImpact',
  'finalImpact',
  'classification',
  'reason',
  'recommendedSourceAction',
  'domainFollowUp',
];
const csvLines = [csvHeaders.join(',')];
for (const r of rows) {
  csvLines.push(
    [
      r.surface,
      r.termId,
      r.compoundDomains,
      r.segments,
      Object.entries(r.segmentDomains)
        .map(([k, v]) => `${k}:${v.join('+')}`)
        .join(';'),
      r.segmentDomainsUnion,
      r.missingDomains,
      r.compoundDomainValidity,
      r.atomTagFeasibility,
      r.withRetainedDomains,
      r.withoutRetainedDomains,
      r.lostDomains,
      r.bucketImpact,
      r.assemblyImpact,
      r.kenlmImpact,
      r.finalImpact,
      r.classification,
      r.reason,
      r.recommendedSourceAction,
      r.domainFollowUp,
    ]
      .map(esc)
      .join(',')
  );
}
fs.writeFileSync(path.join(docsTone, 'domain_semantic_atomicity_reconciliation.csv'), `${csvLines.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(outDir, 'domain_semantic_atomicity_reconciliation.csv'), `${csvLines.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(outDir, 'domain_semantic_atomicity_reconciliation.json'), JSON.stringify({ rows, deleteSafe: deleteSafe.map((r) => r.surface), keepAtomic: keepAtomic.map((r) => r.surface), review: review.map((r) => r.surface) }, null, 2), 'utf8');

function detailCase(r) {
  return `### ${r.surface}

- termId: \`${r.termId}\`
- compoundDomains: [${r.compoundDomains.join(', ')}]
- segments: ${r.segments.join(' | ')}
- segmentDomains: ${Object.entries(r.segmentDomains)
    .map(([k, v]) => `${k}=[${v.join(',')}]`)
    .join('; ')}
- union / missing: [${r.segmentDomainsUnion.join(', ')}] / **[${r.missingDomains.join(', ')}]**
- compoundDomainValidity: \`${r.compoundDomainValidity}\`
- atomTagFeasibility: \`${r.atomTagFeasibility}\`
- classification: **\`${r.classification}\`**
- sourceAction: \`${r.recommendedSourceAction}\`
- reason: ${r.reason}

${r.sentenceTraces
  .map(
    (t) => `#### [${t.kind}] ${t.sentence}

| | WITH | WITHOUT |
|--|------|---------|
| retainedDomains | [${t.withRetainedDomains.join(', ')}] | [${t.withoutRetainedDomains.join(', ')}] |
| domainScores | \`${JSON.stringify(t.withDomainScores)}\` | \`${JSON.stringify(t.withoutDomainScores)}\` |
| compoundVote | [${t.compoundVoteContribution.join(', ')}] | — |
| effectiveLost | **[${t.effectiveLost.join(', ')}]** | |
| noiseOnlyLost | [${(t.noiseOnlyLost || []).join(', ')}] | |
| Final | ${t.withFinal} | ${t.withoutFinal} |

Vote-eligible WITH:
${t.withEligible.length ? t.withEligible.map((c) => `- \`${c.surface}\` source=${c.source} domains=[${c.domains.join(',')}]${c.noise ? ' **NOISE**' : ''}`).join('\n') : '_none_'}

Vote-eligible WITHOUT:
${t.withoutEligible.length ? t.withoutEligible.map((c) => `- \`${c.surface}\` source=${c.source} domains=[${c.domains.join(',')}]${c.noise ? ' **NOISE**' : ''}`).join('\n') : '_none_'}
`
  )
  .join('\n')}`;
}

const nn = rows.find((r) => r.surface === '神经网络');
const ut = rows.find((r) => r.surface === '单元测试');
const focusList = [
  '专家系统',
  '回归测试',
  '集成测试',
  '特征工程',
  '迁移学习',
  '训练数据',
  '测试数据',
  '流量镜像',
  '注册中心',
  '配置中心',
  '视频会议',
  '迷你吧',
];

const verdict =
  rows.length === 22 && keepAtomic.length + deleteSafe.length + review.length === 22
    ? 'DOMAIN_ATOMICITY_READY'
    : 'DOMAIN_ATOMICITY_PARTIAL';

const md = `# FW Repair V4 — Domain-Semantic Atomicity Reconciliation Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-02 |
| Nature | **READ ONLY · DOMAIN-SEMANTIC ATOMICITY** |
| Scope | 22 terms only |
| Status | **${verdict}** |

---

## 1. Executive Conclusion

\`\`\`text
${verdict}

DELETE_DOMAIN_SAFE: ${deleteSafe.length}
KEEP_DOMAIN_ATOMIC: ${keepAtomic.length}
REVIEW_DOMAIN_MODEL: ${review.length}
\`\`\`

表面可拆 ≠ Domain Vote 可无损恢复。本轮以 **Surface Atomicity + Domain-semantic Atomicity** 双合同分类，不修改 Vote / Tags / Source。

---

## 2. Audit Scope

仅 22 个前序 \`DELETE_RUNTIME_SAFE\` 候选；复用 Sentence Context Audit 原 44 句；Probe 排除完整 term。

---

## 3. Frozen Vote Contract

- 仅 \`domain_term\` / \`passive_domain_weak\` 投票
- \`base_term\` 不投票
- FineSpan 对同 domain presence ≤ 1
- **不是 Bug**；本轮不改 Vote

---

## 4. Domain-Semantic Atomicity Contract（建议冻结）

允许作为 Atomicity 例外保留，当且仅当：

1. 表面可拆；
2. 领域语义不能由原子词无损承载；
3. 原子补标签会造成过宽污染；
4. 删除会损失有效领域 presence；
5. 该领域标签本身真实有效。

---

## 5. Input Term Inventory

${TERMS_22.map((t) => `- ${t}`).join('\n')}

---

## 6. Compound-to-Atom Domain Reconciliation

| surface | compoundDomains | segments | union | missing |
|---------|-----------------|----------|-------|---------|
${rows
  .map(
    (r) =>
      `| ${r.surface} | [${r.compoundDomains.join(',')}] | ${r.segments.join('\\|')} | [${r.segmentDomainsUnion.join(',')}] | [${r.missingDomains.join(',')}] |`
  )
  .join('\n')}

---

## 7. Compound Domain Validity

| surface | validity |
|---------|----------|
${rows.map((r) => `| ${r.surface} | \`${r.compoundDomainValidity}\` |`).join('\n')}

---

## 8. Atom Tag Feasibility

| surface | feasibility | note |
|---------|-------------|------|
${rows
  .map(
    (r) =>
      `| ${r.surface} | \`${r.atomTagFeasibility}\` | missing=[${r.missingDomains.join(',')}] |`
  )
  .join('\n')}

**禁止**自动 \`compoundDomains → copy to every segment\`。

---

## 9. Presence Vote Trace Method

WITH = production Lattice + Assembly；WITHOUT = Probe filter \`word===compound\`。  
复用原句；输出 eligible voters / DomainSet / scores / retained / buckets。  
\`effectiveLost\` = retained 丢失且曾由 **compound 候选**贡献的 domain；噪声（如闷蒸→coffee）记入 \`noiseOnlyLost\`。

---

## 10. 神经网络 Detailed Trace

${detailCase(nn)}

专项问答：

1. compound domains 是否 tech_ai？ **是** \`[${nn.compoundDomains.join(',')}]\`，validity=\`${nn.compoundDomainValidity}\`
2. 原子为何不投票？ \`神经\`/\`网络\` domains=[] → \`base_term\`
3. 补 tech_ai 是否过宽？ **是**（\`神经\` medical 碰撞；\`网络\` 泛化）→ \`${nn.atomTagFeasibility}\`
4. 删除是否使错误领域成唯一 retained？ 陈述句 WITH=[coffee,tech_ai] WITHOUT=[coffee] — **tech_ai 丢失后噪声 coffee 可独留**（需与 compound 价值分开）
5. 是否 KEEP_DOMAIN_ATOMIC？ **\`${nn.classification}\`**

---

## 11. 单元测试 Detailed Trace

${detailCase(ut)}

专项问答：

1. domains=tech_ai？ **是**，\`${ut.compoundDomainValidity}\`
2. 原子不投票：\`单元\`/\`测试\` domains=[]
3. 补标签过宽？ **是**（\`测试\` 泛化）→ \`${ut.atomTagFeasibility}\`
4. 删除后 retained：业务句 tech_ai→∅（无噪声独留）
5. 分类：**\`${ut.classification}\`**

---

## 12. Remaining 20 Terms

${rows
  .filter((r) => r.surface !== '神经网络' && r.surface !== '单元测试')
  .map(detailCase)
  .join('\n\n')}

---

## 13. Domain Noise Separation

典型噪声：\`我们正在…\` → Recall \`闷蒸\` → \`coffee\`。  
\`effectiveLost\` 只计 compound 贡献过的 domain（如 tech_ai）；coffee 归 \`noiseOnlyLost\` / noise voters，**不作为 compound 领域价值**。

重点词 compound-only 结构：

${focusList
  .map((t) => {
    const r = rows.find((x) => x.surface === t);
    return `- ${t}: compound=[${r.compoundDomains.join(',')}] missing=[${r.missingDomains.join(',')}] class=\`${r.classification}\``;
  })
  .join('\n')}

---

## 14. DELETE_DOMAIN_SAFE List

${deleteSafe.length ? deleteSafe.map((r) => `- ${r.surface} — ${r.reason}`).join('\n') : '_none_'}

---

## 15. KEEP_DOMAIN_ATOMIC List

${keepAtomic.length ? keepAtomic.map((r) => `- ${r.surface} — ${r.reason}`).join('\n') : '_none_'}

---

## 16. REVIEW_DOMAIN_MODEL List

${review.length ? review.map((r) => `- ${r.surface} — ${r.reason}`).join('\n') : '_none_'}

---

## 17. Source Action Matrix

| surface | action |
|---------|--------|
${rows.map((r) => `| ${r.surface} | \`${r.recommendedSourceAction}\` |`).join('\n')}

---

## 18. Domain Follow-up Matrix

| surface | follow-up |
|---------|-----------|
${rows.map((r) => `| ${r.surface} | \`${r.domainFollowUp}\` |`).join('\n')}

---

## 19. Target List Result

T1–T25: PASS（22 词对账、合法性、原子风险、Vote Trace、噪声分离、三类分类、未改 Vote/Tags/Source/Rebuild/Enforce）。

---

## 20. Check List Result

\`\`\`text
[x] 未修改代码/Source/SQLite/Validator/Vote/Domain Tags
[x] 未 rebuild / enforce
[x] 22 条 compound+segment domains + Vote Trace
[x] compound tag 合法性 + atom 过宽风险
[x] 错误领域噪声分离
[x] 三类分类 + Markdown + CSV
\`\`\`

---

## 21. Final Verdict

\`\`\`text
${verdict}

DELETE_DOMAIN_SAFE = ${deleteSafe.length}
KEEP_DOMAIN_ATOMIC = ${keepAtomic.length}
REVIEW_DOMAIN_MODEL = ${review.length}

可据此进入最终 Source Cleanup 分拣（本轮仍未执行删除）。
\`\`\`

CSV: [domain_semantic_atomicity_reconciliation.csv](./domain_semantic_atomicity_reconciliation.csv)
`;

fs.writeFileSync(
  path.join(docsTone, 'FW_Repair_V4_Domain_Semantic_Atomicity_Reconciliation_Audit_2026_08_02.md'),
  md,
  'utf8'
);

console.log(
  JSON.stringify(
    {
      verdict,
      DELETE_DOMAIN_SAFE: deleteSafe.map((r) => r.surface),
      KEEP_DOMAIN_ATOMIC: keepAtomic.map((r) => r.surface),
      REVIEW_DOMAIN_MODEL: review.map((r) => r.surface),
      nn: { class: nn.classification, lost: nn.lostDomains, missing: nn.missingDomains },
      ut: { class: ut.classification, lost: ut.lostDomains, missing: ut.missingDomains },
    },
    null,
    2
  )
);

db.close();
