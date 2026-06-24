#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const importScript = path.join(root, 'scripts', 'lexicon', 'lexicon-patch-import-v4.mjs');

runCmd(electronExe, [importScript, ...process.argv.slice(2)], {
  cwd: root,
  label: 'lexicon patch import v4 (electron ABI)',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
