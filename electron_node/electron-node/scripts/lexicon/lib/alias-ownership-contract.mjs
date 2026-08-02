/**
 * Alias Ownership Contract V1.0.0 — shared rules for scan-alias-legality gate.
 * SSOT: docs/lexicon-v3/ALIAS_OWNERSHIP_CONTRACT_FROZEN_V1_0_0.md
 */
import { pinyin } from 'pinyin-pro';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DENY_LIST } = require('../expansion-v1_1/terms-manifest.cjs');

/** @type {readonly string[]} */
export const LEGAL_ALIAS_TYPES = Object.freeze([
  'TRAD_SIMPLIFIED',
  'EN_ZH_MAPPING',
  'BRAND_PRODUCT',
  'ENTITY_WRITING',
  'STANDARD_ABBREV',
]);

/** P0 frozen deny pairs (alias|canonical) */
export const P0_ILLEGAL_PAIRS = new Set([
  '少病|少冰',
  '烧饼|少冰',
  '大悲|大杯',
  '小背|小杯',
  '小悲|小杯',
  '小碑|小杯',
  '钟贝|中杯',
  '鐘貝|中杯',
  '像蔡|香菜',
  '生城|生成',
  '声城|生成',
  '生陈|生成',
  '后选|候选',
  '计化|计划',
  '告诉|高速',
  '借口|接口',
  '截口|接口',
  '文当|文档',
  '文當|文档',
  '蓝美马分|蓝莓马芬',
  '深便|顺便',
  '身边|顺便',
  '高诉|高速',
  '高路|高速',
  '机厂|机场',
  '机常|机场',
  '上限|上线',
  '商线|上线',
]);

/** Near-phone surfaces (alias|canonical) */
export const P0_NEAR_PHONE_PAIRS = new Set([
  '连调|联调',
  '联掉|联调',
  '巧可力|巧克力',
  '巧克莉|巧克力',
]);

const TRAD_SIMP_PAIRS = new Set([
  '計劃|计划',
  '計畫|计划',
  '候選|候选',
  '機場|机场',
  '上線|上线',
  '連調|联调',
  '預訂|预订',
]);

