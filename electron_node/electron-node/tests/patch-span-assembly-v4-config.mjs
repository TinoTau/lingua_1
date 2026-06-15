#!/usr/bin/env node
/**
 * Patch userData node-config for FW Repair V4 diagnostics flag.
 * Usage: node tests/patch-span-assembly-v4-config.mjs [true|false] [trace]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const enabled = process.argv[2] !== 'false';
const configPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'lingua-electron-node',
  'electron-node-config.json'
);

if (!fs.existsSync(configPath)) {
  console.error('Config not found:', configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.features = config.features ?? {};
config.features.fwDetector = config.features.fwDetector ?? {};
config.features.fwDetector.spanAssemblyV4Enabled = true;
config.features.fwDetector.toneTimestampOnlyEnabled = enabled;
const diagnostics = process.argv[3];
if (diagnostics === 'trace') {
  config.features.fwDetector.spanAssemblyV4DiagnosticsEnabled = true;
  config.features.fwDetector.spanAssemblyV4DiagnosticsLevel = 'trace';
  config.features.fwDetector.spanAssemblyV4DiagnosticsTargetIds = ['d001'];
}
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(
  'Patched',
  configPath,
  'pipelinePath=v4 (implicit)',
  'toneTimestampOnlyEnabled =',
  enabled,
  diagnostics === 'trace' ? 'diagnostics=trace d001' : ''
);
