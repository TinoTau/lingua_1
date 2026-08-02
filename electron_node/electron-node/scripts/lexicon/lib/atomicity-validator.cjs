/**
 * Unified Formal-Term Atomicity Validator (SSOT).
 *
 * Owner of ACCEPT / ACCEPT_EXCEPTION / REJECT_COMPOSITE / UNRESOLVED decisions.
 * No surface-specific compound blacklists. No Runtime Recall filtering.
 *
 * Modes:
 *   audit   — record decisions; never block write
 *   enforce — only ACCEPT / ACCEPT_EXCEPTION may write; REJECT/UNRESOLVED fail closed
 */

'use strict';

/** @typedef {'idiom'|'proper_noun'|'brand'|'organization'|'fixed_product'|'fixed_technical_term'|'fixed_expression'|'domain_atomic'} AtomicTermType */

/**
 * @typedef {object} AtomicityTermDraft
 * @property {string} [termId]
 * @property {string} surface
 * @property {string} [normalizedSurface]
 * @property {string} [pinyin]
 * @property {string} [tones]
 * @property {string} source
 * @property {string[]} [domains]
 * @property {AtomicTermType|string} [termType]
 * @property {string} [exceptionReason]
 * @property {string} [sourceFile]
 * @property {number|string} [sourceRow]
 * @property {string} [sourceLabel]
 */

/**
 * @typedef {object} AtomicityValidationResult
 * @property {'ACCEPT'|'ACCEPT_EXCEPTION'|'REJECT_COMPOSITE'|'UNRESOLVED'} decision
 * @property {string} reasonCode
 * @property {string} [exceptionReason]
 * @property {string[]} [segments]
 * @property {string} [detail]
 */

const EXCEPTION_TYPE_TO_REASON = {
  idiom: 'IDIOM',
  proper_noun: 'PROPER_NOUN',
  brand: 'BRAND',
  organization: 'ORGANIZATION',
  fixed_product: 'FIXED_PRODUCT',
  fixed_technical_term: 'FIXED_TECHNICAL_TERM',
  fixed_expression: 'FIXED_EXPRESSION',
  /** Domain-semantic atomicity: surface recoverable by atoms; fine-domain presence only on compound. */
  domain_atomic: 'DOMAIN_ATOMIC',
};

/** Structural business heads (role class — not full-compound blacklist). */
const ABSTRACT_BUSINESS_HEADS = new Set([
  '计划',
  '文档',
  '方案',
  '报告',
  '申请',
  '通知',
  '记录',
  '流程',
  '服务',
  '管理',
  '测试',
  '系统',
  '平台',
  '模块',
  '需求',
  '配置',
  '部署',
  '发布',
  '审核',
  '验收',
  '接口',
  '协议',
  '规范',
  '标准',
  '策略',
  '指标',
  '任务',
  '项目',
  '工程',
  '产品',
  '业务',
  '数据',
  '信息',
  '内容',
  '列表',
  '页面',
  '功能',
  '权限',
  '账号',
  '用户',
  '客户',
  '订单',
  '账单',
  '发票',
  '合同',
  '会议',
  '日程',
  '提醒',
  '消息',
  '邮件',
  '短信',
  '电话',
  '地址',
  '时间',
  '日期',
  '结果',
  '状态',
  '类型',
  '名称',
  '说明',
  '描述',
  '备注',
  '日志',
  '监控',
  '告警',
  '故障',
  '问题',
  '风险',
  '成本',
  '预算',
  '收入',
  '支出',
  '利润',
  '报表',
  '统计',
  '分析',
  '汇总',
  '明细',
  '详情',
  '概览',
  '首页',
  '入口',
  '出口',
  '通道',
  '链路',
  '网络',
  '节点',
  '集群',
  '容器',
  '镜像',
  '版本',
  '分支',
  '提交',
  '合并',
  '回滚',
  '上线',
  '下线',
  '迁移',
  '同步',
  '备份',
  '恢复',
  '导入',
  '导出',
  '上传',
  '下载',
  '安装',
  '卸载',
  '注册',
  '登录',
  '退出',
  '认证',
  '授权',
  '加密',
  '解密',
  '签名',
  '校验',
  '验证',
  '检查',
  '扫描',
  '清理',
  '优化',
  '扩容',
  '缩容',
  '限流',
  '熔断',
  '降级',
  '灰度',
  '蓝绿',
  '金丝雀',
]);