export function cjkCount(text) {
  return [...text].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

export function isLatinToken(text) {
  return /^[A-Za-z0-9][A-Za-z0-9\s\-'.]*$/.test(text.trim());
}

export function pinyinKey(word) {
  const arr = pinyin(word, { toneType: 'none', type: 'array' });
  return arr.map((s) => s.toLowerCase()).join('|');
}

export function tonePinyinKey(word) {
  const arr = pinyin(word, { toneType: 'num', type: 'array' });
  return arr.join('|');
}

function syllableEditDistance(a, b) {
  const as = a.split('|');
  const bs = b.split('|');
  if (as.length !== bs.length) return Math.max(as.length, bs.length);
  let d = 0;
  for (let i = 0; i < as.length; i++) {
    if (as[i] !== bs[i]) d += 1;
  }
  return d;
}

/**
 * @param {string} aliasType
 */
export function isLegalAliasType(aliasType) {
  return LEGAL_ALIAS_TYPES.includes(aliasType);
}

/**
 * @param {{ alias: string, canonical: string, alias_type?: string }} entry
 * @returns {{ ok: true } | { ok: false, violation: string, reason: string }}
 */
export function validateAliasEntry(entry) {
  const alias = entry.alias?.trim();
  const canonical = entry.canonical?.trim();
  const aliasType = entry.alias_type?.trim();

  if (!alias || !canonical) {
    return { ok: false, violation: 'INVALID_ENTRY', reason: 'alias and canonical required' };
  }

  if (alias === canonical) {
    return { ok: false, violation: 'INVALID_ENTRY', reason: 'alias equals canonical' };
  }

  if (!aliasType) {
    return { ok: false, violation: 'MISSING_ALIAS_TYPE', reason: `alias "${alias}" missing alias_type` };
  }

  if (!isLegalAliasType(aliasType)) {
    return {
      ok: false,
      violation: 'INVALID_ALIAS_TYPE',
      reason: `alias "${alias}" has invalid alias_type "${aliasType}"`,
    };
  }

  const pairKey = `${alias}|${canonical}`;
  if (DENY_LIST.includes(alias) || DENY_LIST.includes(canonical)) {
    return { ok: false, violation: 'PHRASE_ALIAS', reason: `DENY_LIST phrase: ${alias} → ${canonical}` };
  }

  if (cjkCount(alias) > 5 || cjkCount(canonical) > 5) {
    return { ok: false, violation: 'PHRASE_ALIAS', reason: `CJK length > 5: ${alias} → ${canonical}` };
  }

  if (P0_ILLEGAL_PAIRS.has(pairKey)) {
    return { ok: false, violation: 'ASR_HOMOPHONE', reason: `P0 deny pair: ${alias} → ${canonical}` };
  }

  if (P0_NEAR_PHONE_PAIRS.has(pairKey)) {
    return { ok: false, violation: 'ASR_NEAR_PHONE', reason: `P0 near-phone pair: ${alias} → ${canonical}` };
  }

  const aliasPy = pinyinKey(alias);
  const canonPy = pinyinKey(canonical);
  const aliasTone = tonePinyinKey(alias);
  const canonTone = tonePinyinKey(canonical);
  const samePinyin = aliasPy && canonPy && aliasPy === canonPy;
  const sameTone = aliasTone && canonTone && aliasTone === canonTone;

  if (aliasType === 'EN_ZH_MAPPING') {
    const aliasLatin = isLatinToken(alias);
    const canonLatin = isLatinToken(canonical);
    if (!aliasLatin && !canonLatin) {
      return {
        ok: false,
        violation: 'INVALID_ALIAS_TYPE',
        reason: `EN_ZH_MAPPING requires Latin↔CJK: ${alias} → ${canonical}`,
      };
    }
    return { ok: true };
  }

  if (aliasType === 'TRAD_SIMPLIFIED') {
    if (!TRAD_SIMP_PAIRS.has(pairKey) && !TRAD_SIMP_PAIRS.has(`${canonical}|${alias}`)) {
      if (samePinyin && !sameTone) {
        return {
          ok: false,
          violation: 'TONE_CONFUSION',
          reason: `TRAD_SIMPLIFIED claimed but tone differs: ${alias} → ${canonical}`,
        };
      }
      if (samePinyin && P0_ILLEGAL_PAIRS.has(pairKey)) {
        return { ok: false, violation: 'ASR_HOMOPHONE', reason: `not trad/simp: ${alias} → ${canonical}` };
      }
      if (samePinyin && !['計劃', '計畫', '候選', '機場', '上線', '連調', '預訂'].some((t) => alias.includes(t) || canonical.includes(t))) {
        return {
          ok: false,
          violation: 'PINYIN_RECALL_OWNED',
          reason: `same pinyin, not verified trad/simp: ${alias} → ${canonical}`,
        };
      }
    }
    return { ok: true };
  }

  if (aliasType === 'ENTITY_WRITING' || aliasType === 'BRAND_PRODUCT' || aliasType === 'STANDARD_ABBREV') {
    if (samePinyin && aliasType !== 'BRAND_PRODUCT') {
      const toneDiff = aliasTone !== canonTone;
      if (toneDiff) {
        return {
          ok: false,
          violation: 'TONE_CONFUSION',
          reason: `${aliasType} claimed but tone mismatch: ${alias} → ${canonical}`,
        };
      }
      if (aliasType === 'ENTITY_WRITING' && pairKey !== '预定|预订') {
        return {
          ok: false,
          violation: 'PINYIN_RECALL_OWNED',
          reason: `same pinyin unlikely entity writing: ${alias} → ${canonical}`,
        };
      }
    }
    if (!samePinyin && aliasType === 'STANDARD_ABBREV' && cjkCount(alias) > 1 && cjkCount(canonical) > 1) {
      const dist = syllableEditDistance(aliasPy, canonPy);
      if (dist > 0 && dist <= 2) {
        return {
          ok: false,
          violation: 'ASR_NEAR_PHONE',
          reason: `near-phone for ABBREV: ${alias} → ${canonical}`,
        };
      }
    }
    return { ok: true };
  }

  if (samePinyin && !sameTone) {
    return { ok: false, violation: 'TONE_CONFUSION', reason: `tone mismatch: ${alias} → ${canonical}` };
  }

  if (samePinyin) {
    return { ok: false, violation: 'PINYIN_RECALL_OWNED', reason: `same pinyin: ${alias} → ${canonical}` };
  }

  const dist = syllableEditDistance(aliasPy, canonPy);
  if (dist > 0 && dist <= 1) {
    return { ok: false, violation: 'ASR_NEAR_PHONE', reason: `near-phone syllables: ${alias} → ${canonical}` };
  }

  return { ok: true };
}

/**
 * Normalize patch/manifest alias fields to typed entries.
 * @param {string} canonical
 * @param {{ aliases?: string[], aliasEntries?: Array<{alias:string,alias_type:string}> }} fields
 */
export function normalizeAliasEntries(canonical, fields = {}) {
  const out = [];
  if (Array.isArray(fields.aliasEntries)) {
    for (const e of fields.aliasEntries) {
      out.push({ alias: e.alias, canonical, alias_type: e.alias_type });
    }
    return out;
  }
  if (Array.isArray(fields.aliases)) {
    for (const a of fields.aliases) {
      out.push({ alias: a, canonical, alias_type: undefined });
    }
  }
  return out;
}

/**
 * @param {object} patch LexiconPatchV3 JSON
 */
export function scanPatchAliasLegality(patch) {
  const hits = [];
  for (const op of patch.operations || []) {
    const canonical = (op.word || op.entry?.word || '').trim();
    const fields = op.entry || op.fields || {};
    const entries = normalizeAliasEntries(canonical, fields);
    for (const entry of entries) {
      const result = validateAliasEntry(entry);
      if (!result.ok) {
        hits.push({
          patchId: patch.patchId,
          op: op.op,
          table: op.table,
          canonical,
          alias: entry.alias,
          alias_type: entry.alias_type ?? null,
          violation: result.violation,
          reason: result.reason,
        });
      }
    }
  }
  return hits;
}
