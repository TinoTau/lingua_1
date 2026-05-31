#!/usr/bin/env node
/**
 * Domain Recall 只读验证 — 直连 SQLite + 复现 recallSpanTopKV2 的 tier SQL 路径
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolvePinyinKey } from '../scripts/lexicon/lib/v2-pinyin-key.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const SQLITE = path.join(REPO, 'node_runtime', 'lexicon', 'v2_shadow', 'lexicon_v2.sqlite');
const MANIFEST = path.join(REPO, 'node_runtime', 'lexicon', 'v2_shadow', 'manifest_v2.json');

const MAX_BASE = 2;
const MAX_DOMAIN = 3;
const PER_SPAN_LIMIT = 8;

function charLen(s) {
  return [...s.trim()].length;
}

function resolveDomainIdsForRecall(primaryDomain) {
  const primary = primaryDomain?.trim();
  if (!primary || primary === 'general') return [];
  return [primary];
}

function lookupBase(db, key, termLength, limit = MAX_BASE) {
  return db
    .prepare(
      `SELECT word, is_alias, prior_score FROM base_lexicon
       WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC LIMIT ?`
    )
    .all(key, termLength, limit);
}

function lookupDomain(db, domainId, key, termLength, limit = MAX_DOMAIN) {
  if (!domainId || domainId === 'general') return [];
  return db
    .prepare(
      `SELECT word, is_alias, prior_score, domain_id FROM domain_lexicon
       WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ?
       ORDER BY prior_score DESC LIMIT ?`
    )
    .all(domainId, key, termLength, limit);
}

function simulateRecall(db, spanText, domainIds) {
  const word = spanText.trim();
  const key = resolvePinyinKey({ word, pinyinField: '' });
  const termLength = charLen(word);
  if (!key || termLength < 2) {
    return {
      pinyin_key: key,
      base_hits: 0,
      domain_hits: 0,
      base_rows: [],
      domain_rows: [],
      active_domain: domainIds.length ? domainIds.join('|') : 'base_only',
    };
  }

  const baseRows = lookupBase(db, key, termLength, PER_SPAN_LIMIT);
  const domainRows = [];
  for (const domainId of domainIds) {
    domainRows.push(...lookupDomain(db, domainId, key, termLength, PER_SPAN_LIMIT));
  }

  return {
    pinyin_key: key,
    base_hits: baseRows.length,
    domain_hits: domainRows.length,
    base_rows: baseRows,
    domain_rows: domainRows,
    active_domain: domainIds.length ? domainIds.join('|') : 'base_only',
    merged_count: Math.min(PER_SPAN_LIMIT, baseRows.length + domainRows.length),
  };
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const db = new Database(SQLITE, { readonly: true });
const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'domain_recall_test.json'), 'utf8'));

const domainIdsGeneral = resolveDomainIdsForRecall('general');
const domainIdsRestaurant = resolveDomainIdsForRecall('restaurant');

const rows = [];
let domainHitsGeneral = 0;
let domainHitsRestaurant = 0;

for (const c of suite.cases) {
  for (const span of c.probeSpans) {
    const general = simulateRecall(db, span, domainIdsGeneral);
    const restaurant = simulateRecall(db, span, domainIdsRestaurant);
    domainHitsGeneral += general.domain_hits;
    domainHitsRestaurant += restaurant.domain_hits;
    rows.push({
      caseId: c.id,
      rawText: c.rawText,
      span,
      domainIds_general: domainIdsGeneral,
      domainIds_restaurant: domainIdsRestaurant,
      activeDomain_general: general.active_domain,
      activeDomain_restaurant: restaurant.active_domain,
      pinyin_key: restaurant.pinyin_key || general.pinyin_key,
      baseCandidates_general: general.base_rows.map((r) => r.word),
      domainCandidates_general: general.domain_rows.map((r) => r.word),
      baseCandidates_restaurant: restaurant.base_rows.map((r) => r.word),
      domainCandidates_restaurant: restaurant.domain_rows.map((r) => ({
        word: r.word,
        is_alias: r.is_alias === 1,
        source: 'domain',
        domain: r.domain_id,
      })),
      domain_hits_general: general.domain_hits,
      domain_hits_restaurant: restaurant.domain_hits,
      base_hits_restaurant: restaurant.base_hits,
      mergedCandidates_restaurant: [
        ...restaurant.domain_rows.map((r) => r.word),
        ...restaurant.base_rows.map((r) => r.word),
      ].slice(0, PER_SPAN_LIMIT),
    });
  }
}

const focusWords = ['中杯', '大杯', '美式', '拿铁', '摩卡', '蓝莓马芬'];
const focusTraces = focusWords.map((word) => {
  const r = simulateRecall(db, word, domainIdsRestaurant);
  return {
    word,
    pinyin_key: r.pinyin_key,
    sql_domain: r.domain_rows,
    sql_base: r.base_rows,
    domain_hits: r.domain_hits,
  };
});

const stats = {
  runtime_domain_rows: manifest.tables?.domain_lexicon?.rowCount ?? db.prepare('SELECT COUNT(*) c FROM domain_lexicon').get().c,
  caseCount: suite.cases.length,
  spanProbeCount: rows.length,
  domain_hits_general: domainHitsGeneral,
  domain_hits_restaurant: domainHitsRestaurant,
  probes_restaurant_domain_hits_gt0: rows.filter((r) => r.domain_hits_restaurant > 0).length,
  probes_restaurant_domain_candidates_gt0: rows.filter((r) => r.domainCandidates_restaurant.length > 0).length,
};

const out = {
  timestamp: new Date().toISOString(),
  method: 'SQLite tier SQL replay (matches lexicon-runtime-v2 lookupDomainByPinyinKey / recall-span-topk-v2 collectTierCandidates)',
  code_refs: [
    'electron_node/electron-node/main/src/lexicon-v2/domain-recall-merge.ts resolveDomainIdsForRecall',
    'electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts collectTierCandidates L158-164',
    'electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts lookupDomainByPinyinKey L251-265',
  ],
  config: {
    profilePrimaryDomain_test: 'restaurant',
    profilePrimaryDomain_control: 'general',
    perSpanLimit: PER_SPAN_LIMIT,
    maxDomainCandidates: MAX_DOMAIN,
    maxBaseCandidates: MAX_BASE,
  },
  runtime: {
    sqlite: SQLITE,
    manifest_schema: manifest.schemaVersion,
    domain_lexicon: stats.runtime_domain_rows,
    domain_by_id: db.prepare('SELECT domain_id, COUNT(*) c FROM domain_lexicon GROUP BY domain_id').all(),
  },
  stats,
  focusWordTraces: focusTraces,
  rows,
};

const outPath = path.join(__dirname, 'domain-recall-verify-result.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(stats, null, 2));
console.log('Wrote', outPath);
db.close();
