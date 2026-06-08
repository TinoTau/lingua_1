#!/usr/bin/env node
/** Enable Weak Domain + Fuzzy Pinyin Recall flags in userData config. */
import fs from 'fs';
import path from 'path';

const configPath = path.join(
  process.env.APPDATA || '',
  'lingua-electron-node',
  'electron-node-config.json'
);
if (!fs.existsSync(configPath)) {
  console.error('Config not found:', configPath);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
cfg.features = cfg.features || {};
cfg.features.fwDetector = {
  ...cfg.features.fwDetector,
  weakDomainRecallEnabled: true,
  fuzzyPinyinRecallEnabled: true,
  useIndustryRouting: false,
};
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log('Patched weakDomainRecallEnabled + fuzzyPinyinRecallEnabled:', configPath);
