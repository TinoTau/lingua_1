#!/usr/bin/env node
/**
 * V3 runtime gate via Electron Node ABI (better-sqlite3 matches lexicon:rebuild-sqlite).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const gateScript = path.join(root, 'scripts', 'lexicon', 'run-gate-v3-runtime.mjs');

runCmd(electronExe, [gateScript, ...process.argv.slice(2)], {
  cwd: root,
  label: 'gate v3 runtime bundle',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
