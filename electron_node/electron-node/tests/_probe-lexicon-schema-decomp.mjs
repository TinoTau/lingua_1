import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const db = new Database(path.join(REPO, 'node_runtime/lexicon/v3/lexicon.sqlite'), { readonly: true });
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
console.log('term', db.prepare('PRAGMA table_info(term)').all().map((c) => c.name));
console.log(db.prepare('SELECT * FROM term LIMIT 1').get());
try {
  console.log('tags', db.prepare('PRAGMA table_info(term_domain_tags)').all().map((c) => c.name));
} catch (e) {
  console.log('no term_domain_tags', e.message);
}
const hit = db.prepare('SELECT * FROM term WHERE word = ? LIMIT 3').all('缓存');
console.log('缓存', hit);
