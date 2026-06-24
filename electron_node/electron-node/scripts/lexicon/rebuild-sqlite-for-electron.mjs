#!/usr/bin/env node
/**
 * Rebuild better-sqlite3 native module for Electron ABI.
 * This does NOT rebuild lexicon.sqlite (the lexicon database file).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runCmd } from './lib/run-cmd.mjs';

const electronNodeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

runCmd('npx', ['@electron/rebuild', '-f', '-w', 'better-sqlite3'], {
  cwd: electronNodeRoot,
  label: 'electron-rebuild better-sqlite3',
});

console.log('[lexicon] native rebuild complete (better-sqlite3 for Electron)');
console.log('[lexicon] NOT a lexicon DB rebuild — for DB use: lexicon:build:v2-shadow → prepare:v3-runtime');
console.log('[lexicon] restart node (npm start) if already running');
