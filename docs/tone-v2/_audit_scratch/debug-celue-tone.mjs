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
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(bundle);
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

function tryWord(word, tonePattern) {
  const row = db.prepare(`SELECT pinyin_key, tone_pinyin_key FROM term WHERE word = ?`).get(word);
  const syllables = row.pinyin_key.split('|');
  const r = recallSpanTopKV2(rt, {
    syllables,
    windowText: word,
    topK: 8,
    domainIds,
    acousticTonePattern: tonePattern,
    toneCallerEnabled: true,
  });
  console.log({
    word,
    syllables,
    tonePattern,
    toneKey: row.tone_pinyin_key,
    hits: r.hits.map((h) => h.hotword?.word),
    toneExact: r.toneExactHitCount,
    readiness: r.toneRecallReadiness,
    queryTone: r.queryTonePinyinKey,
  });
}

tryWord('休息', [1, 1]);
tryWord('策略', [4, 4]);
tryWord('策略', ['4', '4']);
tryWord('策略', [4, 0]);
tryWord('测试', [4, 4]);
