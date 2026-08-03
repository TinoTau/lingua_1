/**
 * READ ONLY — REJECT_COMPOSITE Batch-1 evidence gatherer.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const require = createRequire(path.join(repo, 'electron_node/electron-node/package.json'));
const Database = require('better-sqlite3');

const candidateDir = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate');
const prodDir = path.join(repo, 'node_runtime/lexicon/v3');
const reportPath = path.join(candidateDir, 'atomicity_report.json');
const sourceDir = path.join(repo, 'electron_node/docs/lexicon-assets/full_rebuild_v1');
const outDir = path.join(__dirname, 'reject_composite_batch1');
fs.mkdirSync(outDir, { recursive: true });

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  function readRow() {
    const cells = [];
    let cell = '';
    let inQ = false;
    while (i < len) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQ = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        cells.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n') {
        i += 1;
        cells.push(cell);
        return cells;
      }
      if (ch === '\r') {
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || cells.length) {
      cells.push(cell);
      return cells;
    }
    return null;
  }
  const header = readRow();
  if (!header) return [];
  let rowNum = 1;
  while (true) {
    const cells = readRow();
    if (!cells) break;
    rowNum += 1;
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = { __rowNum: rowNum };
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    rows.push(obj);
  }
  return rows;
}

function loadCsv(name) {
  return parseCsv(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
}

const review = loadCsv('lexicon_full_corrected_review.csv');
const supplemental = loadCsv('supplemental_terms.csv');
const reviewByWord = new Map(review.map((r) => [r.word?.trim(), r]));
const reviewById = new Map(review.map((r) => [r.term_id?.trim(), r]));
const suppByWord = new Map(supplemental.map((r) => [r.word?.trim(), r]));

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rejects = report.rows.filter((r) => r.decision === 'REJECT_COMPOSITE');
if (rejects.length !== 74) {
  console.error('ATOMICITY_REPORT_BASELINE_MISMATCH', rejects.length);
  process.exit(2);
}

const db = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });
const termByWord = new Map(
  db.prepare(`SELECT id, word, pinyin_key, tone_pinyin_key, source, enabled FROM term`).all().map((r) => [r.word, r])
);
const tagsByTerm = new Map();
for (const t of db.prepare(`SELECT term_id, domain_id FROM term_domain_tags`).all()) {
  const arr = tagsByTerm.get(t.term_id) || [];
  arr.push(t.domain_id);
  tagsByTerm.set(t.term_id, arr);
}

function sourceTrace(row) {
  const word = row.surface;
  const id = row.termId;
  const fromReview = reviewById.get(id) || reviewByWord.get(word);
  const fromSupp = suppByWord.get(word);
  if (String(row.sourceFile || '').includes('supplemental') || (!fromReview && fromSupp)) {
    return {
      sourceFile: 'supplemental_terms.csv',
      sourceRow: fromSupp?.__rowNum ?? row.sourceRow,
      sourceLabel: fromSupp?.source || row.sourceLabel,
      importBatch: fromSupp?.source || 'supplemental',
      sourceFields: fromSupp || null,
    };
  }
  return {
    sourceFile: 'lexicon_full_corrected_review.csv',
    sourceRow: fromReview?.__rowNum ?? row.sourceRow,
    sourceLabel: fromReview?.source || row.sourceLabel,
    importBatch: fromReview?.source || row.sourceLabel,
    sourceFields: fromReview || null,
  };
}

function segmentsCover(surface, segments) {
  if (!segments?.length) return { ok: false, joined: '', note: 'no_segments' };
  const joined = segments.join('');
  return { ok: joined === surface, joined, note: joined === surface ? 'full_cover' : 'mismatch' };
}

const ROLE_SUFFIX = /(医生|医师|护士|经理|总监|主任|专员|顾问|工程师|分析师|助理|秘书|司机|导游|厨师|店长)$/;
const ORG_MARK = /(博物馆|医院|大学|学院|公司|集团|银行|酒店|机场|车站|中心|协会|委员会)$/;
/** Whole-surface product SKU patterns only — do not match substring 咖啡 inside 咖啡时间. */
const PRODUCT_SURFACE = /^(焦糖玛奇朵|蓝莓马芬|美式咖啡|拿铁咖啡|卡布奇诺|珍珠奶茶|.+(套餐|拼盘))$/;

