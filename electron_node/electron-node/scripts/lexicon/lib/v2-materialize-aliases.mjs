/**
 * Lexicon V2 — expand alias rows at build time (materialized alias strategy).
 */

import { resolvePinyinKey, resolveTonePinyinKey } from './v2-pinyin-key.mjs';
import { hasCjk } from './normalize.mjs';

function slugId(prefix, text) {
  return `${prefix}-${Buffer.from(text, 'utf8').toString('hex').slice(0, 12)}`;
}

function parseAliases(raw) {
  if (Array.isArray(raw)) {
    return raw.map((a) => String(a).trim()).filter(Boolean);
  }
  return [];
}

/**
 * @param {{ tier: string, row: object, canonical: object }} input
 * @returns {object[]}
 */
export function materializeAliasRows({ tier, row, canonical }) {
  const aliases = parseAliases(row.aliases);
  const out = [];
  const canonicalWord = canonical.word;

  for (const alias of aliases) {
    if (alias === canonicalWord) {
      continue;
    }
    if (!hasCjk(alias)) {
      continue;
    }
    const pinyinKey = resolvePinyinKey({ word: alias, pinyinField: '' });
    if (!pinyinKey) {
      continue;
    }
    const tonePinyinKey = resolveTonePinyinKey({ word: alias, pinyinField: '', tonePinyinField: '', tonePinyinKeyField: '' });
    out.push({
      tier,
      id: slugId('alias', `${canonicalWord}:${alias}`),
      word: alias,
      normalized: alias,
      pinyin_key: pinyinKey,
      tone_pinyin_key: tonePinyinKey,
      prior_score: canonical.prior_score,
      repair_target: canonical.repair_target,
      enabled: canonical.enabled,
      source: canonical.source,
      aliases: '[]',
      canonical_word: canonicalWord,
      is_alias: 1,
      domain_id: canonical.domain_id ?? null,
    });
  }

  return out;
}

/**
 * @param {{ tier: string, parsed: object, classification: object, domainId?: string }} input
 */
export function buildCanonicalRecord({ tier, parsed, classification, domainId = null }) {
  const priorScore = parsed.priorScore ?? 0;
  const repairTarget = parsed.repairTarget === true ? 1 : 0;
  const id = parsed.termId ?? slugId('v2', parsed.word);
  const tonePinyinKey = resolveTonePinyinKey({
    word: parsed.word.trim(),
    pinyinField: parsed.pinyin ?? '',
    tonePinyinField: parsed.tonePinyin ?? parsed.tone_pinyin ?? '',
    tonePinyinKeyField: parsed.tonePinyinKey ?? parsed.tone_pinyin_key ?? '',
  });

  return {
    tier,
    id,
    word: parsed.word.trim(),
    normalized: parsed.normalized?.trim() || parsed.word.trim(),
    pinyin_key: classification.pinyinKey,
    tone_pinyin_key: tonePinyinKey,
    prior_score: priorScore,
    repair_target: repairTarget,
    enabled: 1,
    source: parsed.source?.trim() || '',
    aliases: JSON.stringify(parsed.aliases?.length ? parsed.aliases : [parsed.word.trim()]),
    canonical_word: null,
    is_alias: 0,
    domain_id: domainId,
  };
}

export function buildIndustryRouteFromDomainCanonical(record, tagWeight) {
  if (record.is_alias === 1 || !record.domain_id) {
    return null;
  }
  if (tagWeight == null || tagWeight <= 0) {
    throw new Error(`routing weight requires tagWeight for domain=${record.domain_id}`);
  }
  return {
    pinyin_key: record.pinyin_key,
    keyword: record.word,
    domain_id: record.domain_id,
    weight: tagWeight,
  };
}