/** Structural action-like first segments (role class). */
const ACTION_LIKE_PREFIXES = new Set([
  '上线',
  '下线',
  '提交',
  '开通',
  '关闭',
  '启动',
  '停止',
  '创建',
  '删除',
  '修改',
  '更新',
  '查询',
  '搜索',
  '下载',
  '上传',
  '导出',
  '导入',
  '发送',
  '接收',
  '审批',
  '确认',
  '取消',
  '预订',
  '改签',
  '退票',
  '登机',
  '值机',
  '入住',
  '取件',
  '打包',
  '点餐',
  '下单',
  '支付',
  '退款',
  '开票',
  '打印',
  '扫描',
  '登录',
  '注册',
  '绑定',
  '解绑',
  '接入',
  '对接',
  '联调',
  '部署',
  '发布',
  '回滚',
  '迁移',
  '同步',
  '备份',
  '恢复',
  '安装',
  '配置',
  '调试',
  '测试',
  '验收',
  '评审',
  '沟通',
  '协调',
  '跟进',
  '推进',
  '落地',
  '落地',
  '排查',
  '修复',
  '处理',
  '解决',
  '跟踪',
  '监控',
  '告警',
]);

/**
 * Template / sentence-fragment markers.
 * Length ≤3: do NOT use mid-character particle classes (误伤 邀请函/迷你吧).
 * Length ≥4: phrase markers including embedded 是否/可以 etc.
 * @param {string} normalized
 * @param {string} cjk
 * @param {number} length
 * @returns {'TEMPLATE_FRAGMENT'|'SENTENCE_FRAGMENT'|null}
 */
function matchTemplateOrFragment(normalized, cjk, length) {
  if (/\{|\}|＜|＞|XX|__/.test(normalized)) {
    return 'TEMPLATE_FRAGMENT';
  }
  if (/[的了]$/.test(cjk)) {
    return 'SENTENCE_FRAGMENT';
  }

  if (length <= 3) {
    // Bare discourse particles only — not mid-word 请/吧 hits.
    if (/^(吗|呢|啊|请)$/.test(cjk)) {
      return 'SENTENCE_FRAGMENT';
    }
    // Interrogative tails: 可以吗 / 好吗 — not independent nouns like 迷你吧.
    if (/(吗|呢|啊)$/.test(cjk)) {
      return 'SENTENCE_FRAGMENT';
    }
    return null;
  }

  // Length ≥ 4: structural phrase / template markers
  if (/怎么|什么|可否|是否|需要|可以|确认一下|顺手/.test(normalized)) {
    return 'SENTENCE_FRAGMENT';
  }
  if (/^请/.test(cjk)) {
    return 'SENTENCE_FRAGMENT';
  }
  if (/(吗|呢|吧|啊)$/.test(cjk)) {
    return 'SENTENCE_FRAGMENT';
  }
  return null;
}
/**
 * @param {string} text
 * @returns {string}
 */
function cjkOnly(text) {
  return [...String(text || '')].filter((c) => /[\u4e00-\u9fff]/.test(c)).join('');
}

/**
 * @param {string} text
 * @returns {number}
 */
function cjkLen(text) {
  return cjkOnly(text).length;
}

/**
 * @param {string} surface
 * @returns {string}
 */
function normalizeSurface(surface) {
  return String(surface || '').trim();
}

/**
 * Build atom set: formal surfaces with CJK length 1–3 (independent atoms).
 * @param {Iterable<string>} surfaces
 * @returns {Set<string>}
 */
