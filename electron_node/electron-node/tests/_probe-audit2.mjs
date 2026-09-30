import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = 'd:\\Programs\\github\\lingua_1';
const DIST = path.join(PROJECT_ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const log = [];
try {
  log.push('start');
  const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
  log.push('lexicon');
  const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
  log.push('profile');
  const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
  log.push('recall');
  const { loadPinyinImeV2RuntimeConfig } = require(path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js'));
  log.push('imeConfig');
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(path.join(DIST, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js'));
  log.push('dictLoad');
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), { enabledDomains: imeConfig.enabledDomains });
  log.push('dict ok');
  const { loadFwDetectorRuntimeConfig } = require(path.join(DIST, 'fw-detector/fw-config.js'));
  log.push('fw');
  const { isFuzzyPinyinRecallEnabled } = require(path.join(DIST, 'lexicon-v2/lexicon-fw-recall-config.js'));
  log.push('fuzzy');
  const CONTROLLED = path.join(PROJECT_ROOT, 'docs/user_correction/model3/retry_region_controlled_cases.csv');
  log.push('read csv ' + fs.existsSync(CONTROLLED));
  fs.writeFileSync(path.join(PROJECT_ROOT, 'docs/user_correction/model3/_audit_probe2.txt'), log.join('\n'));
  console.log('OK', log.join(','));
} catch (e) {
  log.push('ERR ' + e.stack);
  fs.writeFileSync(path.join(PROJECT_ROOT, 'docs/user_correction/model3/_audit_probe2.txt'), log.join('\n'));
  console.error('FAIL', e);
  process.exit(1);
}
