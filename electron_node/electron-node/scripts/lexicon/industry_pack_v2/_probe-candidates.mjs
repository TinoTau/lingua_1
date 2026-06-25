#!/usr/bin/env node
import { createRequire } from 'module';
import path from 'path';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const db = new (require('better-sqlite3'))(
  path.join(repoRoot(), 'node_runtime/lexicon/v3/lexicon.sqlite'),
  { readonly: true }
);

const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
const termWords = new Set(db.prepare('SELECT word FROM term').all().map((r) => r.word));

let domainLex = [];
try {
  domainLex = db
    .prepare(
      `SELECT DISTINCT word, domain_id FROM domain_lexicon WHERE enabled=1 AND length(word) BETWEEN 2 AND 5 LIMIT 5`
    )
    .all();
} catch (e) {
  domainLex = [{ error: String(e) }];
}

const domainCount = db.prepare(`SELECT COUNT(DISTINCT word) AS c FROM domain_lexicon WHERE enabled=1`).get();

console.log(
  JSON.stringify(
    {
      tables: tables.map((t) => t.name),
      termCount: termWords.size,
      domainLexiconDistinctWords: domainCount.c,
      sample: domainLex,
    },
    null,
    2
  )
);
db.close();
