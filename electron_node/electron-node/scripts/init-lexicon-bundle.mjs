#!/usr/bin/env node
/**
 * @deprecated 请使用 build-lexicon-bundle.mjs（从 seed 迁移全量热词）
 * 本脚本仅转发以保持 npm run init:lexicon-bundle 兼容。
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const build = path.join(__dirname, 'build-lexicon-bundle.mjs');
const r = spawnSync(process.execPath, [build], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 1);
