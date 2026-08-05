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
const { resolveToneRecallReadiness } = require(
  path.join(dist, 'lexicon-v2/tone-recall-readiness.js')
);
const { buildTonePinyinKeyFromSyllablesAndPattern } = require(
  path.join(dist, 'lexicon/phonetic/tone-pinyin.js')
);

const db = new Database(path.join(repo, 'node_runtime/lexicon/v3/lexicon.sqlite'), {
  readonly: true,
});
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, 'node_runtime/lexicon/v3'));
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

console.log('我们 term', db.prepare(`SELECT * FROM term WHERE word=?`).get('我们'));
console.log(
  '我们 base tone lookup',
  db
    .prepare(
      `SELECT word,pinyin_key,tone_pinyin_key FROM base_lexicon WHERE pinyin_key=? AND tone_pinyin_key=?`
    )
    .all('wo|men', 'wo3|men0')
);
console.log(
  '我们 base plain',
  db.prepare(`SELECT word,tone_pinyin_key FROM base_lexicon WHERE pinyin_key=?`).all('wo|men')
);

for (const tones of [
  [3, 0],
  [3, 5],
  [3, 1],
  [3, 2],
  [3, 3],
  [3, 4],
]) {
  const key = buildTonePinyinKeyFromSyllablesAndPattern(['wo', 'men'], tones);
  const ready = resolveToneRecallReadiness({
    syllables: ['wo', 'men'],
    runtimeSupportsTone: true,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  const hits = recallSpanTopKV2(rt, {
    syllables: ['wo', 'men'],
    windowText: '我们',
    topK: 8,
    domainIds,
    acousticTonePattern: tones,
    toneCallerEnabled: true,
  });
  console.log({ tones, key, ready, hits: hits.hits.map((h) => h.hotword.word) });
}

// Noise window pinyin for 我闷蒸在
const noiseCases = [
  { syl: ['wo', 'men'], text: '我闷', tones: [3, 1] }, // approximate
  { syl: ['men', 'zheng'], text: '闷蒸', tones: [1, 1] },
  { syl: ['zheng', 'zai'], text: '蒸在', tones: [1, 4] },
  { syl: ['yi', 'jing'], text: '已精', tones: [3, 1] },
  { syl: ['tong', 'bu'], text: '通步', tones: [2, 4] },
  { syl: ['chu', 'fa'], text: '出发', tones: [1, 1] },
];
for (const n of noiseCases) {
  const hits = recallSpanTopKV2(rt, {
    syllables: n.syl,
    windowText: n.text,
    topK: 8,
    domainIds,
    acousticTonePattern: n.tones,
    toneCallerEnabled: true,
  });
  console.log(
    'noiseWin',
    n.text,
    n.syl.join('|'),
    'tones',
    n.tones.join(','),
    'hits',
    hits.hits.map((h) => `${h.hotword.word}@${h.hotword.tonePinyinKey}`)
  );
}
