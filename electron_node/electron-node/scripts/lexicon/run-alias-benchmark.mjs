#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { parseCliArgs } from './lib/cli-args.mjs';
import { defaultBundleDir } from './lib/paths.mjs';
import { phase5BenchmarkDir } from './lib/phase5-paths.mjs';
import { loadJsonl, buildAliasBenchmarkReport } from './lib/phase5-benchmark-lib.mjs';
import { loadJsonlInputs } from './lib/read-jsonl.mjs';
import { parseSeedRow } from './lib/parse-rows.mjs';

const args = parseCliArgs(process.argv);
const bundleDir = path.resolve(args.bundle ?? defaultBundleDir());
const casesPath = args.cases ?? path.join(phase5BenchmarkDir(), 'alias_calibration_cases.jsonl');
const cases = loadJsonl(casesPath);

function buildAliasToCanonicalMap(hotwordsPath) {
  const map = new Map();
  if (!fs.existsSync(hotwordsPath)) {
    return map;
  }
  const { rows } = loadJsonlInputs([hotwordsPath]);
  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    if (parsed.kind !== 'canonical') {
      continue;
    }
    const word = parsed.word?.trim();
    if (!word) {
      continue;
    }
    map.set(word, word);
    map.set(word.toLowerCase(), word);
    for (const alias of parsed.aliases) {
      const a = alias?.trim();
      if (a) {
        map.set(a, word);
        map.set(a.toLowerCase(), word);
      }
    }
  }
  return map;
}

const aliasMap = buildAliasToCanonicalMap(path.join(bundleDir, 'hotwords.jsonl'));
const collisions = [];
const seenAlias = new Map();
for (const [alias, canonical] of aliasMap) {
  if (alias === canonical) {
    continue;
  }
  const prev = seenAlias.get(alias);
  if (prev && prev !== canonical) {
    collisions.push({ alias, canonicalA: prev, canonicalB: canonical });
  } else {
    seenAlias.set(alias, canonical);
  }
}

const caseResults = [];
for (const c of cases) {
  const alias = (c.alias ?? '').trim();
  const expected = (c.expectedCanonical ?? '').trim();
  const mustHit = c.mustHit !== false;
  const resolved = aliasMap.get(alias) ?? aliasMap.get(alias.toLowerCase()) ?? null;
  const hit = resolved === expected;
  const falsePositive = !mustHit && hit;
  const pass = mustHit ? hit : !hit;
  caseResults.push({ caseId: c.caseId, alias, expected, resolved, mustHit, pass, falsePositive });
}

const scanResult = { collisionCount: collisions.length, collisions };
const report = buildAliasBenchmarkReport(scanResult, caseResults);
const outPath = args.output ?? path.join(bundleDir, 'alias_benchmark_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(JSON.stringify(report, null, 2));
console.log(`[lexicon:alias-benchmark] → ${outPath}`);
process.exit(report.casesLoaded > 0 && report.alias_collision_count === 0 ? 0 : 1);
