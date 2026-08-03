#!/usr/bin/env node
/**
 * Parent Fragment Full Retirement — HISTORICAL schema migration tool.
 *
 * NOT a daily / production Full Rebuild entry.
 * Production content rebuild: `npm run lexicon:full-rebuild` (CSV/JSONL SSOT, no old DB copy).
 *
 * This script copies tables from an existing bundle only for one-time ngram retirement.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  V3_SCHEMA_VERSION_V3,
  v3BundleFiles,
  v3RuntimeDir,
  buildUnifiedStats,
} from './lib/lexicon-v3-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const Database = require('better-sqlite3');

const TABLES = [
  'base_lexicon',
  'idiom_lexicon',
  'domain_lexicon',
  'industry_routing_lexicon',
  'term',
  'term_domain_tags',
  'domain_hierarchy',
];

const SCHEMA_SQL = `
CREATE TABLE base_lexicon (
  id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pinyin_key, word)
);
CREATE INDEX idx_base_pinyin ON base_lexicon(pinyin_key);
CREATE INDEX idx_base_pinyin_tone ON base_lexicon(pinyin_key, tone_pinyin_key);

CREATE TABLE idiom_lexicon (
  id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pinyin_key, word)
);
CREATE INDEX idx_idiom_pinyin ON idiom_lexicon(pinyin_key);
CREATE INDEX idx_idiom_pinyin_tone ON idiom_lexicon(pinyin_key, tone_pinyin_key);

CREATE TABLE domain_lexicon (
  id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_id, word)
);
CREATE INDEX idx_domain_pinyin ON domain_lexicon(domain_id, pinyin_key);
CREATE INDEX idx_domain_pinyin_tone ON domain_lexicon(domain_id, pinyin_key, tone_pinyin_key);

CREATE TABLE industry_routing_lexicon (
  pinyin_key TEXT NOT NULL,
  keyword TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (pinyin_key, keyword, domain_id)
);

CREATE TABLE term (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  source TEXT,
  tier TEXT NOT NULL
);
CREATE INDEX idx_term_pinyin ON term(pinyin_key);
CREATE INDEX idx_term_pinyin_tone ON term(pinyin_key, tone_pinyin_key);
CREATE INDEX idx_term_word ON term(word);

CREATE TABLE term_domain_tags (
  term_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (term_id, domain_id)
);
CREATE INDEX idx_term_domain_tags_domain ON term_domain_tags(domain_id);

CREATE TABLE domain_hierarchy (
  parent_domain_id TEXT NOT NULL,
  child_domain_id TEXT NOT NULL,
  PRIMARY KEY (parent_domain_id, child_domain_id)
);
`;

const MIN_BUNDLE_VERSION = 11;
const destDir = v3RuntimeDir();
const files = v3BundleFiles(destDir);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(destDir, `_backup_pf_retirement_${stamp}`);

function die(msg) {
  console.error('[pf-schema-rebuild]', msg);
  process.exit(1);
}

if (!fs.existsSync(files.sqlitePath) || !fs.existsSync(files.manifestPath)) {
  die(`missing production bundle under ${destDir}`);
}

const oldManifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf8'));
console.log('[pf-schema-rebuild] source', {
  schemaVersion: oldManifest.schemaVersion,
  bundleVersion: oldManifest.bundleVersion,
  path: files.sqlitePath,
});

fs.mkdirSync(backupDir, { recursive: true });
for (const name of ['lexicon.sqlite', 'manifest.json', 'stats.json', 'checksum.txt']) {
  const src = path.join(destDir, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(backupDir, name));
  }
}
console.log('[pf-schema-rebuild] backup', backupDir);

const tmpPath = path.join(destDir, `lexicon.sqlite.tmp.${process.pid}`);
if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

const srcDb = new Database(files.sqlitePath, { readonly: true });
const dstDb = new Database(tmpPath);
dstDb.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
dstDb.exec(SCHEMA_SQL);

for (const table of TABLES) {
  const exists = srcDb
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table).c;
  if (!exists) die(`source missing table ${table}`);
  const cols = srcDb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const colList = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const insert = dstDb.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);
  const rows = srcDb.prepare(`SELECT ${colList} FROM ${table}`).all();
  const tx = dstDb.transaction((batch) => {
    for (const row of batch) {
      insert.run(...cols.map((c) => row[c]));
    }
  });
  tx(rows);
  console.log(`[pf-schema-rebuild] copied ${table}: ${rows.length}`);
}

const ngramLeft = dstDb
  .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='term_pinyin_ngrams'`)
  .get().c;
if (ngramLeft !== 0) die('term_pinyin_ngrams must not exist in new sqlite');

dstDb.close();
srcDb.close();

const checksumHex = crypto.createHash('sha256').update(fs.readFileSync(tmpPath)).digest('hex');
const bundleVersion = Math.max(Number(oldManifest.bundleVersion) || 0, MIN_BUNDLE_VERSION);
const buildTime = new Date().toISOString();

const tables = {
  base: countFromTmp(tmpPath, 'base_lexicon'),
  idiom: countFromTmp(tmpPath, 'idiom_lexicon'),
  domain: countFromTmp(tmpPath, 'domain_lexicon'),
  routing: countFromTmp(tmpPath, 'industry_routing_lexicon'),
  term: countFromTmp(tmpPath, 'term'),
  term_domain_tags: countFromTmp(tmpPath, 'term_domain_tags'),
  domain_hierarchy: countFromTmp(tmpPath, 'domain_hierarchy'),
};

const manifest = {
  ...oldManifest,
  schemaVersion: V3_SCHEMA_VERSION_V3,
  bundleVersion,
  buildTime,
  checksum: `sha256:${checksumHex}`,
  tables,
  parentFragmentRetirement: {
    mode: 'SCHEMA_REBUILD_NO_NGRAMS',
    retiredTable: 'term_pinyin_ngrams',
    priorSchemaVersion: oldManifest.schemaVersion,
    priorBundleVersion: oldManifest.bundleVersion,
    priorChecksum: oldManifest.checksum,
    backupDir,
  },
};
delete manifest.tables?.ngrams;

const stats = buildUnifiedStats(manifest);
stats.generatedAt = buildTime;

fs.renameSync(tmpPath, files.sqlitePath);
fs.writeFileSync(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(files.statsPath, `${JSON.stringify(stats, null, 2)}\n`);
fs.writeFileSync(files.checksumPath, `${checksumHex}\n`);

console.log('[pf-schema-rebuild] OK', {
  schemaVersion: manifest.schemaVersion,
  bundleVersion: manifest.bundleVersion,
  checksum: checksumHex,
  tables: manifest.tables,
  sqlite: files.sqlitePath,
});

function countFromTmp(sqlitePath, table) {
  const db = new Database(sqlitePath, { readonly: true });
  const c = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  db.close();
  return c;
}
