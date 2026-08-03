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
const m = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
console.log(JSON.stringify({
  bv: m.bundleVersion,
  atomicity: m.atomicity,
  contentHash: m.contentHash,
  checksum: m.checksum,
}, null, 2));

const db = new Database(path.join(bundle, 'lexicon.sqlite'), { readonly: true });
for (const w of ['休息', '策略', '迷你吧', '神经网络', '单元测试', '上线计划', '接口文档', '邀请函']) {
  console.log(w, db.prepare('SELECT id, pinyin_key, tone_pinyin_key FROM term WHERE word = ?').all(w));
}
console.log(
  'tables',
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((x) => x.name)
);
