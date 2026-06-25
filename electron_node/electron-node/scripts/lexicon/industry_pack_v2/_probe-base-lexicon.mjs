#!/usr/bin/env node
import { createRequire } from 'module';
import path from 'path';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const db = new (require('better-sqlite3'))(
  path.join(repoRoot(), 'node_runtime/lexicon/v3/lexicon.sqlite'),
  { readonly: true }
);
const termWords = new Set(db.prepare('SELECT word FROM term').all().map((r) => r.word));
const tables = db
  .prepare(`SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all();
console.log(JSON.stringify({ terms: termWords.size, tables: tables.map((t) => t.name) }, null, 2));
db.close();
