#!/usr/bin/env node
/**
 * Apply LexiconPatchV3 via Electron Node ABI (better-sqlite3 matches runtime).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const applyScript = path.join(root, 'scripts', 'lexicon', 'apply-lexicon-patch-v3.mjs');
const forwardArgs = process.argv.slice(2);

runCmd(electronExe, [applyScript, ...forwardArgs], {
  cwd: root,
  label: 'lexicon patch apply (electron ABI)',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