function buildAtomicSurfaceSet(surfaces) {
  const set = new Set();
  for (const s of surfaces || []) {
    const n = normalizeSurface(s);
    const len = cjkLen(n);
    if (len >= 1 && len <= 3) set.add(cjkOnly(n) || n);
  }
  return set;
}

/**
 * Find bipartitions / multipart coverings using atoms (length 1–3).
 * Prefers covers with parts of length ≥2 when possible.
 * @param {string} surfaceCjk
 * @param {Set<string>} atomSet
 * @returns {string[][]}
 */
function findAtomCoverings(surfaceCjk, atomSet) {
  const n = surfaceCjk.length;
  if (n < 4 || !atomSet || atomSet.size === 0) return [];

  /** @type {string[][][]} */
  const dp = Array.from({ length: n + 1 }, () => []);
  dp[0] = [[]];

  for (let i = 0; i < n; i++) {
    if (!dp[i].length) continue;
    for (let len = 1; len <= 3 && i + len <= n; len++) {
      const piece = surfaceCjk.slice(i, i + len);
      if (!atomSet.has(piece)) continue;
      for (const prev of dp[i]) {
        dp[i + len].push([...prev, piece]);
      }
    }
  }

  return dp[n].filter((seg) => seg.length >= 2);
}

/**
 * Prefer a single bipartition evidence row when available.
 * @param {string[][]} coverings
 * @returns {string[]|null}
 */
function pickEvidenceSegments(coverings) {
  if (!coverings.length) return null;
  const bipart = coverings.find((c) => c.length === 2 && c.every((p) => p.length >= 2));
  if (bipart) return bipart;
  const anyBi = coverings.find((c) => c.length === 2);
  if (anyBi) return anyBi;
  return coverings[0];
}

/**
 * @param {string} termType
 * @returns {string|null}
 */
function exceptionReasonCode(termType) {
  const key = String(termType || '')
    .trim()
    .toLowerCase();
  return EXCEPTION_TYPE_TO_REASON[key] || null;
}

/**
 * @param {AtomicityTermDraft} draft
 * @param {{ atomicSurfaces?: Iterable<string>|Set<string>, mode?: 'audit'|'enforce' }} [opts]
 * @returns {AtomicityValidationResult}
 */
