#!/usr/bin/env node
/**
 * Wrapper: run domain-multibucket KenLM acceptance under Electron ABI + PROJECT_ROOT.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..'); // electron_node/electron-node
const repoRoot = path.resolve(root, '../..'); // lingua_1
const script = path.join(root, 'tests/experiments/run-domain-multibucket-kenlm-acceptance.cjs');
const electronBin =
  process.platform === 'win32'
    ? path.join(root, 'node_modules/electron/dist/electron.exe')
    : path.join(root, 'node_modules/electron/dist/electron');

if (!fs.existsSync(script)) {
  console.error('ACCEPTANCE_FAIL: missing', script);
  process.exit(2);
}
if (!fs.existsSync(electronBin)) {
  console.error('ACCEPTANCE_FAIL: missing local electron', electronBin);
  process.exit(2);
}

const r = spawnSync(electronBin, [script], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PROJECT_ROOT: repoRoot,
  },
});
process.exit(r.status == null ? 1 : r.status);
