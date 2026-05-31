#!/usr/bin/env node
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
cfg.features.lexiconRuntimeV2 = {
  enabled: true,
  bundlePath: 'node_runtime/lexicon/v2_shadow',
  lruBucketCacheSize: 512,
  maxBaseCandidates: 2,
  maxDomainCandidates: 3,
  maxIdiomCandidates: 0,
  recallDiagnosticsEnabled: true,
  ...cfg.features.lexiconRuntimeV2,
};
cfg.features.fwDetector = {
  ...cfg.features.fwDetector,
  enabled: true,
  spanGateMode: 'fw_metadata_gate',
  maxSpans: 4,
  useLexiconRuntimeV2Recall: true,
  useIndustryRouting: false,
  useSentenceLevelRerank: true,
  maxSentenceCandidates: 16,
  minDeltaToReplace: 0.03,
  enableKenLMGate: true,
  kenlmSpanGate: { ...(cfg.features.fwDetector?.kenlmSpanGate || {}), enabled: false },
  fwMetadataSpanGate: {
    ...(cfg.features.fwDetector?.fwMetadataSpanGate || {}),
    enabled: true,
    maxSpans: 4,
  },
};
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
console.log('Patched', configPath);
