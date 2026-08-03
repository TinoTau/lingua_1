import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { slugTermId } from '../../../electron_node/electron-node/scripts/lexicon/lib/term-materialize.mjs';
import {
  resolvePinyinKey,
} from '../../../electron_node/electron-node/scripts/lexicon/lib/v2-pinyin-key.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../electron_node/electron-node');
const require = createRequire(path.join(root, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(path.resolve(root, '../../node_runtime/lexicon/v3/lexicon.sqlite'), {
  readonly: true,
});

const w = '数据库表';
const pk = resolvePinyinKey({ word: w, pinyinField: '' });
const id = slugTermId(w, pk);
console.log({ w, pk, id });
console.log('by id', db.prepare('SELECT id,word,pinyin_key FROM term WHERE id=?').get(id));
console.log('by word', db.prepare('SELECT id,word,pinyin_key FROM term WHERE word=?').get(w));

const all = db.prepare('SELECT id, word, pinyin_key FROM term').all();
const bySlug = new Map();
for (const t of all) {
  const sid = slugTermId(t.word, t.pinyin_key);
  const list = bySlug.get(sid) || [];
  list.push({ word: t.word, id: t.id, pk: t.pinyin_key, sid });
  bySlug.set(sid, list);
}
const collisions = [...bySlug.values()].filter((xs) => new Set(xs.map((x) => x.word)).size > 1);
console.log('multi-word same slug', collisions.length, collisions.slice(0, 5));

// Does prod supplemental id match slug with prod pinyin?
const prod = db.prepare('SELECT * FROM term WHERE word=?').get(w);
if (prod) {
  console.log('prod slug from prod pk', slugTermId(prod.word, prod.pinyin_key), 'prod id', prod.id);
}
db.close();
