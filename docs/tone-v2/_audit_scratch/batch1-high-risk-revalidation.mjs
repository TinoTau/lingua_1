/**
 * READ ONLY — Batch-1 high-risk DELETE revalidation.
 * No Source/SQLite/Validator/Runtime mutation.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'batch1_revalidation');
const docsTone = path.join(repo, 'docs/tone-v2');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js'));
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const evidencePath = path.join(__dirname, 'reject_composite_batch1/reject_composite_batch1_evidence.json');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const items = evidence.items;
if (items.length !== 74) {
  console.error('ATOMICITY_REPORT_BASELINE_MISMATCH', items.length);
  process.exit(2);
}

const MANUAL_HIGH_RISK = new Set([
  '是否',
  '迷你吧',
  '邀请函',
  '休息时间',
  '正则策略',
  '熔断策略',
  '降级策略',
  '单元测试',
  '回归测试',
  '集成测试',
  '特征工程',
  '神经网络',
  '迁移学习',
  '流量镜像',
  '配置文件',
  '训练数据',
  '测试数据',
  '循环网络',
  '视频会议',
  '安检通道',
  '联系电话',
  '行李订单',
  '航班订单',
  '行程订单',
]);

const KEEP_LIKELY_DELETE = new Set([
  '上线计划',
  '接口文档',
  '会议通知',
  '入住时间',
  '前台信息',
  '咖啡时间',
  '当前版本',
  '查看日志',
  '检查内容',
  '检查日志',
  '早餐时间',
  '机场信息',
  '机场时间',
  '接送时间',
  '航班时间',
  '集合时间',
]);

/** Fixed-term lexicon for revalidation (semantic, not Validator blacklist). */
const FIXED_TECH = new Set([
  '单元测试',
  '回归测试',
  '集成测试',
  '配置文件',
  '神经网络',
  '迁移学习',
  '特征工程',
  '训练数据',
  '测试数据',
  '流量镜像',
  '熔断策略',
  '降级策略',
  '正则策略',
  '循环网络',
  '专家系统',
  '注册中心',
  '配置中心',
]);
const FIXED_EXPR = new Set(['视频会议', '安检通道', '联系电话', '邀请函']);
const FIXED_PRODUCT = new Set(['迷你吧']);
const FUNCTION_WORD = new Set(['是否']); // 合法功能词，非句段
const FRAGMENT_OK_DELETE = new Set(['可以吗', '检查是否有']);

const profile = defaultGeneralProfile();
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});

const rt = new LexiconRuntimeV2();
const st = rt.loadFromBundleDir(candidateDir);
if (st.status !== 'ok') throw new Error(`load fail: ${st.status}`);
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });

function toneFromDb(word, n) {
  const row =
    db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(word);
  if (!row?.tone_pinyin_key) return Array.from({ length: n }, () => 1);
  return String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 0;
    });
}

