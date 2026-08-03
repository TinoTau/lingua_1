/**
 * Read-only freeze snapshot helper — SQLite table list.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
process.chdir(electronRoot);
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const bundle = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundle, 'lexicon.sqlite'), { readonly: true });
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((r) => r.name);
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
console.log(
  JSON.stringify(
    {
      tables,
      term_pinyin_ngrams: tables.includes('term_pinyin_ngrams'),
      parent_fragment_table: tables.some((t) => /parent_fragment/i.test(t)),
      atomicity: manifest.atomicity,
      bundleVersion: manifest.bundleVersion,
      checksum: manifest.checksum,
    },
    null,
    2
  )
);
