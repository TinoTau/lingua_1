/**
 * Lexicon V2 shadow build — stats + rejected_v2.jsonl.
 */

import fs from 'fs';
import path from 'path';

export function initRejectStats() {
  return {
    invalid_json: 0,
    confusion_row: 0,
    disabled: 0,
    empty_word: 0,
    latin_deferred_v1: 0,
    non_cjk: 0,
    unknown_domain: 0,
    missing_pinyin_key: 0,
    common5_deferred: 0,
    base_len_invalid: 0,
    idiom_len_invalid: 0,
    domain_missing_id: 0,
    domain_len_invalid: 0,
    one_char: 0,
    phrase_too_long: 0,
    four_char_non_idiom: 0,
    unclassified: 0,
    invalid_prior: 0,
  };
}

export function bumpRejectStats(stats, code) {
  if (!code) {
    return;
  }
  stats[code] = (stats[code] ?? 0) + 1;
}

export function computeBucketStats(rows, keyField = 'pinyin_key') {
  const buckets = new Map();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) {
      continue;
    }
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let maxBucketSize = 0;
  let maxBucketKey = '';
  for (const [key, size] of buckets) {
    if (size > maxBucketSize) {
      maxBucketSize = size;
      maxBucketKey = key;
    }
  }
  return {
    pinyinKeyCount: buckets.size,
    maxBucketSize,
    maxBucketKey,
  };
}

export function buildShadowStats({
  baseRows,
  idiomRows,
  domainRows,
  routingRows,
  aliasRows,
  termRows = [],
  tagRows = [],
  rejected,
  rejectStats,
  seedRootRel,
  seedInputRels,
}) {
  const baseCanonical = baseRows.filter((r) => r.is_alias === 0);
  const idiomCanonical = idiomRows.filter((r) => r.is_alias === 0);
  const domainCanonical = domainRows.filter((r) => r.is_alias === 0);

  const byDomain = {};
  for (const row of domainCanonical) {
    byDomain[row.domain_id] = (byDomain[row.domain_id] ?? 0) + 1;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    seed_root: seedRootRel ?? '',
    seed_inputs: seedInputRels ?? [],
    tables: {
      base_lexicon: {
        rowCount: baseRows.length,
        canonicalCount: baseCanonical.length,
        aliasCount: aliasRows.filter((r) => r.tier === 'base').length,
        ...computeBucketStats(baseRows),
      },
      idiom_lexicon: {
        rowCount: idiomRows.length,
        canonicalCount: idiomCanonical.length,
        aliasCount: aliasRows.filter((r) => r.tier === 'idiom').length,
        ...computeBucketStats(idiomRows),
      },
      domain_lexicon: {
        rowCount: domainRows.length,
        canonicalCount: domainCanonical.length,
        aliasCount: aliasRows.filter((r) => r.tier === 'domain').length,
        byDomain,
        ...computeBucketStats(domainRows),
      },
      industry_routing_lexicon: {
        rowCount: routingRows.length,
        ...computeBucketStats(routingRows),
      },
      term: {
        rowCount: termRows.length,
        canonicalCount: termRows.length,
      },
      term_domain_tags: {
        rowCount: tagRows.length,
      },
    },
    rejectedCount: rejected.length,
    rejectStats,
  };
}

export function writeRejectedJsonl(rejected, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = rejected.map((r) => JSON.stringify(r)).join('\n') + (rejected.length ? '\n' : '');
  fs.writeFileSync(outPath, body, 'utf-8');
}

export function writeStatsJson(stats, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(stats, null, 2), 'utf-8');
}
