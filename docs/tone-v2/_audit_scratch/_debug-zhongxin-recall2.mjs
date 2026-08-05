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
  'base by pk',
  db
    .prepare(
      `SELECT id,word,pinyin_key,tone_pinyin_key,enabled,length(word) AS lw FROM base_lexicon WHERE pinyin_key=?`
    )
    .all('zhong|xin')
);
console.log(
  'base len2',
  db
    .prepare(
      `SELECT id,word,pinyin_key,enabled,length(word) AS lw FROM base_lexicon WHERE pinyin_key=? AND enabled=1 AND length(word)=?`
    )
    .all('zhong|xin', 2)
);
console.log(
  'schema',
  db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name`).all()
);

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { syllablesKey } = require(path.join(dist, 'lexicon/pinyin-index.js'));
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, 'node_runtime/lexicon/v3'));
const key = syllablesKey(['zhong', 'xin']);
console.log('syllablesKey', key);
console.log('lookupBaseByPinyin', rt.lookupBaseByPinyin?.(['zhong', 'xin']));
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(rt));
console.log(
  'lookup methods',
  proto.filter((x) => /lookup|query|base|pinyin/i.test(x))
);
for (const m of ['lookupBaseByPinyinKey', 'queryBaseByPinyin', 'getBaseByPinyin', 'lookupByPinyin']) {
  if (typeof rt[m] === 'function') {
    try {
      console.log(m, rt[m](key));
    } catch (e) {
      try {
        console.log(m, rt[m](['zhong', 'xin']));
      } catch (e2) {
        console.log(m, 'err', String(e2.message || e2));
      }
    }
  }
}
