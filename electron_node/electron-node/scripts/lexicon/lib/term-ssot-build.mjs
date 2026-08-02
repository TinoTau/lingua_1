/**
 * Schema V2 — term + term_domain_tags SSOT; domain_lexicon flatten + ngram fan-out.
 */

import { resolvePinyinKey, resolveTonePinyinKey } from './v2-pinyin-key.mjs';
import {
  mergeTagWeightMaps,
  normalizeDomainWeightMap,
  primaryRoutingFromWeights,
  resolveSeedPriorScore,
  tagsFromParsed,
} from './seed-domain-tags.mjs';
import { buildIndustryRouteFromDomainCanonical, materializeAliasRows, buildCanonicalRecord } from './v2-materialize-aliases.mjs';
import { slugTermId } from './term-materialize.mjs';

export function createDomainTermRegistry() {
  return new Map();
}

/**
 * Upsert one classified domain row into term SSOT registry.
 */
export function upsertDomainTermEntry(registry, { parsed, classification }) {
  const word = parsed.word?.trim();
  const pinyinKey = classification.pinyinKey ?? resolvePinyinKey({ word, pinyinField: parsed.pinyin });
  if (!word || !pinyinKey) {
    return null;
  }

  const tagIds = (classification.domainIds ?? tagsFromParsed(parsed)).filter((t) => t && t !== 'general');
  if (!tagIds.length) {
    return null;
  }

  const dedupeKey = `${word}|${pinyinKey}`;
  const priorScore = resolveSeedPriorScore(parsed);
  const weightMap = normalizeDomainWeightMap(tagIds, parsed.domainWeights ?? parsed.domain_weights ?? {});
  const tonePinyinKey = resolveTonePinyinKey({
    word,
    pinyinField: parsed.pinyin ?? '',
    tonePinyinField: parsed.tonePinyin ?? parsed.tone_pinyin ?? '',
    tonePinyinKeyField: parsed.tonePinyinKey ?? parsed.tone_pinyin_key ?? '',
  });

  const existing = registry.get(dedupeKey);
  if (!existing) {
    const termId = parsed.termId?.trim() || slugTermId(word, pinyinKey);
    registry.set(dedupeKey, {
      termId,
      word,
      pinyinKey,
      tonePinyinKey,
      priorScore,
      repairTarget: parsed.repairTarget === true ? 1 : 0,
      enabled: 1,
      source: parsed.source?.trim() || '',
      tier: 'domain',
      tagWeights: { ...weightMap },
      parsed,
      classification,
    });
    return registry.get(dedupeKey);
  }

  existing.priorScore = Math.max(existing.priorScore, priorScore);
  existing.tagWeights = mergeTagWeightMaps(existing.tagWeights, weightMap);
  existing.repairTarget = Math.max(existing.repairTarget, parsed.repairTarget === true ? 1 : 0);
  if (parsed.source?.trim()) {
    existing.source = parsed.source.trim();
  }
  return existing;
}

export function materializeDomainSsotTables(registry) {
  const termRows = [];
  const tagRows = [];
  const domainRows = [];
  const routingRows = [];
  const aliasRows = [];
  const routingSeen = new Set();

  for (const entry of registry.values()) {
    const { termId, word, pinyinKey, tonePinyinKey, priorScore, repairTarget, enabled, source, tagWeights, parsed, classification } =
      entry;

    termRows.push({
      id: termId,
      word,
      pinyin_key: pinyinKey,
      tone_pinyin_key: tonePinyinKey,
      prior_score: priorScore,
      repair_target: repairTarget,
      enabled,
      source,
      tier: 'domain',
    });

    for (const [domainId, weight] of Object.entries(tagWeights)) {
      tagRows.push({
        term_id: termId,
        domain_id: domainId,
        weight,
      });

      const canonical = buildCanonicalRecord({
        tier: 'domain',
        parsed: { ...parsed, priorScore },
        classification: { ...classification, pinyinKey },
        domainId,
      });
      canonical.id = termId;
      canonical.prior_score = priorScore;

      domainRows.push({ ...canonical, tier: 'domain' });
      const materialized = materializeAliasRows({ tier: 'domain', row: parsed, canonical });
      for (const aliasRow of materialized) {
        aliasRows.push(aliasRow);
        domainRows.push(aliasRow);
      }

      const route = buildIndustryRouteFromDomainCanonical(canonical, weight);
      if (route) {
        const routeKey = `${route.pinyin_key}\t${route.keyword}\t${route.domain_id}`;
        if (!routingSeen.has(routeKey)) {
          routingSeen.add(routeKey);
          routingRows.push(route);
        }
      }
    }

    const primary = primaryRoutingFromWeights(tagWeights);
    if (primary.domainId) {
      const route = {
        pinyin_key: pinyinKey,
        keyword: word,
        domain_id: primary.domainId,
        weight: primary.weight,
      };
      const routeKey = `${route.pinyin_key}\t${route.keyword}\t${route.domain_id}`;
      if (!routingSeen.has(routeKey)) {
        routingSeen.add(routeKey);
        routingRows.push(route);
      }
    }
  }

  return { termRows, tagRows, domainRows, routingRows, aliasRows };
}
