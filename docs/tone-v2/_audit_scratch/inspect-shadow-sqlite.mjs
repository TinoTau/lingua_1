import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const electronRequire = createRequire(
  path.join(root, 'electron_node/electron-node/package.json')
);

const m = JSON.parse(
  fs.readFileSync(path.join(root, 'node_runtime/lexicon/v2_shadow/manifest_v2.json'), 'utf8')
);
console.log({ schema: m.schemaVersion, tables: m.tables, checksum: String(m.checksum).slice(0, 24) });

let Database;
try {
  Database = electronRequire('better-sqlite3');
} catch (e) {
  console.error('better-sqlite3 load failed', e.message);
  process.exit(2);
}

const db = new Database(path.join(root, 'node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite'), {
  readonly: true,
});
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
console.log(
  'tables',
  tables.map((t) => t.name)
);
console.log(
  'ngramPresent',
  db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE name='term_pinyin_ngrams'`).get().c
);
for (const t of [
  'base_lexicon',
  'idiom_lexicon',
  'domain_lexicon',
  'term',
  'term_domain_tags',
  'domain_hierarchy',
]) {
  try {
    console.log(t, db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
  } catch (e) {
    console.log(t, e.message);
  }
}
db.close();
