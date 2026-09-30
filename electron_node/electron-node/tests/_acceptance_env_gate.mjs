/**
 * Acceptance-only env gate: Lexicon + better-sqlite3 + real table probe.
 * No production code change.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const lexDir = path.join(repo, 'node_runtime', 'lexicon', 'v3');
const manifestPath = path.join(lexDir, 'manifest.json');

const out = {
  NODE_VERSION: process.version,
  NODE_MODULE_VERSION: process.versions.modules,
  LEXICON_DIR: lexDir,
  LEXICON_RUNTIME_OK: false,
  SQLITE_NATIVE_OK: false,
  RECALL_RUNTIME_OK: false,
  AUTHORITATIVE_LEXICON_ID: null,
  AUTHORITATIVE_LEXICON_PATH: null,
  SCHEMA: null,
  error: null,
};

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  out.AUTHORITATIVE_LEXICON_ID = `bundleTag=${manifest.bundleTag};bundleVersion=${manifest.bundleVersion};checksum=${manifest.checksum}`;
  out.SCHEMA = manifest.schemaVersion;
  const candidates = [
    path.join(lexDir, 'lexicon.sqlite'),
    path.join(lexDir, 'lexicon.db'),
    path.join(lexDir, 'hotwords.sqlite'),
  ];
  const dbPath = candidates.find((c) => fs.existsSync(c));
  if (!dbPath) throw new Error('lexicon_db_not_found:' + candidates.join('|'));
  out.AUTHORITATIVE_LEXICON_PATH = dbPath;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  out.SQLITE_NATIVE_OK = true;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  out.tables = tables;

  const counts = {};
  for (const t of ['base_lexicon', 'idiom_lexicon', 'domain_lexicon', 'industry_routing_lexicon']) {
    if (!tables.includes(t)) continue;
    counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  }
  out.counts = counts;

  let probeWord = null;
  if (tables.includes('base_lexicon')) {
    const row = db.prepare('SELECT word FROM base_lexicon WHERE length(word) >= 1 LIMIT 1').get();
    probeWord = row?.word ?? null;
  }
  out.probeWord = probeWord;
  db.close();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  out.LEXICON_RUNTIME_OK = total > 0;
  out.RECALL_RUNTIME_OK = out.LEXICON_RUNTIME_OK && out.SQLITE_NATIVE_OK && Boolean(probeWord);
  if (!out.LEXICON_RUNTIME_OK) out.error = 'empty_lexicon_tables';
} catch (e) {
  out.error = String(e.message || e);
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.LEXICON_RUNTIME_OK && out.SQLITE_NATIVE_OK && out.RECALL_RUNTIME_OK ? 0 : 1);
