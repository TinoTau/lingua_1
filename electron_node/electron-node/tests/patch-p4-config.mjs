#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { loadFreezeConfigSsot } from './lib/freeze-config-ssot.mjs';

const ssot = loadFreezeConfigSsot();
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
cfg.features.lexiconRuntimeV2 = {
  ...ssot.lexiconRuntimeV2,
  ...cfg.features.lexiconRuntimeV2,
};
cfg.features.fwDetector = {
  ...cfg.features.fwDetector,
  ...ssot.fwDetector,
  kenlmSpanGate: {
    ...(cfg.features.fwDetector?.kenlmSpanGate || {}),
    ...ssot.fwDetector.kenlmSpanGate,
  },
  fwMetadataSpanGate: {
    ...(cfg.features.fwDetector?.fwMetadataSpanGate || {}),
    ...ssot.fwDetector.fwMetadataSpanGate,
  },
};
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log('Patched', configPath, 'from freeze-config-ssot.json');
