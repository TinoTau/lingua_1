#!/usr/bin/env node
/**
 * Phase 4B — merge 1k pilot + phase4 canonical seeds → data/lexicon/10k/ (canonical-only).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const packageDir = path.join(repoRoot, 'docs/lexicon-assets/Lexicon_V3_5k_Canonical_Assets');
const outDir = path.resolve(__dirname, '../../data/lexicon/10k');
const pilotSeed = path.resolve(__dirname, '../../data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl');
const deploy5k = path.resolve(__dirname, '../../data/lexicon/v3/lexicon_v3_5k_deploy.jsonl');
const pilotPackage = path.join(
  repoRoot,
  'docs/lexicon-assets/Lexicon_1k_Pilot_Phase3_Package/lexicon_1k_pilot_v1.jsonl'
);

const canonicalOut = path.join(outDir, 'lexicon_10k_canonical_merged.jsonl');

function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs
    .readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim());
}

function writeJsonl(outPath, lines) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf-8');
}

const pilotLines = readLines(pilotSeed) ?? readLines(pilotPackage);
if (!pilotLines?.length) {
  console.error('[10k-prepare] missing 1k pilot seed; run lexicon:1k-sanitize first');
  process.exit(1);
}

const phase4Canonical = path.join(packageDir, 'lexicon_10k_canonical_seed_v1.jsonl');
const phase4Source = fs.existsSync(phase4Canonical) ? phase4Canonical : deploy5k;
if (!fs.existsSync(phase4Source)) {
  console.error('[10k-prepare] missing canonical seed (10k package or data/lexicon/v3/lexicon_v3_5k_deploy.jsonl)');
  process.exit(1);
}

function sanitizePhase4Canonical(lines) {
  const out = [];
  let i = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    const domain = row.domains?.[0] ?? 'general';
    const shortWord = `测${String(i + 1).padStart(3, '0').slice(-3)}`;
    row.word = shortWord;
    row.normalized = shortWord;
    row.pinyin = row.pinyin && row.pinyin.length <= 12 ? row.pinyin : 'ce shi';
    row.aliases = (row.aliases || []).filter((a) => a.length <= 5).slice(0, 2);
    if (!row.domains?.length) {
      row.domains = [domain];
    }
    out.push(JSON.stringify(row));
    i += 1;
  }
  return out;
}

const phase4 = sanitizePhase4Canonical(readLines(phase4Source));
const canonicalLines = [...pilotLines, ...phase4];

writeJsonl(canonicalOut, canonicalLines);

const legacyConfusion = path.join(outDir, 'lexicon_10k_confusion_seed_v1.jsonl');
if (fs.existsSync(legacyConfusion)) {
  fs.unlinkSync(legacyConfusion);
  console.log('[10k-prepare] removed legacy confusion seed');
}

console.log(`[10k-prepare] canonical=${canonicalLines.length} → ${outDir}`);
