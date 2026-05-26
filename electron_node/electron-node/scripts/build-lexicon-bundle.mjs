#!/usr/bin/env node
/**
 * @deprecated Use scripts/lexicon/build-lexicon-bundle.mjs via npm run lexicon:build
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'lexicon', 'build-for-electron.mjs');
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
