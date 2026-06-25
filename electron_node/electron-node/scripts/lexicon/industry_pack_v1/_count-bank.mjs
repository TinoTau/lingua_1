import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';
import { loadTermIndex } from './lib/term-index.mjs';

const require = createRequire(import.meta.url);
const dir = path.join(repoRoot(), 'electron_node/docs/lexicon-assets/industry_pack_v1/word_banks');
const seen = new Set();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
  for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    const w = line.trim();
    if (w) seen.add(w);
  }
}
const sqlite = path.join(repoRoot(), 'node_runtime/lexicon/v3/lexicon.sqlite');
const idx = loadTermIndex(sqlite);
const existing = idx ? new Set(idx.byWord.keys()) : new Set();
let newCount = 0;
for (const w of seen) {
  if (!existing.has(w)) newCount += 1;
}
console.log({ bankUnique: seen.size, existing: existing.size, newCandidates: newCount });
