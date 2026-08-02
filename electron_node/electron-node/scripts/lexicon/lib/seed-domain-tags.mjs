/**
 * MultiDomain seed — domain_tags / domain_weights / prior defaults (Schema V2 SSOT).
 */

export function resolveSeedPriorScore(parsed) {
  const raw = parsed.priorScore ?? parsed.prior_score;
  if (raw !== undefined && raw !== null && Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return Number(raw);
  }
  const source = String(parsed.source ?? '');
  if (source.includes('homophone_variant')) {
    return 0.35;
  }
  return 0.85;
}

export function normalizeDomainWeightMap(tags, rawWeights = {}) {
  const weights = {};
  for (const tag of tags) {
    const value = rawWeights?.[tag];
    weights[tag] = value != null && Number(value) > 0 ? Number(value) : 1.0;
  }
  return weights;
}

export function primaryRoutingFromWeights(weights) {
  let domainId = '';
  let weight = 1.0;
  for (const [tag, value] of Object.entries(weights)) {
    if (value > weight || !domainId) {
      domainId = tag;
      weight = value;
    }
  }
  return { domainId, weight };
}

export function mergeTagWeightMaps(existing, incoming) {
  const merged = { ...existing };
  for (const [tag, weight] of Object.entries(incoming)) {
    merged[tag] = Math.max(merged[tag] ?? 0, weight);
  }
  return merged;
}

export function tagsFromParsed(parsed) {
  if (Array.isArray(parsed.domainTags) && parsed.domainTags.length) {
    return parsed.domainTags.filter((t) => typeof t === 'string' && t.trim());
  }
  if (Array.isArray(parsed.domains) && parsed.domains.length) {
    return parsed.domains.filter((t) => typeof t === 'string' && t.trim() && t !== 'general');
  }
  if (typeof parsed.domain === 'string' && parsed.domain.trim() && parsed.domain !== 'general') {
    return [parsed.domain.trim()];
  }
  return [];
}