function classifySemantic(surface, reasonCode, segments) {
  if (PRODUCT_SURFACE.test(surface)) return 'FIXED_PRODUCT';
  if (ROLE_SUFFIX.test(surface)) return 'ROLE_TITLE';
  // 博物馆等机构；排除微服务「xx中心」技术名（另行 MANUAL / 技术例外）
  if (/(博物馆|医院|大学|学院|公司|集团|银行|酒店|机场|车站|协会|委员会)$/.test(surface)) {
    return 'ORGANIZATION';
  }
  if (reasonCode === 'ACTION_OBJECT_PHRASE') return 'ACTION_OBJECT_PHRASE';
  if (reasonCode === 'NOUN_NOUN_BUSINESS_PHRASE') return 'NOUN_NOUN_BUSINESS_PHRASE';
  if (reasonCode === 'SENTENCE_FRAGMENT' || reasonCode === 'TEMPLATE_FRAGMENT') return 'OTHER';
  if (segments?.length === 2) return 'ATTRIBUTE_NOUN_PHRASE';
  return 'OTHER';
}

function domainImpact(compoundDomains, segmentDomainLists) {
  const segUnion = new Set(segmentDomainLists.flat());
  const compound = new Set(compoundDomains || []);
  if (compound.size === 0) return 'DOMAIN_EVIDENCE_PRESERVED';
  let preserved = 0;
  for (const d of compound) if (segUnion.has(d)) preserved += 1;
  if (preserved === compound.size) return 'DOMAIN_EVIDENCE_PRESERVED';
  if (preserved === 0) return 'DOMAIN_EVIDENCE_LOST';
  return 'DOMAIN_EVIDENCE_WEAKENED';
}

/** Manual overrides for known special semantics inside the 74 (audit judgment, not Validator). */
const MANUAL = {
  专家系统: {
    recommendation: 'KEEP_AS_EXCEPTION',
    classification: 'FIXED_TECHNICAL_TERM',
    termTypeRecommendation: 'fixed_technical_term',
    exceptionReasonRecommendation:
      '「专家系统」是经典 AI 固定技术术语，指一类完整系统形态，拆成「专家+系统」不能等价替代其学科/产品指称。',
    sourceAction: 'ADD_EXCEPTION_METADATA',
    notes: '经典技术术语例外',
  },
  注册中心: {
    recommendation: 'KEEP_AS_EXCEPTION',
    classification: 'FIXED_TECHNICAL_TERM',
    termTypeRecommendation: 'fixed_technical_term',
    exceptionReasonRecommendation:
      '「注册中心」在微服务架构中是固定组件名（Service Registry），完整形式具有独立技术实体身份，拆成「注册+中心」不能等价替代。',
    sourceAction: 'ADD_EXCEPTION_METADATA',
    notes: '微服务固定组件名',
  },
  配置中心: {
    recommendation: 'KEEP_AS_EXCEPTION',
    classification: 'FIXED_TECHNICAL_TERM',
    termTypeRecommendation: 'fixed_technical_term',
    exceptionReasonRecommendation:
      '「配置中心」在微服务/运维语境中是固定组件名（Config Center），完整形式具有独立技术实体身份。',
    sourceAction: 'ADD_EXCEPTION_METADATA',
    notes: '微服务固定组件名',
  },
};

