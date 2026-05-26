#!/usr/bin/env node
/**
 * Lexicon bundle 构建 + 节点 runtime 就绪（一条龙）：
 *   1) npm rebuild better-sqlite3  — 系统 Node，供 build 脚本写 sqlite
 *   2) build-lexicon-bundle.mjs    — validate + migrate + sqlite + manifest
 *   3) @electron/rebuild           — 切回 Electron ABI，npm start 可 load 词库
 *
 * 用法与 lexicon:build 相同，例如：
 *   node scripts/lexicon/build-for-electron.mjs
 *   node scripts/lexicon/build-for-electron.mjs --input data/lexicon/pilot/p1_acceptance_seed.jsonl
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');
const buildScript = path.join(__dirname, 'build-lexicon-bundle.mjs');
const forwardArgs = process.argv.slice(2);

runCmd('npm', ['rebuild', 'better-sqlite3'], {
  cwd: electronNodeRoot,
  label: 'rebuild better-sqlite3 (system Node → lexicon:build)',
});

runCmd(process.execPath, [buildScript, ...forwardArgs], {
  cwd: electronNodeRoot,
  label: 'build lexicon bundle',
});

runCmd('npx', ['@electron/rebuild', '-f', '-w', 'better-sqlite3'], {
  cwd: electronNodeRoot,
  label: 'electron-rebuild better-sqlite3 (node runtime)',
});

console.log('[lexicon:build] done — bundle updated and Electron sqlite ready');
console.log('[lexicon:build] if node is running, restart: npm start');
