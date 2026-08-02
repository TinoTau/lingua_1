import { normalizeWord, coerceEnabled } from './normalize.mjs';

export function inferRowKind(row) {
  if (row.type === 'confusion') {
    return 'confusion';
  }
  if (row.type === 'canonical_term') {
    return 'canonical';
  }
  const term = (row.term ?? row.word ?? '').trim();
  const replacement = (row.replacement ?? row.word ?? term).trim();
  if (term && replacement && term !== replacement) {
    return 'confusion';
  }
  return 'canonical';
}

export function parseCanonicalRow(row) {
  const word = (row.word ?? row.term ?? row.replacement ?? '').trim();
  const domainTags = Array.isArray(row.domain_tags)
    ? row.domain_tags
    : Array.isArray(row.domainTags)
      ? row.domainTags
      : undefined;
  const domainWeights = row.domain_weights ?? row.domainWeights ?? undefined;
  const domains = domainTags ?? row.domains;
  return {
    kind: 'canonical',
    termId: row.termId ?? row.id ?? null,
    word,
    normalized: row.normalized?.trim() || normalizeWord(word),
    pinyin: row.pinyin ?? '',
    tonePinyin: row.tonePinyin ?? row.tone_pinyin ?? '',
    tonePinyinKey: row.tonePinyinKey ?? row.tone_pinyin_key ?? '',
    domainTags,
    domainWeights,
    domains,
    domain: row.domain,
    priorScore: row.priorScore ?? row.prior_score,
    frequency: row.frequency,
    priority: row.priority,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    repairTarget: row.repairTarget ?? row.repair_target,
    enabled: coerceEnabled(row.enabled),
    source: row.source ?? '',
    license: row.license ?? '',
    importBatch: row.importBatch ?? '',
    normalizedBy: row.normalizedBy ?? '',
    reviewStatus: row.reviewStatus ?? '',
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

export function parseSeedRow(entry) {
  if (entry.parseError) {
    return { kind: 'invalid', parseError: entry.parseError };
  }
  const kind = inferRowKind(entry.row);
  if (kind === 'confusion') {
    return { kind, ...parseCanonicalRow(entry.row), file: entry.file, line: entry.line };
  }
  return { kind, ...parseCanonicalRow(entry.row), file: entry.file, line: entry.line };
}