function recommend(item) {
  const { surface, reasonCode, segments, semantic, cover, segmentChecks, domainImpact: di } = item;
  if (MANUAL[surface]) {
    const m = MANUAL[surface];
    return {
      ...m,
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      validatorIssue: '',
    };
  }

  if (reasonCode === 'SENTENCE_FRAGMENT' || reasonCode === 'TEMPLATE_FRAGMENT') {
    return {
      recommendation: 'DELETE_CONFIRMED',
      classification: semantic,
      termTypeRecommendation: '',
      exceptionReasonRecommendation: '',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'DELETE_SOURCE_ROW',
      validatorIssue: '',
      notes: '句段/口语碎片，非独立正式原子词；删除不依赖 parent fragment',
    };
  }

  if (!segments?.length) {
    // length-3 fragment already handled; other empty-segment rejects
    if (reasonCode === 'MISSING_EXCEPTION_METADATA') {
      return {
        recommendation: 'INSUFFICIENT_EVIDENCE',
        classification: semantic,
        termTypeRecommendation: '',
        exceptionReasonRecommendation: '',
        domainFollowUp: 'REVIEW_DOMAIN_TAGS',
        sourceAction: 'KEEP_UNCHANGED',
        validatorIssue: '',
        notes: '例外元数据不完整',
      };
    }
    return {
      recommendation: 'DELETE_CONFIRMED',
      classification: semantic,
      termTypeRecommendation: '',
      exceptionReasonRecommendation: '',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'DELETE_SOURCE_ROW',
      validatorIssue: '',
      notes: '无有效原子拆分；按句段/非法正式词处理',
    };
  }

  if (!cover.ok) {
    return {
      recommendation: 'VALIDATOR_FALSE_POSITIVE',
      classification: semantic,
      termTypeRecommendation: '',
      exceptionReasonRecommendation: '',
      domainFollowUp: '',
      sourceAction: 'REQUIRES_VALIDATOR_REVIEW',
      validatorIssue: 'segments_do_not_cover_surface',
      notes: '拆分无法完整覆盖 surface — 通用规则复核，禁止单词特判',
    };
  }

  // Formal term = present in rebuilt term table (review ∪ supplemental). CSV lookup is secondary.
  const allSegFormal = segmentChecks.every((s) => s.isFormalTerm);
  if (!allSegFormal) {
    return {
      recommendation: 'VALIDATOR_FALSE_POSITIVE',
      classification: semantic,
      termTypeRecommendation: '',
      exceptionReasonRecommendation: '',
      domainFollowUp: '',
      sourceAction: 'REQUIRES_VALIDATOR_REVIEW',
      validatorIssue: 'segment_not_formal_term',
      notes: 'segment 不在正式 Runtime term 表',
    };
  }

  if (semantic === 'ORGANIZATION') {
    return {
      recommendation: 'KEEP_AS_EXCEPTION',
      classification: semantic,
      termTypeRecommendation: 'organization',
      exceptionReasonRecommendation:
        '该 surface 是机构/场馆类专名或准专名，完整表达具有独立实体身份，拆成普通名词后不能等价替代其指称对象。',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'ADD_EXCEPTION_METADATA',
      validatorIssue: '',
      notes: '机构/场馆例外',
    };
  }
  if (semantic === 'ROLE_TITLE') {
    return {
      recommendation: 'KEEP_AS_EXCEPTION',
      classification: semantic,
      termTypeRecommendation: 'fixed_expression',
      exceptionReasonRecommendation:
        '该 surface 是职称/角色固定表达，完整称谓具有独立业务身份，拆分后不能完全等价替代挂号/岗位等槽位语义。',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'ADD_EXCEPTION_METADATA',
      validatorIssue: '',
      notes: '职称/角色例外',
    };
  }
  if (semantic === 'FIXED_PRODUCT') {
    return {
      recommendation: 'KEEP_AS_EXCEPTION',
      classification: semantic,
      termTypeRecommendation: 'fixed_product',
      exceptionReasonRecommendation:
        '该 surface 是稳定商品或菜单 SKU，完整表达具有独立业务身份，拆分后不能等价替代其实体语义。',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'ADD_EXCEPTION_METADATA',
      validatorIssue: '',
      notes: '商品/菜单例外',
    };
  }

  if (
    semantic === 'ACTION_OBJECT_PHRASE' ||
    semantic === 'NOUN_NOUN_BUSINESS_PHRASE' ||
    semantic === 'ATTRIBUTE_NOUN_PHRASE'
  ) {
    return {
      recommendation: 'DELETE_CONFIRMED',
      classification: semantic,
      termTypeRecommendation: '',
      exceptionReasonRecommendation: '',
      domainFollowUp: di === 'DOMAIN_EVIDENCE_PRESERVED' ? '' : 'REVIEW_DOMAIN_TAGS',
      sourceAction: 'DELETE_SOURCE_ROW',
      validatorIssue: '',
      notes:
        di === 'DOMAIN_EVIDENCE_PRESERVED'
          ? '普通业务组合；原子词均在正式 Source，语义可由原子组合覆盖'
          : '普通业务组合可删；Domain 证据弱化/丢失，后续独立复核原子词标签（禁止机械复制组合域）',
    };
  }

  return {
    recommendation: 'INSUFFICIENT_EVIDENCE',
    classification: semantic,
    termTypeRecommendation: '',
    exceptionReasonRecommendation: '',
    domainFollowUp: 'REVIEW_DOMAIN_TAGS',
    sourceAction: 'KEEP_UNCHANGED',
    validatorIssue: '',
    notes: '证据不足，保留待人工',
  };
}

