#!/usr/bin/env node
/**
 * Run Patch E2E via Electron ABI (better-sqlite3 matches Electron, not system Node).
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const projectRoot = process.env.PROJECT_ROOT || path.resolve(root, '../../..');

const env = {
  ...process.env,
  PROJECT_ROOT: projectRoot,
  ELECTRON_RUN_AS_NODE: '1',
};

const r = spawnSync(
  'npx',
  ['electron', './node_modules/jest/bin/jest.js', '--testPathPattern=lexicon-patch-v3/patch-e2e', '--runInBand'],
  { cwd: root, env, stdio: 'inherit', shell: true }
);
process.exit(r.status === 0 ? 0 : 1);
