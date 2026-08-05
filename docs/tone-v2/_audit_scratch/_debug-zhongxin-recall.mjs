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

const db = new Database(path.join(repo, 'node_runtime/lexicon/v3/lexicon.sqlite'), {
  readonly: true,
});
console.log(
  'by pk',
  db.prepare(`SELECT id,word,pinyin_key,tone_pinyin_key,enabled FROM term WHERE pinyin_key=?`).all('zhong|xin')
);
console.log(
  'pinyin tables',
  db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%pinyin%'`).all()
);
try {
  console.log(
    'index',
    db.prepare(`SELECT * FROM term_pinyin_index WHERE pinyin_key=? LIMIT 10`).all('zhong|xin')
  );
} catch (e) {
  console.log('index err', String(e.message || e));
}

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));

const rt = new LexiconRuntimeV2();
console.log('load', rt.loadFromBundleDir(path.join(repo, 'node_runtime/lexicon/v3')));
const fw = loadFwDetectorRuntimeConfig();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
const profile = defaultGeneralProfile();
console.log('domainIds n', domainIds.length, domainIds.slice(0, 8));
console.log('profile', profile?.id || profile);

for (const topK of [2, 8, 20]) {
  const r = recallSpanTopKV2(rt, {
    syllables: ['zhong', 'xin'],
    windowText: '忠心',
    topK,
    domainIds,
    profile,
    toneCallerEnabled: false,
  });
  console.log('hits', topK, r.hits.map((h) => `${h.hotword.word}:${h.candidateScore}`), {
    keys: Object.keys(r),
    debug: r.debug || r.diagnostics || null,
  });
}

// base-only / empty domains?
const r2 = recallSpanTopKV2(rt, {
  syllables: ['zhong', 'xin'],
  windowText: '忠心',
  topK: 8,
  domainIds: [],
  profile,
  toneCallerEnabled: false,
});
console.log('empty domains', r2.hits.map((h) => h.hotword.word));

const r3 = recallSpanTopKV2(rt, {
  syllables: ['zhong', 'xin'],
  windowText: '忠心',
  topK: 8,
  domainIds: ['general'],
  profile,
  toneCallerEnabled: false,
});
console.log('general', r3.hits.map((h) => h.hotword.word));
