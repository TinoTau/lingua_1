#!/usr/bin/env node
/**
 * P2 Runtime / Recall freeze probes — fixed 10 spans, restaurant profile, no ASR.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolvePinyinKey } from '../scripts/lexicon/lib/v2-pinyin-key.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SQLITE = path.join(REPO, 'node_runtime', 'lexicon', 'v2_shadow', 'lexicon_v2.sqlite');

const PROBES = ['钟贝', '没事', '大背', '那铁', '磨卡', '蓝莓麻烦', '中杯', '美式', '拿铁', '摩卡'];
const MAX_BASE = 2;
const MAX_DOMAIN = 3;
const PER_SPAN_LIMIT = 8;

function charLen(s) {
  return [...s.trim()].length;
}

function lookupBase(db, key, termLength, limit = MAX_BASE) {
  return db
    .prepare(
      `SELECT word, is_alias, prior_score, repair_target,
              tone_pinyin_key AS tonePinyinKey
       FROM base_lexicon
       WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC LIMIT ?`
    )
    .all(key, termLength, limit);
}

function lookupDomain(db, domainId, key, termLength, limit = MAX_DOMAIN) {
  return db
    .prepare(
      `SELECT word, is_alias, prior_score, domain_id, repair_target,
              tone_pinyin_key AS tonePinyinKey
       FROM domain_lexicon
       WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC LIMIT ?`
    )
    .all(domainId, key, termLength, limit);
}

function mapRow(r, source) {
  return {
    word: r.word,
    source: r.is_alias ? `${source}_alias` : source,
    is_alias: r.is_alias === 1,
    repair_target: r.repair_target,
    tonePinyinKey: r.tonePinyinKey || null,
    domain_id: r.domain_id || undefined,
  };
}

function simulateRecall(db, spanText, domainIds) {
  const word = spanText.trim();
  const key = resolvePinyinKey({ word, pinyinField: '' });
  const termLength = charLen(word);
  if (!key || termLength < 2) {
    return { span: word, pinyinKey: key, error: 'invalid_span' };
  }

  const baseRows = lookupBase(db, key, termLength, PER_SPAN_LIMIT);
  const domainRows = [];
  for (const domainId of domainIds) {
    domainRows.push(...lookupDomain(db, domainId, key, termLength, PER_SPAN_LIMIT));
  }

  const domainHits = domainRows.length;
  const aliasHits = domainRows.filter((r) => r.is_alias === 1).length;
  const baseHits = baseRows.length;

  const merged = [];
  const seen = new Set();
  for (const r of domainRows) {
    const m = mapRow(r, 'domain');
    if (!seen.has(m.word)) {
      seen.add(m.word);
      merged.push(m);
    }
  }
  for (const r of baseRows) {
    const m = mapRow(r, 'base');
    if (!seen.has(m.word)) {
      seen.add(m.word);
      merged.push(m);
    }
  }
  const mergedCandidates = merged.slice(0, PER_SPAN_LIMIT);

  const sourceDist = mergedCandidates.reduce((acc, c) => {
    acc[c.source] = (acc[c.source] || 0) + 1;
    return acc;
  }, {});

  return {
    span: word,
    pinyinKey: key,
    tonePinyinKey: mergedCandidates.find((c) => c.tonePinyinKey)?.tonePinyinKey || null,
    base_hits: baseHits,
    domain_hits: domainHits,
    alias_hits: aliasHits,
    mergedCandidates: mergedCandidates.map((c) => c.word),
    source_distribution: sourceDist,
    active_domain: domainIds.length ? domainIds[0] : 'base_only',
    domainIds,
    candidate_detail: mergedCandidates,
  };
}

const db = new Database(SQLITE, { readonly: true });
const domainIds = ['restaurant'];
const rows = PROBES.map((span) => simulateRecall(db, span, domainIds));

const out = {
  timestamp: new Date().toISOString(),
  profile: { primaryDomain: 'restaurant' },
  perSpanLimit: PER_SPAN_LIMIT,
  maxBaseCandidates: MAX_BASE,
  maxDomainCandidates: MAX_DOMAIN,
  probes: rows,
  summary: {
    probe_count: rows.length,
    domain_hits_total: rows.reduce((s, r) => s + (r.domain_hits || 0), 0),
    probes_with_domain_hits: rows.filter((r) => (r.domain_hits || 0) > 0).length,
    all_active_domain_restaurant: rows.every((r) => r.active_domain === 'restaurant'),
  },
};

const outPath = path.join(__dirname, 'p2-freeze-probes-result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out.summary, null, 2));
console.log('Wrote', outPath);
db.close();
