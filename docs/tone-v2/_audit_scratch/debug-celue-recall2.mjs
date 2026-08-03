import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));

const bundle = path.join(repo, 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundle, 'lexicon.sqlite'), { readonly: true });
const row = db.prepare(`SELECT pinyin_key FROM term WHERE word = ?`).get('策略');
const pk = row.pinyin_key;
console.log('db pinyin_key', JSON.stringify(pk), [...pk].map((c) => c.codePointAt(0)));

const key = pk;
const sqlHits = db
  .prepare(`SELECT word, pinyin_key FROM base_lexicon WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?`)
  .all(key, 2);
console.log('sqlHits', sqlHits);

const syllables = key.split('|');
console.log('syllables', syllables, syllables.map((s) => [...s].map((c) => c.codePointAt(0))));

const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(bundle);
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

const r = recallSpanTopKV2(rt, {
  syllables,
  windowText: '策略',
  topK: 8,
  domainIds,
  toneCallerEnabled: false,
});
console.log('recall', r);

// compare with 休息
const xiu = db.prepare(`SELECT pinyin_key FROM term WHERE word = ?`).get('休息').pinyin_key;
const r2 = recallSpanTopKV2(rt, {
  syllables: xiu.split('|'),
  windowText: '休息',
  topK: 8,
  domainIds,
  toneCallerEnabled: false,
});
console.log('休息 recall hits', r2.hits.map((h) => h.hotword?.word));

// direct runtime method if any
if (typeof rt.lookupBaseByPinyinKey === 'function') {
  console.log('lookup', rt.lookupBaseByPinyinKey(key, 2));
}
