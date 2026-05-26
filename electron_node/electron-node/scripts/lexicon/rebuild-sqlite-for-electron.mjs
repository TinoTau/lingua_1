#!/usr/bin/env node
/**
 * 将 better-sqlite3 编译为 Electron 可用 ABI（节点 runtime / npm start）。
 * 在 lexicon:build 之后若未走 build-for-electron，或怀疑词库 load 报 NODE_MODULE_VERSION 时执行。
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const electronNodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

runCmd('npx', ['@electron/rebuild', '-f', '-w', 'better-sqlite3'], {
  cwd: electronNodeRoot,
  label: 'electron-rebuild better-sqlite3',
});

console.log('[lexicon] Electron sqlite ready — restart node (npm start) if already running');
