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

killPort(6007);
killPort(5020);

const logPath = path.join(electronNodeDir, 'logs', 'storm-repro-electron.log');
const logFd = fs.openSync(logPath, 'a');
const child = spawn(electronExe, ['.'], {
  cwd: electronNodeDir,
  detached: true,
  stdio: ['ignore', logFd, logFd],
  env: { ...process.env, PROJECT_ROOT: root, NODE_ENV: 'production' },
});
child.unref();
fs.closeSync(logFd);
console.log('STARTED electron pid', child.pid);
console.log('LOG', logPath);
console.log('ROOT', root);
