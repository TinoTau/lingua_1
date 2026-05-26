#!/usr/bin/env node
/** @deprecated Use npm run lexicon:patch-merge */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, 'lexicon', 'patch-merge.mjs');
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
