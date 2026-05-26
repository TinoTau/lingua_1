#!/usr/bin/env node
/**
 * Export patch proposals into operator review format (jsonl → review bundle).
 *
 * Usage:
 *   node scripts/replay-patch/export-for-review.mjs patch-proposals.jsonl
 *   node scripts/replay-patch/export-for-review.mjs patch-proposals.jsonl --out review-bundle.json
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

if (!inputPath) {
  console.error('Usage: node export-for-review.mjs <patch-proposals.jsonl> [--out review.json]');
  process.exit(1);
}

const lines = fs.readFileSync(path.resolve(inputPath), 'utf8').split(/\r?\n/).filter(Boolean);
const proposals = lines.map((line, i) => {
  const row = JSON.parse(line);
  return {
    reviewId: `${row.caseId || 'case'}-${i + 1}`,
    status: 'pending',
    caseId: row.caseId,
    rawAsr: row.rawAsr,
    repairedText: row.repairedText,
    missingCandidate: row.missingCandidate,
    suggestedDomain: row.suggestedDomain,
    reason: row.reason,
    evidence: row.evidence || [],
    operatorDecision: null,
    operatorNote: '',
  };
});

const bundle = {
  schemaVersion: 'patch-review-v1',
  exportedAt: new Date().toISOString(),
  sourceFile: path.resolve(inputPath),
  replayBatchId: process.env.REPLAY_BATCH_ID?.trim() || `replay-${Date.now()}`,
  proposalCount: proposals.length,
  proposals,
};

const json = JSON.stringify(bundle, null, 2);
if (outPath) {
  fs.writeFileSync(path.resolve(outPath), json, 'utf8');
  console.log('Wrote', path.resolve(outPath));
} else {
  console.log(json);
}
