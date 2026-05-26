#!/usr/bin/env node
/**
 * Evaluate false repair / repair precision from golden labels + batch result.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const phase5Golden = path.join(
  repoRoot,
  'electron_node/docs/lexicon-assets/Lexicon_Phase5_Evaluation_Package/benchmark/dialog_200_golden_labels.jsonl'
);
const goldenPath = phase5Golden;
const batchPath = path.join(__dirname, '../../tests/dialog-200-batch-result.json');

function loadGolden() {
  if (!fs.existsSync(goldenPath)) {
    return [];
  }
  return fs
    .readFileSync(goldenPath, 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function loadBatchById() {
  if (!fs.existsSync(batchPath)) {
    return new Map();
  }
  const data = JSON.parse(fs.readFileSync(batchPath, 'utf-8'));
  const map = new Map();
  for (const row of data.results || data.rows || []) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

const golden = loadGolden();
const batchById = loadBatchById();

let repairs = 0;
let correctRepairs = 0;
let falseRepairs = 0;

for (const g of golden) {
  const row = batchById.get(g.id);
  if (!row) continue;
  const text = (row.text_asr_preview || row.final_text || '').trim();
  const modified = row.sentence_repair_modified === true || (row.replacements || []).length > 0;
  if (!modified) continue;
  repairs += 1;
  const expected = (g.expected || '').trim();
  if (text === expected || (row.text_asr || '').trim() === expected) {
    correctRepairs += 1;
  } else if (g.raw && text.includes(g.raw.slice(0, 8))) {
    falseRepairs += 1;
  }
}

const precision = repairs > 0 ? correctRepairs / repairs : 1;
const summary = {
  golden_cases: golden.length,
  labeled_repairs: repairs,
  correct_repairs: correctRepairs,
  false_repair_count: falseRepairs,
  repair_precision: precision,
};

console.log(JSON.stringify(summary, null, 2));

if (repairs > 0 && falseRepairs > repairs) {
  process.exit(1);
}
