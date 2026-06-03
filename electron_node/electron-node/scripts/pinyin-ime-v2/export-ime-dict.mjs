#!/usr/bin/env node
/**
 * Lexicon V3 SQLite → pinyin-ime-v2 layered IME dictionaries (build-time, read-only).
 */
import {
  resolveProjectRoot,
  resolveLexiconBundleDir,
  defaultPinyinImeV2DictDir,
} from './lib/paths.mjs';
import { exportPinyinImeV1Layer } from './lib/dict-export-core.mjs';

const args = process.argv.slice(2);
let layer = 'all';
let dictDir = defaultPinyinImeV2DictDir();

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--layer' && args[i + 1]) {
    layer = args[++i];
  } else if (a === '--out-dir' && args[i + 1]) {
    dictDir = args[++i];
  }
}

const VALID = new Set(['base', 'domain', 'target', 'all']);
if (!VALID.has(layer)) {
  console.error(`[pinyin-ime-v2-export] invalid --layer ${layer}; use base|domain|target|all`);
  process.exit(1);
}

const projectRoot = resolveProjectRoot();
if (!projectRoot) {
  console.error('[pinyin-ime-v2-export] PROJECT_ROOT missing');
  process.exit(1);
}

const bundleDir = resolveLexiconBundleDir(projectRoot);
if (!bundleDir) {
  console.error('[pinyin-ime-v2-export] lexicon bundle not found');
  process.exit(1);
}

const summary = exportPinyinImeV1Layer(bundleDir, layer, dictDir);
console.log(JSON.stringify(summary, null, 2));
