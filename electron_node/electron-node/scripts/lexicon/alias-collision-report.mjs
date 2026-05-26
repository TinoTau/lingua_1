#!/usr/bin/env node
/**
 * Offline alias collision scan (canonical seed / bundle hotwords).
 */
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir, resolveInputFiles } from './lib/paths.mjs';
import { loadJsonlInputs } from './lib/read-jsonl.mjs';
import { parseSeedRow } from './lib/parse-rows.mjs';

const args = parseCliArgs(process.argv);
const bundleDir = path.resolve(args.bundle ?? defaultBundleDir());
const input = args.input;

function scanSeedRows(rows) {
  const aliasToCanonical = new Map();
  const collisions = [];

  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    if (parsed.kind !== 'canonical') {
      continue;
    }
    const word = parsed.word?.trim();
    if (!word) {
      continue;
    }
    for (const alias of parsed.aliases) {
      const trimmed = alias?.trim();
      if (!trimmed) {
        continue;
      }
      const existing = aliasToCanonical.get(trimmed);
      if (existing && existing !== word) {
        collisions.push({ alias: trimmed, canonicalA: existing, canonicalB: word });
      } else {
        aliasToCanonical.set(trimmed, word);
      }
    }
  }

  return { aliasCount: aliasToCanonical.size, collisions };
}

function scanHotwordsJsonl(hotwordsPath) {
  const lines = fs.readFileSync(hotwordsPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line, i) => ({ file: hotwordsPath, line: i + 1, row: JSON.parse(line) }));
  return scanSeedRows(rows);
}

let report;
if (input) {
  const { rows } = loadJsonlInputs(resolveInputFiles(input));
  report = scanSeedRows(rows);
  report.source = path.resolve(input);
} else {
  const hotwordsPath = path.join(bundleDir, 'hotwords.jsonl');
  if (!fs.existsSync(hotwordsPath)) {
    console.error('[lexicon:alias-report] missing hotwords.jsonl; pass --input seed dir');
    process.exit(1);
  }
  report = scanHotwordsJsonl(hotwordsPath);
  report.source = bundleDir;
}

report.ok = report.collisions.length === 0;
report.collisionCount = report.collisions.length;

const outPath = args.output ?? path.join(bundleDir, 'alias_collision_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(JSON.stringify(report, null, 2));
console.log(`[lexicon:alias-report] → ${outPath}`);
process.exit(report.ok ? 0 : 1);