const items = [];
for (const row of rejects) {
  const trace = sourceTrace(row);
  const segments = row.segments || [];
  const cover = segmentsCover(row.surface, segments);
  const segmentChecks = segments.map((seg) => {
    const t = termByWord.get(seg);
    const domains = t ? tagsByTerm.get(t.id) || [] : [];
    const src = reviewByWord.get(seg) || suppByWord.get(seg);
    return {
      surface: seg,
      isFormalTerm: !!t,
      termId: t?.id || '',
      pinyin: t?.pinyin_key || '',
      tones: t?.tone_pinyin_key || '',
      domains,
      inSource: !!src,
      sourceFile: src
        ? reviewByWord.has(seg)
          ? 'lexicon_full_corrected_review.csv'
          : 'supplemental_terms.csv'
        : '',
      enabled: t?.enabled === 1,
    };
  });
  const compoundDomains = Array.isArray(row.domains) && row.domains.length
    ? row.domains
    : (() => {
        const t = termByWord.get(row.surface);
        return t ? tagsByTerm.get(t.id) || [] : [];
      })();
  const di = domainImpact(
    compoundDomains,
    segmentChecks.map((s) => s.domains)
  );
  const semantic = classifySemantic(row.surface, row.reasonCode, segments);
  const base = {
    surface: row.surface,
    termId: row.termId,
    length: row.length,
    sourceFile: trace.sourceFile,
    sourceRow: trace.sourceRow,
    sourceLabel: trace.sourceLabel,
    importBatch: trace.importBatch,
    domains: compoundDomains,
    decision: row.decision,
    reasonCode: row.reasonCode,
    segments,
    termType: row.termType || '',
    exceptionReason: row.exceptionReason || '',
    sourceFields: trace.sourceFields,
    cover,
    segmentChecks,
    semantic,
    domainImpact: di,
  };
  const rec = recommend(base);
  // Tourism/transport *订单 tagged food_order → domain follow-up (do not copy tags)
  if (
    /订单$/.test(base.surface) &&
    (base.domains || []).includes('food_order') &&
    !['延误', '航班', '行李', '行程'].every((x) => !base.segments?.includes(x))
  ) {
    rec.domainFollowUp = 'REVIEW_DOMAIN_TAGS';
    rec.notes = `${rec.notes || ''}; 组合词/订单带 food_order，需复核原子词「订单」域标签是否误标（禁止机械复制）`.replace(
      /^; /,
      ''
    );
  }
  items.push({ ...base, ...rec });
}

