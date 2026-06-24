#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const script = path.join(root, 'scripts', 'lexicon', 'run-homophone-variant-cleanup.mjs');

runCmd(electronExe, [script], {
  cwd: root,
  label: 'homophone variant cleanup (electron ABI)',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
