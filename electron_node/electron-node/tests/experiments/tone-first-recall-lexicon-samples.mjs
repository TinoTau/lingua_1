#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.resolve(__dirname, '../../../../node_runtime/lexicon/v3/lexicon.sqlite');

if (!fs.existsSync(DB)) {
  console.log(JSON.stringify({ error: 'DB_MISSING', db: DB }));
  process.exit(0);
}

const db = new Database(DB, { readonly: true });
const words = ['中杯', '少糖', '少冰', '烧饼', '哨兵', '蓝莓马芬', '拿铁', '热美式'];

function q(table, word) {
  return db
    .prepare(
      `SELECT word, pinyin_key, tone_pinyin_key, repair_target, source, domain_id FROM ${table} WHERE word = ?`
    )
    .all(word);
}

const out = { db: DB, samples: {}, ngram: {}, indexes: {}, explain: {} };

for (const w of words) {
  out.samples[w] = {
    base: q('base_lexicon', w),
    domain: q('domain_lexicon', w),
    idiom: q('idiom_lexicon', w),
  };
}

out.ngram = {
  shaobing: db
    .prepare(
      `SELECT fragment_text, ngram_pinyin_key, ngram_tone_pinyin_key, prior, tier, domain_id
       FROM term_pinyin_ngrams WHERE ngram_pinyin_key = 'shao|bing' LIMIT 10`
    )
    .all(),
  lanmeimafen: db
    .prepare(
      `SELECT fragment_text, ngram_pinyin_key, ngram_tone_pinyin_key, prior
       FROM term_pinyin_ngrams WHERE fragment_text LIKE '%马芬%' OR fragment_text LIKE '%蓝莓%' LIMIT 10`
    )
    .all(),
};

for (const t of ['base_lexicon', 'domain_lexicon', 'term_pinyin_ngrams']) {
  out.indexes[t] = db.prepare(`PRAGMA index_list(${t})`).all();
  out.indexes[t + '_info'] = {};
  for (const idx of out.indexes[t]) {
    out.indexes[t + '_info'][idx.name] = db.prepare(`PRAGMA index_info(${idx.name})`).all();
  }
}

out.explain = {
  plain: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM base_lexicon WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8`
    )
    .all('shao|bing', 2),
  tone_eq: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM base_lexicon WHERE tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8`
    )
    .all('shao3|bing1', 2),
  tone_only: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM base_lexicon WHERE tone_pinyin_key = ? AND enabled = 1 LIMIT 8`
    )
    .all('shao3|bing1'),
};

const outPath = path.join(__dirname, 'tone-first-recall-lexicon-samples.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
