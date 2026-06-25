#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from '../lib/run-cmd.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const script = path.join(root, 'scripts', 'lexicon', 'industry_pack_v1', 'build-patch-v4.mjs');

runCmd(electronExe, [script, ...process.argv.slice(2)], {
  cwd: root,
  label: 'industry-pack-v1 build (electron ABI)',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
