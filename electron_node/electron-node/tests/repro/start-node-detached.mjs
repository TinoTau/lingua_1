#!/usr/bin/env node
/** Fast detached electron start — exits immediately after spawn. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { killPort, PROJECT_ROOT } from './lib/asr-repro-utils.mjs';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.PROJECT_ROOT || PROJECT_ROOT;
const electronNodeDir = path.join(root, 'electron_node', 'electron-node');
const electronExe = path.join(
  electronNodeDir,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
);

if (!fs.existsSync(electronExe)) {
  console.error('MISSING', electronExe);
  process.exit(1);
}

const argvPort = parseInt(process.argv[2] || '', 10);
const port =
  Number.isFinite(argvPort) && argvPort > 0
    ? argvPort
    : parseInt(process.env.TEST_SERVER_PORT || process.env.LINGUA_TEST_SERVER_PORT || '5020', 10);

// KEEP_ASR=1: do not kill ASR when only restarting the node test-server (Phase A gate flip).
const keepAsr = process.env.LINGUA_KEEP_ASR === '1';
if (!keepAsr) killPort(6007);
killPort(port);
// Legacy default — clear leftover listeners if prior runs used 5020 while we bind elsewhere.
if (port !== 5020) killPort(5020);

const logPath = path.join(electronNodeDir, 'logs', 'storm-repro-electron.log');
const logFd = fs.openSync(logPath, 'a');
// ELECTRON_RUN_AS_NODE may be set when the acceptance runner itself is launched via
// electron.exe for ABI. The real Electron app must NOT inherit it — otherwise
// `app.whenReady` is undefined and the test-server port never binds.
const childEnv = { ...process.env, PROJECT_ROOT: root, NODE_ENV: 'production' };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExe, ['.'], {
  cwd: electronNodeDir,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: childEnv,
});
child.unref();
fs.closeSync(logFd);
console.log('STARTED electron pid', child.pid);
console.log('LOG', logPath);
console.log('ROOT', root);
console.log('PORT', port);
console.log('LINGUA_KEEP_ASR', keepAsr ? '1' : '0');
console.log('ELECTRON_RUN_AS_NODE_STRIPPED', !('ELECTRON_RUN_AS_NODE' in childEnv));
