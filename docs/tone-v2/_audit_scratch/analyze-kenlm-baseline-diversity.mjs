/**
 * Quick diversity analysis for kenlm capability baseline outputs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(dir, 'kenlm_capability_baseline_2026_08_03');

function parse(line) {
  const o = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      o.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  o.push(cur);
  return o;
}

const caseLines = fs.readFileSync(path.join(outDir, 'kenlm_capability_case_summary.csv'), 'utf8').trim().split(/\r?\n/);
const candLines = fs.readFileSync(path.join(outDir, 'kenlm_capability_baseline_candidates.csv'), 'utf8').trim().split(/\r?\n/);
const cases = caseLines.slice(1).map(parse);
const cands = candLines.slice(1).map(parse);
const byCase = {};
for (const r of cands) {
  (byCase[r[0]] ||= []).push(r);
}

function analyze(suite) {
  const rows = cases.filter((r) => r[1] === suite);
  let onlyRawDup = 0;
  let withAlt = 0;
  let maxDistinct = 0;
  let maxDeltaNonZero = 0;
  for (const c of rows) {
    const texts = new Set((byCase[c[0]] || []).map((x) => x[4]));
    maxDistinct = Math.max(maxDistinct, texts.size);
    if (texts.size <= 1) onlyRawDup += 1;
    else withAlt += 1;
    if (Number(c[12]) !== 0) maxDeltaNonZero += 1;
  }
  return {
    suite,
    n: rows.length,
    onlyRawDupOrIdenticalPool: onlyRawDup,
    withDistinctAltText: withAlt,
    maxDistinctTextsPerCase: maxDistinct,
    casesWithNonZeroMaxDelta: maxDeltaNonZero,
  };
}

const report = {
  dialog_200: analyze('dialog_200'),
  noise_inventory: analyze('noise_inventory'),
  noiseDetail: cases
    .filter((r) => r[1] === 'noise_inventory')
    .map((c) => ({
      caseId: c[0],
      class: c[9],
      expectedAvail: c[7],
      distinctTexts: [...new Set((byCase[c[0]] || []).map((x) => x[4]))],
    })),
};
fs.writeFileSync(path.join(outDir, 'diversity_analysis.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