function exactProbe(word, opts = {}) {
  const t = db.prepare(`SELECT id, word, pinyin_key, tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(word);
  if (!t) return { found: false, top: [], error: 'not_in_term' };
  const syl = String(opts.pinyinKey || t.pinyin_key)
    .split('|')
    .filter(Boolean);
  let pattern = opts.tones;
  if (!pattern) {
    pattern = toneFromDb(word, syl.length);
    // If tone0 present, also try tone1 fallback probe
  }
  try {
    const r = recallSpanTopKV2(rt, {
      syllables: syl,
      windowText: word,
      termLength: syl.length,
      topK: opts.topK ?? 5,
      perSpanLimit: opts.perSpanLimit ?? 5,
      profile,
      domainIds,
      acousticTonePattern: pattern,
      toneCallerEnabled: true,
    });
    const found = r.hits.some((h) => h.hotword.word === word);
    return {
      found,
      top: r.hits.slice(0, 5).map((h) => ({ word: h.hotword.word, id: h.hotword.id, score: h.candidateScore })),
      hitCount: r.hits.length,
      pinyin_key: t.pinyin_key,
      tone_pinyin_key: t.tone_pinyin_key,
    };
  } catch (e) {
    return { found: false, error: String(e.message || e), top: [] };
  }
}

function diagnoseExactFailure(word) {
  const t = db.prepare(`SELECT * FROM term WHERE word=?`).get(word);
  const base = db.prepare(`SELECT * FROM base_lexicon WHERE word=?`).get(word);
  if (!t) return { word, category: 'UNKNOWN', detail: 'missing_term' };
  const syl = String(t.pinyin_key).split('|');
  const toneParts = String(t.tone_pinyin_key || '').split('|');
  const toneSyllables = toneParts.map((p) => p.replace(/[0-9]+$/, ''));
  const pinyinMismatch =
    toneSyllables.length === syl.length &&
    toneSyllables.some((ts, i) => ts && ts !== syl[i] && ts.replace('ü', 'v') !== syl[i].replace('ü', 'v') && ts.replace('ü', 'u') !== syl[i]);
  // 策略: ce|le vs ce4|lüe4
  const hasTone0 = toneParts.some((p) => /0$/.test(p));
  const direct = exactProbe(word);
  let category = 'UNKNOWN';
  let detail = '';
  if (pinyinMismatch) {
    category = 'PINYIN_DATA_ERROR';
    detail = `pinyin_key=${t.pinyin_key} vs tone_pinyin_key=${t.tone_pinyin_key}`;
  } else if (hasTone0) {
    // retry with tone1 substituted for 0
    const fixedTones = toneParts.map((p) => {
      const m = p.match(/([0-5])$/);
      const n = m ? Number(m[1]) : 1;
      return n === 0 ? 1 : n;
    });
    const retry = exactProbe(word, { tones: fixedTones });
    if (retry.found) {
      category = 'TONE_DATA_ERROR';
      detail = `tone0 in ${t.tone_pinyin_key}; retry tone1 succeeds`;
    } else {
      category = 'TONE_DATA_ERROR';
      detail = `tone0 in ${t.tone_pinyin_key}; retry still fail top=${JSON.stringify(retry.top)}`;
    }
  } else if (!direct.found && direct.top?.length) {
    category = 'TOPK_SUPPRESSION';
    detail = `not in top; competitors=${direct.top.map((x) => x.word).join(',')}`;
  } else if (!direct.found) {
    // try larger topK
    const big = exactProbe(word, { topK: 20, perSpanLimit: 20 });
    if (big.found) {
      category = 'TOPK_SUPPRESSION';
      detail = 'found only with larger topK';
    } else if (!base) {
      category = 'MATERIALIZATION_ERROR';
      detail = 'term exists but base_lexicon missing';
    } else {
      category = 'UNKNOWN';
      detail = `term+base present; probe empty; pinyin=${t.pinyin_key} tone=${t.tone_pinyin_key}`;
    }
  } else {
    category = 'EXPECTED_RUNTIME_BEHAVIOR';
    detail = 'exact found';
  }
  // special fix attempt for 策略: use lüe syllables
  if (word === '策略' && !direct.found) {
    const alt = exactProbe(word, { pinyinKey: 'ce|lue', tones: [4, 4] });
    const alt2 = exactProbe(word, { pinyinKey: 'ce|lüe', tones: [4, 4] });
    if (alt.found || alt2.found) {
      category = 'PINYIN_DATA_ERROR';
      detail = `pinyin_key has le but tone uses lüe; altProbe found=${alt.found || alt2.found}`;
    }
  }
  return {
    word,
    category,
    detail,
    termId: t.id,
    pinyin_key: t.pinyin_key,
    tone_pinyin_key: t.tone_pinyin_key,
    basePresent: !!base,
    directFound: direct.found,
    directTop: direct.top,
  };
}

function summarizeOrchestrator(out) {
  const lt = out.latticeTrace || {};
  const edges = lt.lexicalEdges || lt.edges || out.lexicalEdges || [];
  const paths = lt.segmentationPaths || lt.paths || out.paths || [];
  const sentences =
    (out.kenlmSentenceCandidates?.combinations || []).map((x) => x.text).filter(Boolean) ||
    (out.assembledSentences || []).map((s) => s.text || s).filter(Boolean);
  const kenlm = (out.kenlmSentenceCandidates?.combinations || []).length;
  return {
    coverageStatus: lt.coverageStatus || out.coverageStatus || null,
    edgeCount: Array.isArray(edges) ? edges.length : null,
    edgeWords: Array.isArray(edges)
      ? edges
          .slice(0, 12)
          .map((e) => e.word || e.surface || e.hotword?.word || e.canonicalWord)
          .filter(Boolean)
      : [],
    pathCount: Array.isArray(paths) ? paths.length : null,
    uncovered: lt.latticeUncovered ?? lt.uncoveredRanges ?? null,
    retainedDomains: out.metrics?.retainedDomains || out.vote?.retainedDomains || null,
    sentenceSample: sentences.slice(0, 5),
    kenlmInputCount: kenlm,
  };
}

/**
 * WITH: normal orchestrator on surface as utterance text.
 * WITHOUT: post-filter Exact hits / approximate by checking segment-only assembly if compound excluded from hit list.
 * True DB mutation forbidden — use probe-level exclusion of compound word from recall hits when possible.
 */
function latticeCounterfactual(surface, segments) {
  const withOut = runSpanAssemblyV4Orchestrator({
    rawText: surface,
    runtime: rt,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
  });
  const withSum = summarizeOrchestrator(withOut);

  // Probe-only: exact probe each segment; if ALL segments exact-found with healthy pinyin, classify FULL_ATOMIC
  const segExact = (segments || []).map((s) => ({ surface: s, ...exactProbe(s) }));
  const allSegOk = segments?.length > 0 && segExact.every((s) => s.found);
  const anySegFail = (segments || []).length > 0 && segExact.some((s) => !s.found);

  // WITHOUT approximation: run orchestrator but treat as path confirmation via segment probes + edge words excluding compound
  const edgeHasCompound = (withSum.edgeWords || []).includes(surface);
  const edgeHasAllSegs =
    segments?.length > 0 && segments.every((s) => (withSum.edgeWords || []).includes(s));

  let pathClass = 'NO_ATOMIC_PATH';
  if (allSegOk && (edgeHasAllSegs || segments.length >= 2)) {
    // If segments exact and can form coverage
    pathClass = edgeHasCompound && !edgeHasAllSegs ? 'FALLBACK_ONLY_PATH' : 'FULL_ATOMIC_PATH_CONFIRMED';
    // Strengthen: if any segment exact fails → not full
    if (anySegFail) pathClass = 'INCOMPLETE_ATOMIC_PATH';
    else if (allSegOk) pathClass = 'FULL_ATOMIC_PATH_CONFIRMED';
  } else if (anySegFail) {
    pathClass = 'INCOMPLETE_ATOMIC_PATH';
  } else if (!segments?.length) {
    pathClass = 'NO_ATOMIC_PATH';
  } else {
    pathClass = 'FALLBACK_ONLY_PATH';
  }

  return {
    withCompound: withSum,
    segmentExact: segExact,
    edgeHasCompound,
    edgeHasAllSegs,
    pathClass,
    note: 'without-compound uses probe-level segment Exact + edge observation; no SQLite mutation',
  };
}

// ---- Contract violations ----
const violations = [];
function addViolation(surface, fieldA, fieldB, conflict, originalRecommendation) {
  violations.push({ surface, fieldA, fieldB, conflict, originalRecommendation });
}

for (const it of items) {
  if (it.recommendation === 'DELETE_CONFIRMED' && it.latticeCoverageWithoutCompound === 'SEGMENTS_INCOMPLETE') {
    addViolation(
      it.surface,
      'recommendation=DELETE_CONFIRMED',
      'latticeCoverageWithoutCompound=SEGMENTS_INCOMPLETE',
      'C-01',
      it.recommendation
    );
  }
  if (it.recommendation === 'DELETE_CONFIRMED' && (it.segmentExact || []).some((s) => s.found === false)) {
    addViolation(
      it.surface,
      'recommendation=DELETE_CONFIRMED',
      'segmentExact has false',
      'C-02',
      it.recommendation
    );
  }
  if (it.recommendation === 'DELETE_CONFIRMED' && it.domainImpact === 'DOMAIN_EVIDENCE_LOST') {
    addViolation(
      it.surface,
      'recommendation=DELETE_CONFIRMED',
      'domainImpact=DOMAIN_EVIDENCE_LOST',
      'C-03',
      it.recommendation
    );
  }
  if (it.reasonCode === 'SENTENCE_FRAGMENT' && it.length <= 3) {
    addViolation(
      it.surface,
      'reasonCode=SENTENCE_FRAGMENT',
      `length=${it.length}`,
      'C-04',
      it.recommendation
    );
  }
  const claims =
    /原子|覆盖/.test(String(it.notes || '')) && it.recommendation === 'DELETE_CONFIRMED';
  if (claims && it.latticeCoverageWithoutCompound !== 'SEGMENTS_CAN_COVER') {
    addViolation(
      it.surface,
      'notes claims atomic coverage',
      `lattice=${it.latticeCoverageWithoutCompound}`,
      'C-05',
      it.recommendation
    );
  }
}

// ---- High-risk inventory ----
const highRisk = new Set(MANUAL_HIGH_RISK);
for (const it of items) {
  if (it.latticeCoverageWithoutCompound !== 'SEGMENTS_CAN_COVER' && it.latticeCoverageWithoutCompound !== 'NO_SEGMENTS_FRAGMENT_OK') {
    highRisk.add(it.surface);
  }
  if ((it.segmentExact || []).some((s) => s.found === false)) highRisk.add(it.surface);
  if (it.domainImpact === 'DOMAIN_EVIDENCE_LOST') highRisk.add(it.surface);
  if (it.reasonCode === 'SENTENCE_FRAGMENT' && it.length <= 3) highRisk.add(it.surface);
  if (FIXED_TECH.has(it.surface) || FIXED_EXPR.has(it.surface) || FIXED_PRODUCT.has(it.surface)) {
    highRisk.add(it.surface);
  }
  // classification heuristics for tech/test nouns
  if (/(测试|策略|网络|学习|工程|文件|数据|镜像|会议|通道|电话|订单)$/.test(it.surface)) {
    highRisk.add(it.surface);
  }
}

// Exact anomalies for all formal segments with Exact=false across 74
const anomalyWords = new Set();
for (const it of items) {
  for (const s of it.segmentExact || []) {
    if (s.found === false) anomalyWords.add(s.surface);
  }
}
anomalyWords.add('休息');
anomalyWords.add('策略');
const exactAnomalies = [...anomalyWords].map(diagnoseExactFailure);

// Lattice CF for high-risk + all DELETE items that had incomplete coverage
const cfBySurface = {};
for (const it of items) {
  if (!highRisk.has(it.surface) && it.recommendation !== 'DELETE_CONFIRMED') continue;
  if (!highRisk.has(it.surface) && KEEP_LIKELY_DELETE.has(it.surface)) {
    // still verify safe deletes lightly
  }
  if (highRisk.has(it.surface) || KEEP_LIKELY_DELETE.has(it.surface) || it.recommendation === 'DELETE_CONFIRMED') {
    try {
      cfBySurface[it.surface] = latticeCounterfactual(it.surface, it.segments || []);
    } catch (e) {
      cfBySurface[it.surface] = { error: String(e.message || e), pathClass: 'NO_ATOMIC_PATH' };
    }
  }
}

function revalidate(it) {
  const surface = it.surface;
  const originalRecommendation = it.recommendation;
  const cf = cfBySurface[surface];
  const pathClass = cf?.pathClass || (it.latticeCoverageWithoutCompound === 'SEGMENTS_CAN_COVER' ? 'FULL_ATOMIC_PATH_CONFIRMED' : 'INCOMPLETE_ATOMIC_PATH');
  const segFails = (it.segmentExact || []).filter((s) => !s.found).map((s) => s.surface);
  const anomalyCats = segFails.map((w) => exactAnomalies.find((a) => a.word === w)?.category).filter(Boolean);

  let revalidatedRecommendation = originalRecommendation;
  let changeReason = '';
  let termTypeRecommendation = it.termTypeRecommendation || '';
  let exceptionReasonRecommendation = it.exceptionReasonRecommendation || '';
  let sourceAction = it.sourceAction;
  let fpKind = ''; // SOURCE_METADATA_MISSING | VALIDATOR_RULE_ERROR
  let classification = it.classification;

  // Priority rules
  if (FUNCTION_WORD.has(surface)) {
    revalidatedRecommendation = 'VALIDATOR_FALSE_POSITIVE';
    classification = 'FIXED_EXPRESSION';
    termTypeRecommendation = 'fixed_expression';
    exceptionReasonRecommendation =
      '「是否」是汉语规范功能词/选择疑问成分，具有独立语法指称，不是口语句段碎片；SENTENCE_FRAGMENT 属于通用规则误伤。';
    sourceAction = 'ADD_EXCEPTION_METADATA';
    fpKind = 'VALIDATOR_RULE_ERROR';
    changeReason = '三字/功能词被误判 SENTENCE_FRAGMENT';
  } else if (FIXED_PRODUCT.has(surface)) {
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    classification = 'FIXED_PRODUCT';
    termTypeRecommendation = 'fixed_product';
    exceptionReasonRecommendation =
      '「迷你吧」是酒店客房固定产品/设施名（minibar），完整表达具有独立行业实体身份，拆分或当作句段删除会丢失设施指称；且 Domain=tourism_hotel 仅挂在完整词上。';
    sourceAction = 'ADD_EXCEPTION_METADATA';
    fpKind = 'SOURCE_METADATA_MISSING';
    changeReason = '行业固定产品 + DOMAIN_EVIDENCE_LOST';
  } else if (surface === '邀请函') {
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    classification = 'FIXED_EXPRESSION';
    termTypeRecommendation = 'fixed_expression';
    exceptionReasonRecommendation =
      '「邀请函」是规范独立名词（请柬/邀请文书类型），完整形式具有稳定指称，不是 SENTENCE_FRAGMENT；应补例外元数据而非删除。';
    sourceAction = 'ADD_EXCEPTION_METADATA';
    fpKind = 'VALIDATOR_RULE_ERROR';
    changeReason = '规范三字名词误判为句段';
  } else if (FIXED_TECH.has(surface)) {
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    classification = 'FIXED_TECHNICAL_TERM';
    termTypeRecommendation = 'fixed_technical_term';
    exceptionReasonRecommendation = `${surface} 是软件工程/AI/基础设施语境中的固定技术术语或标准类型名，完整形式具有独立专业指称；拆成原子词后不能等价替代该标准概念。`;
    sourceAction = 'ADD_EXCEPTION_METADATA';
    fpKind = 'SOURCE_METADATA_MISSING';
    changeReason =
      it.domainImpact === 'DOMAIN_EVIDENCE_LOST'
        ? '固定技术术语 + DOMAIN_EVIDENCE_LOST'
        : '固定技术术语不可按普通组合删除';
  } else if (FIXED_EXPR.has(surface)) {
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    classification = 'FIXED_EXPRESSION';
    termTypeRecommendation = 'fixed_expression';
    exceptionReasonRecommendation = `${surface} 是行业固定表达/标准称谓，完整形式具有稳定业务指称，拆分后不能完全等价替代。`;
    sourceAction = 'ADD_EXCEPTION_METADATA';
    fpKind = 'SOURCE_METADATA_MISSING';
    changeReason = '固定表达/行业称谓';
  } else if (segFails.length && anomalyCats.some((c) => c === 'PINYIN_DATA_ERROR' || c === 'TONE_DATA_ERROR' || c === 'MATERIALIZATION_ERROR' || c === 'UNKNOWN')) {
    revalidatedRecommendation = 'REQUIRES_ATOM_RECALL_FIX';
    sourceAction = 'KEEP_UNCHANGED';
    changeReason = `依赖 segment ExactRecall=false（${segFails.join('+')}）；根因=${anomalyCats.join('|')}；修复前不可删`;
  } else if (pathClass === 'INCOMPLETE_ATOMIC_PATH' || pathClass === 'NO_ATOMIC_PATH' || pathClass === 'FALLBACK_ONLY_PATH') {
    if (originalRecommendation === 'DELETE_CONFIRMED') {
      revalidatedRecommendation = 'INSUFFICIENT_EVIDENCE';
      sourceAction = 'KEEP_UNCHANGED';
      changeReason = `Lattice pathClass=${pathClass}，不满足 FULL_ATOMIC_PATH_CONFIRMED`;
    }
  } else if (it.domainImpact === 'DOMAIN_EVIDENCE_LOST' && originalRecommendation === 'DELETE_CONFIRMED') {
    // compound has domain identity segments lack
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    classification = classification === 'OTHER' ? 'FIXED_EXPRESSION' : classification;
    termTypeRecommendation = termTypeRecommendation || 'fixed_expression';
    exceptionReasonRecommendation =
      exceptionReasonRecommendation ||
      `${surface} 的领域证据仅挂在完整词上，子词不具备同等领域区分能力；完整词具有独立业务/技术指称，不应在补例外前删除。`;
    sourceAction = 'ADD_EXCEPTION_METADATA';
    changeReason = 'DOMAIN_EVIDENCE_LOST 且完整词具有独立域语义';
  }

  // Safe ordinary business phrases: require FULL atomic path + no domain loss + not fixed categories
  const isFixedish =
    FIXED_TECH.has(surface) ||
    FIXED_EXPR.has(surface) ||
    FIXED_PRODUCT.has(surface) ||
    FUNCTION_WORD.has(surface) ||
    surface === '邀请函';

  if (FRAGMENT_OK_DELETE.has(surface)) {
    revalidatedRecommendation = 'DELETE_CONFIRMED';
    sourceAction = 'DELETE_SOURCE_ROW';
    changeReason = '口语句段/模板碎片，非独立正式词';
    classification = 'OTHER';
  } else if (
    !isFixedish &&
    (KEEP_LIKELY_DELETE.has(surface) ||
      ['ACTION_OBJECT_PHRASE', 'NOUN_NOUN_BUSINESS_PHRASE', 'ATTRIBUTE_NOUN_PHRASE'].includes(
        it.classification
      )) &&
    pathClass === 'FULL_ATOMIC_PATH_CONFIRMED' &&
    !segFails.length &&
    it.domainImpact !== 'DOMAIN_EVIDENCE_LOST' &&
    revalidatedRecommendation !== 'KEEP_AS_EXCEPTION' &&
    revalidatedRecommendation !== 'VALIDATOR_FALSE_POSITIVE' &&
    revalidatedRecommendation !== 'REQUIRES_ATOM_RECALL_FIX'
  ) {
    revalidatedRecommendation = 'DELETE_CONFIRMED';
    sourceAction = 'DELETE_SOURCE_ROW';
    if (!changeReason) changeReason = '普通业务组合；FULL_ATOMIC_PATH_CONFIRMED';
  }

  // If still DELETE but path not full → block
  if (
    revalidatedRecommendation === 'DELETE_CONFIRMED' &&
    pathClass !== 'FULL_ATOMIC_PATH_CONFIRMED' &&
    !FRAGMENT_OK_DELETE.has(surface)
  ) {
    if (segFails.length) {
      revalidatedRecommendation = 'REQUIRES_ATOM_RECALL_FIX';
      sourceAction = 'KEEP_UNCHANGED';
      changeReason = `原拟删除但 pathClass=${pathClass} / segmentExact fail`;
    } else {
      revalidatedRecommendation = 'INSUFFICIENT_EVIDENCE';
      sourceAction = 'KEEP_UNCHANGED';
      changeReason = `原拟删除但缺少 FULL_ATOMIC_PATH_CONFIRMED (got ${pathClass})`;
    }
  }

  // Preserve prior KEEP exceptions if still valid
  if (originalRecommendation === 'KEEP_AS_EXCEPTION' && ['专家系统', '注册中心', '配置中心'].includes(surface)) {
    revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    termTypeRecommendation = 'fixed_technical_term';
    exceptionReasonRecommendation =
      it.exceptionReasonRecommendation ||
      `${surface} 为固定技术术语/组件名，完整形式具有独立技术指称。`;
    sourceAction = 'ADD_EXCEPTION_METADATA';
    if (!changeReason) changeReason = '维持原 KEEP_AS_EXCEPTION';
  }

  const changed = revalidatedRecommendation !== originalRecommendation;
  return {
    surface,
    termId: it.termId,
    sourceFile: it.sourceFile,
    sourceRow: it.sourceRow,
    reasonCode: it.reasonCode,
    segments: it.segments,
    classification,
    originalRecommendation,
    revalidatedRecommendation,
    changed,
    changeReason: changed ? changeReason || 'revalidated' : '',
    termTypeRecommendation,
    exceptionReasonRecommendation,
    compoundDomains: it.domains,
    segmentDomains: (it.segmentChecks || []).map((s) => `${s.surface}:${(s.domains || []).join('/')}`),
    domainImpact: it.domainImpact,
    latticeCoverageWithoutCompound: it.latticeCoverageWithoutCompound,
    pathClass,
    duplicatePathImpact: it.duplicatePathImpact,
    validatorIssue: fpKind || it.validatorIssue || '',
    fpKind,
    sourceAction,
    highRisk: highRisk.has(surface),
    segExactFails: segFails,
    notes: changeReason || it.notes || '',
  };
}

const revalidated = items.map(revalidate);

// Force second pass for remaining DELETE that are high-risk fixed-ish
for (const r of revalidated) {
  if (r.revalidatedRecommendation === 'DELETE_CONFIRMED' && highRisk.has(r.surface) && FIXED_TECH.has(r.surface)) {
    r.revalidatedRecommendation = 'KEEP_AS_EXCEPTION';
    r.changed = true;
    r.changeReason = 'high-risk fixed technical term';
    r.termTypeRecommendation = 'fixed_technical_term';
    r.sourceAction = 'ADD_EXCEPTION_METADATA';
  }
}

const counts = {
  DELETE_CONFIRMED: revalidated.filter((x) => x.revalidatedRecommendation === 'DELETE_CONFIRMED').length,
  KEEP_AS_EXCEPTION: revalidated.filter((x) => x.revalidatedRecommendation === 'KEEP_AS_EXCEPTION').length,
  VALIDATOR_FALSE_POSITIVE: revalidated.filter((x) => x.revalidatedRecommendation === 'VALIDATOR_FALSE_POSITIVE').length,
  INSUFFICIENT_EVIDENCE: revalidated.filter((x) => x.revalidatedRecommendation === 'INSUFFICIENT_EVIDENCE').length,
  REQUIRES_ATOM_RECALL_FIX: revalidated.filter((x) => x.revalidatedRecommendation === 'REQUIRES_ATOM_RECALL_FIX').length,
};

const changed = revalidated.filter((x) => x.changed);

function toCsv(rows, headers) {
  const esc = (v) => {
    const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
}

const violCsv = toCsv(violations, ['surface', 'fieldA', 'fieldB', 'conflict', 'originalRecommendation']);
const anomalyCsv = toCsv(exactAnomalies, [
  'word',
  'category',
  'detail',
  'termId',
  'pinyin_key',
  'tone_pinyin_key',
  'basePresent',
  'directFound',
]);
const revalCsv = toCsv(revalidated, [
  'surface',
  'termId',
  'sourceFile',
  'sourceRow',
  'reasonCode',
  'segments',
  'classification',
  'originalRecommendation',
  'revalidatedRecommendation',
  'changed',
  'changeReason',
  'termTypeRecommendation',
  'exceptionReasonRecommendation',
  'compoundDomains',
  'segmentDomains',
  'domainImpact',
  'pathClass',
  'validatorIssue',
  'fpKind',
  'sourceAction',
  'highRisk',
  'notes',
]);

fs.writeFileSync(path.join(docsTone, 'review_contract_violations.csv'), violCsv);
fs.writeFileSync(path.join(docsTone, 'exact_recall_anomalies.csv'), anomalyCsv);
fs.writeFileSync(path.join(docsTone, 'atomicity_batch1_revalidated.csv'), revalCsv);
fs.writeFileSync(path.join(outDir, 'review_contract_violations.csv'), violCsv);
fs.writeFileSync(path.join(outDir, 'exact_recall_anomalies.csv'), anomalyCsv);
fs.writeFileSync(path.join(outDir, 'atomicity_batch1_revalidated.csv'), revalCsv);

const focus = [
  '迷你吧',
  '邀请函',
  '是否',
  '单元测试',
  '回归测试',
  '集成测试',
  '神经网络',
  '迁移学习',
  '特征工程',
  '流量镜像',
  '配置文件',
  '熔断策略',
  '降级策略',
  '正则策略',
  '休息时间',
  '上线计划',
  '接口文档',
];

const payload = {
  baseline: 74,
  violationCount: violations.length,
  violations,
  highRiskCount: highRisk.size,
  highRisk: [...highRisk].sort(),
  counts,
  changedCount: changed.length,
  changed: changed.map((c) => ({
    surface: c.surface,
    from: c.originalRecommendation,
    to: c.revalidatedRecommendation,
    reason: c.changeReason,
  })),
  focus: Object.fromEntries(
    focus.map((s) => {
      const r = revalidated.find((x) => x.surface === s);
      return [s, r || null];
    })
  ),
  exactAnomalies,
  lists: {
    DELETE_CONFIRMED: revalidated.filter((x) => x.revalidatedRecommendation === 'DELETE_CONFIRMED').map((x) => x.surface),
    KEEP_AS_EXCEPTION: revalidated.filter((x) => x.revalidatedRecommendation === 'KEEP_AS_EXCEPTION').map((x) => x.surface),
    VALIDATOR_FALSE_POSITIVE: revalidated
      .filter((x) => x.revalidatedRecommendation === 'VALIDATOR_FALSE_POSITIVE')
      .map((x) => x.surface),
    INSUFFICIENT_EVIDENCE: revalidated
      .filter((x) => x.revalidatedRecommendation === 'INSUFFICIENT_EVIDENCE')
      .map((x) => x.surface),
    REQUIRES_ATOM_RECALL_FIX: revalidated
      .filter((x) => x.revalidatedRecommendation === 'REQUIRES_ATOM_RECALL_FIX')
      .map((x) => x.surface),
  },
  bundle: evidence.bundle,
  cfSample: Object.fromEntries(
    ['休息时间', '熔断策略', '单元测试', '迷你吧', '上线计划', '神经网络'].map((s) => [s, cfBySurface[s]])
  ),
};

fs.writeFileSync(path.join(outDir, 'revalidation_payload.json'), JSON.stringify(payload, null, 2));
console.log(
  JSON.stringify(
    {
      violations: violations.length,
      counts,
      changed: changed.length,
      focus: payload.focus,
      anomalies: exactAnomalies.map((a) => ({ w: a.word, cat: a.category })),
      deleteList: payload.lists.DELETE_CONFIRMED,
      keepList: payload.lists.KEEP_AS_EXCEPTION,
      recallFix: payload.lists.REQUIRES_ATOM_RECALL_FIX,
      fp: payload.lists.VALIDATOR_FALSE_POSITIVE,
    },
    null,
    2
  )
);

db.close();
