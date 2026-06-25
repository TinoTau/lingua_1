#!/usr/bin/env node
/** Clean phrase-like terms from word bank txt files. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { repoRoot } from '../lib/paths.mjs';
import { rejectPhraseLike } from './lib/reject-phrase-like.mjs';

const assetRoot = path.join(repoRoot(), 'electron_node/docs/lexicon-assets/industry_pack_v1');
const dirs = ['word_banks', 'word_banks_curated'];

let removed = 0;
for (const sub of dirs) {
  const dir = path.join(assetRoot, sub);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const p = path.join(dir, file);
    const kept = [];
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const w = line.trim();
      if (!w) continue;
      if (rejectPhraseLike(w)) {
        removed += 1;
        continue;
      }
      const cjk = [...w].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
      if (cjk < 2 || cjk > 5) {
        removed += 1;
        continue;
      }
      kept.push(w);
    }
    fs.writeFileSync(p, `${[...new Set(kept)].join('\n')}\n`, 'utf8');
  }
}
console.log('[clean-word-banks] removed', removed);
