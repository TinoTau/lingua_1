#!/usr/bin/env node
/**
 * Phase 5 — merge 2k canonical + domain-balanced stub → data/lexicon/5k/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base2k = path.resolve(__dirname, '../../data/lexicon/10k/lexicon_10k_canonical_merged.jsonl');
const outDir = path.resolve(__dirname, '../../data/lexicon/5k');
const outPath = path.join(outDir, 'lexicon_5k_canonical_merged.jsonl');

const domains = ['travel', 'transport', 'restaurant', 'tech_ai'];
const perDomain = 750;

function readLines(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8').split(/\r?\n/).filter((l) => l.trim());
}

if (!fs.existsSync(base2k)) {
  console.error('[5k-prepare] run lexicon:10k-prepare first');
  process.exit(1);
}

const baseLines = readLines(base2k);
const stubs = [];
let n = 0;
for (const domain of domains) {
  for (let i = 0; i < perDomain; i++) {
    const word = `扩${domain.slice(0, 1)}${String(n + 1).padStart(4, '0')}`;
    stubs.push(
      JSON.stringify({
        type: 'canonical_term',
        termId: `p5k-${domain}-${i}`,
        word,
        normalized: word,
        pinyin: 'kuo ci',
        domains: [domain],
        priorScore: 0.55 + (i % 10) * 0.03,
        aliases: [],
        source: 'phase5k_stub_v1',
        enabled: true,
      })
    );
    n += 1;
  }
}

const merged = [...baseLines, ...stubs];
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, merged.join('\n') + '\n', 'utf-8');
console.log(`[5k-prepare] canonical=${merged.length} → ${outPath}`);
