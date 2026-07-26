import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.resolve(__dirname, '../../../electron_node/electron-node/package.json')
);
const Database = require('better-sqlite3');
const sqlitePath = path.resolve(__dirname, '../../../node_runtime/lexicon/v3/lexicon.sqlite');
const db = new Database(sqlitePath, { readonly: true });

const plans = {
  base_plain: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id, pinyin_key, word FROM base_lexicon WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ? ORDER BY prior_score DESC LIMIT ?`
    )
    .all('na|tie', 2, 2),
  base_tone: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM base_lexicon WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? ORDER BY prior_score DESC LIMIT ?`
    )
    .all('na|tie', 'na2|tie3', 2, 2),
  domain_tone: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM domain_lexicon WHERE domain_id = ? AND pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? ORDER BY prior_score DESC LIMIT ?`
    )
    .all('coffee', 'na|tie', 'na2|tie3', 2, 2),
  ngram: db
    .prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM term_pinyin_ngrams WHERE ngram_pinyin_key = ? AND enabled = 1 ORDER BY prior DESC LIMIT ?`
    )
    .all('na|tie', 12),
};

const indexes = db
  .prepare(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('base_lexicon','domain_lexicon','term_pinyin_ngrams','idiom_lexicon') ORDER BY tbl_name, name`
  )
  .all();

const out = {
  sqlitePath,
  plans,
  indexes,
  pragma: {
    journal_mode: db.pragma('journal_mode', { simple: true }),
    synchronous: db.pragma('synchronous', { simple: true }),
    cache_size: db.pragma('cache_size', { simple: true }),
  },
};

const outPath = path.join(__dirname, 'sqlite_explain_plans.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
db.close();
