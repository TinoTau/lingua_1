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

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { getLexiconRuntimeV2Config } = require(
  path.join(dist, 'lexicon-v2/lexicon-runtime-v2-config.js')
);

const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, 'node_runtime/lexicon/v3'));
console.log('cfg', getLexiconRuntimeV2Config());
for (const lim of [1, 2, 3, 5, 8, 20, 50]) {
  const rows = rt.lookupBaseByPinyinKey('zhong|xin', 2, lim);
  console.log('lim', lim, 'n', rows.length, rows.map((r) => r.word || r.hotword?.word || r.id));
}
const t = rt.lookupTier?.('zhong|xin', 2, ['bakery', 'coffee', 'tech_ai'], 8);
console.log('lookupTier', t);
