#!/usr/bin/env node
/**
 * V2 shadow build via Electron Node ABI (better-sqlite3 matches lexicon:rebuild-sqlite).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const buildScript = path.join(root, 'scripts', 'lexicon', 'build-lexicon-v2-shadow.mjs');
const forwardArgs = process.argv.slice(2);

runCmd(electronExe, [buildScript, ...forwardArgs], {
  cwd: root,
  label: 'build v2 shadow bundle',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

console.log('[lexicon:build:v2-shadow] Electron sqlite ABI unchanged — restart node if running');