function validateAtomicity(draft, opts = {}) {
  const surface = normalizeSurface(draft.surface);
  const normalized = normalizeSurface(draft.normalizedSurface || surface);
  const cjk = cjkOnly(normalized);
  const length = cjk.length;
  const termType = draft.termType != null ? String(draft.termType).trim() : '';
  const exceptionReason = draft.exceptionReason != null ? String(draft.exceptionReason).trim() : '';

  if (!surface || !cjk) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: 'SENTENCE_FRAGMENT',
      detail: 'empty_or_non_cjk_surface',
    };
  }

  // Explicit exception metadata (allowed for any length)
  if (termType || exceptionReason) {
    const code = exceptionReasonCode(termType);
    if (!code || !exceptionReason) {
      return {
        decision: 'REJECT_COMPOSITE',
        reasonCode: 'MISSING_EXCEPTION_METADATA',
        detail: 'termType_and_exceptionReason_both_required',
      };
    }
    return {
      decision: 'ACCEPT_EXCEPTION',
      reasonCode: code,
      exceptionReason,
    };
  }

  // Template / sentence fragment structural markers (length-aware; see matchTemplateOrFragment)
  const fragmentKind = matchTemplateOrFragment(normalized, cjk, length);
  if (fragmentKind) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: fragmentKind,
      detail: 'fragment_or_template_marker',
    };
  }

  if (length >= 6) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: 'SENTENCE_FRAGMENT',
      detail: 'cjk_length_ge_6',
    };
  }

  // Default accept short independent terms (2–3 preferred; 1 also atomic)
  if (length <= 3) {
    return {
      decision: 'ACCEPT',
      reasonCode: length <= 2 ? 'SHORT_ATOMIC' : 'ATOMIC_DEFAULT',
    };
  }

  // length 4–5: structural composite evidence via atom covering
  const atomSet =
    opts.atomicSurfaces instanceof Set
      ? opts.atomicSurfaces
      : buildAtomicSurfaceSet(opts.atomicSurfaces || []);

  // Self must not count as its own atom for covering
  const atomsForCover = new Set(atomSet);
  atomsForCover.delete(cjk);

  const coverings = findAtomCoverings(cjk, atomsForCover);
  const segments = pickEvidenceSegments(coverings);

  if (!segments) {
    // No formal-atom covering — treat as unresolved (may be proper noun / fixed product)
    return {
      decision: 'UNRESOLVED',
      reasonCode: 'UNRESOLVED_NEEDS_EXCEPTION',
      detail: 'length_4_5_without_atom_cover_or_exception',
    };
  }

  const first = segments[0];
  const last = segments[segments.length - 1];

  if (segments.length === 2 && ACTION_LIKE_PREFIXES.has(first)) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: 'ACTION_OBJECT_PHRASE',
      segments,
      detail: 'action_like_prefix_plus_object',
    };
  }

  if (segments.length === 2 && ABSTRACT_BUSINESS_HEADS.has(last)) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: 'NOUN_NOUN_BUSINESS_PHRASE',
      segments,
      detail: 'abstract_business_head',
    };
  }

  if (segments.length === 2 && ABSTRACT_BUSINESS_HEADS.has(first) && ABSTRACT_BUSINESS_HEADS.has(last)) {
    return {
      decision: 'REJECT_COMPOSITE',
      reasonCode: 'NOUN_NOUN_BUSINESS_PHRASE',
      segments,
      detail: 'business_noun_noun',
    };
  }

  // Mechanically coverable by formal atoms, but may be fixed product / proper noun
  return {
    decision: 'UNRESOLVED',
    reasonCode: 'UNRESOLVED_NEEDS_EXCEPTION',
    segments,
    detail: 'composite_of_formal_terms_needs_exception_or_reject_review',
  };
}

/**
 * @param {AtomicityValidationResult} result
 * @param {'audit'|'enforce'} mode
 * @returns {{ allowWrite: boolean, blocked: boolean, mode: string, result: AtomicityValidationResult }}
 */
function applyAtomicityMode(result, mode) {
  const m = mode === 'enforce' ? 'enforce' : 'audit';
  if (m === 'audit') {
    return { allowWrite: true, blocked: false, mode: m, result };
  }
  const ok = result.decision === 'ACCEPT' || result.decision === 'ACCEPT_EXCEPTION';
  return { allowWrite: ok, blocked: !ok, mode: m, result };
}

/**
 * @param {AtomicityValidationResult} result
 * @param {AtomicityTermDraft} draft
 * @returns {object}
 */
function toAuditRow(result, draft) {
  const surface = normalizeSurface(draft.surface);
  return {
    surface,
    termId: draft.termId || '',
    sourceFile: draft.sourceFile || '',
    sourceRow: draft.sourceRow != null ? draft.sourceRow : '',
    sourceLabel: draft.sourceLabel || draft.source || '',
    length: cjkLen(surface),
    decision: result.decision,
    reasonCode: result.reasonCode,
    segments: result.segments || [],
    termType: draft.termType || '',
    exceptionReason: draft.exceptionReason || result.exceptionReason || '',
    domains: Array.isArray(draft.domains) ? draft.domains : [],
    detail: result.detail || '',
  };
}

module.exports = {
  validateAtomicity,
  applyAtomicityMode,
  buildAtomicSurfaceSet,
  findAtomCoverings,
  toAuditRow,
  cjkLen,
  cjkOnly,
  normalizeSurface,
  EXCEPTION_TYPE_TO_REASON,
  ABSTRACT_BUSINESS_HEADS,
  ACTION_LIKE_PREFIXES,
};
