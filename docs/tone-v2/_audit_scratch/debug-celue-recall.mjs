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
console.log('term', db.prepare(`SELECT * FROM term WHERE word = ?`).get('策略'));
console.log('base', db.prepare(`SELECT * FROM base_lexicon WHERE word = ?`).get('策略'));
console.log(
  'like',
  db.prepare(`SELECT word, pinyin_key FROM term WHERE pinyin_key LIKE 'ce|%' LIMIT 20`).all()
);

const rt = new LexiconRuntimeV2();
console.log(rt.loadFromBundleDir(bundle));
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

const variants = [
  ['ce', 'lüe'],
  ['ce', 'lue'],
  ['ce', 'lve'],
  ['ce', 'lu'],
  ['ce', 'le'],
];
for (const syl of variants) {
  const r = recallSpanTopKV2(rt, {
    syllables: syl,
    windowText: '策略',
    topK: 8,
    domainIds,
    toneCallerEnabled: false,
  });
  console.log(syl.join('|'), 'hits=', r.hits.map((h) => `${h.hotword?.word}:${h.hotword?.pinyin?.join('|')}`));
}