// Exact recall probes (same entrypoints as repro-rebuild-runtime-compare)
const electronRoot = path.join(repo, 'electron_node/electron-node');
process.chdir(electronRoot);
const distRoot = path.join(electronRoot, 'dist/main/electron-node/main/src');
const { LexiconRuntimeV2 } = require(path.join(distRoot, 'lexicon-v2/lexicon-runtime-v2.js'));
const { recallSpanTopKV2 } = require(path.join(distRoot, 'lexicon-v2/recall-span-topk-v2.js'));
const { defaultGeneralProfile } = require(path.join(distRoot, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(path.join(distRoot, 'lexicon-v2/resolve-recall-enabled-fine-domains.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(distRoot, 'fw-detector/fw-config.js'));

const profile = defaultGeneralProfile();
const fwConfig = loadFwDetectorRuntimeConfig();
const rt = new LexiconRuntimeV2();
const loadSt = rt.loadFromBundleDir(candidateDir);
if (loadSt.status !== 'ok') throw new Error(`runtime load fail: ${loadSt.status}`);
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const probeDb = new Database(path.join(candidateDir, 'lexicon.sqlite'), { readonly: true });

function toneFromDb(word, n) {
  const row =
    probeDb.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(word) ||
    probeDb.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(word);
  if (!row?.tone_pinyin_key) return Array.from({ length: n }, () => 1);
  return String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
}

function exactProbe(word) {
  const t = termByWord.get(word);
  if (!t) return { found: false, top: [] };
  const syl = String(t.pinyin_key).split('|').filter(Boolean);
  if (!syl.length) return { found: false, top: [] };
  try {
    const r = recallSpanTopKV2(rt, {
      syllables: syl,
      windowText: word,
      termLength: syl.length,
      topK: 3,
      perSpanLimit: 3,
      profile,
      domainIds,
      acousticTonePattern: toneFromDb(word, syl.length),
      toneCallerEnabled: true,
    });
    return {
      found: r.hits.some((h) => h.hotword.word === word),
      top: r.hits.slice(0, 2).map((h) => ({ word: h.hotword.word, id: h.hotword.id })),
    };
  } catch (e) {
    return { found: false, error: String(e.message || e), top: [] };
  }
}

for (const it of items) {
  it.exactRecall = exactProbe(it.surface);
  it.segmentExact = it.segmentChecks.map((s) => ({ surface: s.surface, ...exactProbe(s.surface) }));
  const allSegExact = it.segmentExact.length ? it.segmentExact.every((s) => s.found) : false;
  it.latticeCoverageWithoutCompound = allSegExact
    ? 'SEGMENTS_CAN_COVER'
    : it.segments.length
      ? 'SEGMENTS_INCOMPLETE'
      : 'NO_SEGMENTS_FRAGMENT_OK';
  it.duplicatePathImpact = allSegExact
    ? 'REDUNDANT_FULL_TERM_PATH'
    : it.segments.length
      ? 'SEMANTICALLY_DISTINCT_FULL_TERM_PATH'
      : 'NO_RUNTIME_DUPLICATION';
  it.latticeCounterfactual = {
    withCompoundExact: it.exactRecall.found,
    withoutCompound: {
      allSegmentsExact: allSegExact,
      note: 'readonly approx: no Source/DB mutation; segment Exact Recall implies Lattice edges can cover span',
    },
  };
}

const { computeBundleContentHash } = await import(
  pathToFileURL(path.join(repo, 'electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs')).href
);
const candHash = computeBundleContentHash(Database, path.join(candidateDir, 'lexicon.sqlite'));
const prodHash = fs.existsSync(path.join(prodDir, 'lexicon.sqlite'))
  ? computeBundleContentHash(Database, path.join(prodDir, 'lexicon.sqlite'))
  : null;
const termCount = db.prepare(`SELECT COUNT(*) AS c FROM term`).get().c;

const specialNames = ['上线计划', '接口文档', '内科医生', '国家博物馆', '焦糖玛奇朵', '蓝莓马芬'];
const specialStatus = {};
for (const s of specialNames) {
  const inReject = items.find((x) => x.surface === s);
  if (inReject) specialStatus[s] = { status: 'IN_REJECT_BATCH', recommendation: inReject.recommendation };
  else {
    const unr = report.rows.find((r) => r.surface === s);
    specialStatus[s] = {
      status: 'NOT_IN_REJECT_BATCH',
      decision: unr?.decision || 'ABSENT',
      reasonCode: unr?.reasonCode || '',
    };
  }
}

const summary = {
  DELETE_CONFIRMED: items.filter((x) => x.recommendation === 'DELETE_CONFIRMED').map((x) => x.surface),
  KEEP_AS_EXCEPTION: items.filter((x) => x.recommendation === 'KEEP_AS_EXCEPTION').map((x) => x.surface),
  VALIDATOR_FALSE_POSITIVE: items.filter((x) => x.recommendation === 'VALIDATOR_FALSE_POSITIVE').map((x) => x.surface),
  REVIEW_DOMAIN_TAGS: items.filter((x) => x.domainFollowUp === 'REVIEW_DOMAIN_TAGS').map((x) => x.surface),
  INSUFFICIENT_EVIDENCE: items.filter((x) => x.recommendation === 'INSUFFICIENT_EVIDENCE').map((x) => x.surface),
};

const headers = [
  'surface',
  'termId',
  'sourceFile',
  'sourceRow',
  'reasonCode',
  'segments',
  'classification',
  'recommendation',
  'termTypeRecommendation',
  'exceptionReasonRecommendation',
  'compoundDomains',
  'segmentDomains',
  'domainImpact',
  'latticeCoverageWithoutCompound',
  'duplicatePathImpact',
  'validatorIssue',
  'notes',
  'domainFollowUp',
  'sourceAction',
  'compoundExact',
  'segmentsExact',
];
const esc = (v) => {
  const s = Array.isArray(v) ? v.join('|') : String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};
const lines = [headers.join(',')];
for (const it of items) {
  lines.push(
    [
      it.surface,
      it.termId,
      it.sourceFile,
      it.sourceRow,
      it.reasonCode,
      it.segments,
      it.classification,
      it.recommendation,
      it.termTypeRecommendation,
      it.exceptionReasonRecommendation,
      it.domains,
      it.segmentChecks.map((s) => `${s.surface}:${(s.domains || []).join('/')}`),
      it.domainImpact,
      it.latticeCoverageWithoutCompound,
      it.duplicatePathImpact,
      it.validatorIssue,
      it.notes,
      it.domainFollowUp,
      it.sourceAction,
      it.exactRecall?.found,
      (it.segmentExact || []).map((s) => `${s.surface}:${s.found}`).join(';'),
    ]
      .map(esc)
      .join(',')
  );
}
const csvPath = path.join(repo, 'docs/tone-v2/reject_composite_batch1_review.csv');
fs.writeFileSync(csvPath, `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(outDir, 'reject_composite_batch1_review.csv'), `${lines.join('\n')}\n`);
fs.writeFileSync(
  path.join(outDir, 'reject_composite_batch1_evidence.json'),
  JSON.stringify(
    {
      baselineOk: rejects.length === 74,
      rejectCount: rejects.length,
      reportSummary: report.summary,
      bundle: { termCount, candHash, prodHash, unchanged: candHash === prodHash && termCount === 10061 },
      counts: {
        DELETE_CONFIRMED: summary.DELETE_CONFIRMED.length,
        KEEP_AS_EXCEPTION: summary.KEEP_AS_EXCEPTION.length,
        VALIDATOR_FALSE_POSITIVE: summary.VALIDATOR_FALSE_POSITIVE.length,
        REVIEW_DOMAIN_TAGS: summary.REVIEW_DOMAIN_TAGS.length,
        INSUFFICIENT_EVIDENCE: summary.INSUFFICIENT_EVIDENCE.length,
      },
      summary,
      specialStatus,
      items,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      rejectCount: rejects.length,
      counts: {
        DELETE_CONFIRMED: summary.DELETE_CONFIRMED.length,
        KEEP_AS_EXCEPTION: summary.KEEP_AS_EXCEPTION.length,
        VALIDATOR_FALSE_POSITIVE: summary.VALIDATOR_FALSE_POSITIVE.length,
        REVIEW_DOMAIN_TAGS: summary.REVIEW_DOMAIN_TAGS.length,
        INSUFFICIENT_EVIDENCE: summary.INSUFFICIENT_EVIDENCE.length,
      },
      specialStatus,
      termCount,
      candHash,
      prodHash,
      KEEP: summary.KEEP_AS_EXCEPTION,
      FP: summary.VALIDATOR_FALSE_POSITIVE,
      INSUF: summary.INSUFFICIENT_EVIDENCE,
    },
    null,
    2
  )
);

try {
  probeDb.close();
} catch (_) {}
db.close();
