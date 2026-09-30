#!/usr/bin/env node
/**
 * LINGUA_ASR_EMPTY_REPLAY_CONTRACT_REPAIR Acceptance Tests
 *
 * Verifies:
 * - Test A: Normal non-empty evidence
 * - Test B: Authoritative ASR-empty evidence
 * - Test C: Broken non-empty evidence
 * - Test D: Inconsistent empty evidence
 * - Real Pilot200 200-case authoritative evidence set
 * - Specific p2_u001_001 acceptance
 * - Negative check (NO caseId-specific workarounds)
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import {
  classifyAuthoritativeCaptureOutcome,
  AUTHORITATIVE_BUILD,
} from './lib/pilot200-capture-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DATASET_DIR = path.join(REPO, 'test wav', 'LINGUA_DIALOG2000_V2_PILOT200');
const CASES_JSONL = path.join(DATASET_DIR, 'cases', 'cases.jsonl');
const MANIFEST_PATH = path.join(
  REPO,
  'docs',
  'user_correction',
  'model3',
  'LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_MANIFEST.json'
);

function mockCase(overrides = {}) {
  return {
    caseId: 'p2_mock_001',
    datasetId: 'LINGUA_DIALOG2000_V2_PILOT200',
    datasetVersion: 'V1',
    split: 'DEV',
    userId: 'U001',
    domain: 'general_daily',
    audioPath: 'audio/p2_mock_001.wav',
    audioIdentity: {
      sha256: 'mock_sha256_hash_value',
    },
    ...overrides,
  };
}

function mockEvidence(overrides = {}) {
  return {
    caseId: 'p2_mock_001',
    datasetBuildId: AUTHORITATIVE_BUILD,
    audioSha256: 'mock_sha256_hash_value',
    audioPath: 'audio/p2_mock_001.wav',
    rawMergedAsrText: '你好世界',
    segments: [
      {
        text: '你好世界',
        start: 0,
        end: 1.0,
        words: [
          { word: '你', start: 0, end: 0.2 },
          { word: '好', start: 0.2, end: 0.5 },
          { word: '世', start: 0.5, end: 0.7 },
          { word: '界', start: 0.7, end: 1.0 },
        ],
      },
    ],
    acousticToneSlices: [
      { word: '你', tone: 3 },
      { word: '好', tone: 3 },
    ],
    status: 'OK',
    asrExecutedForCapture: true,
    ...overrides,
  };
}

console.log('=== Step 1: Unit Tests (A / B / C / D) ===');

// --- Test A: Normal evidence ---
{
  const c = mockCase();
  const e = mockEvidence();
  const res = classifyAuthoritativeCaptureOutcome(e, c);
  assert.strictEqual(res.pass, true, 'Test A must pass');
  assert.strictEqual(res.captureStatus, 'VALID');
  assert.strictEqual(res.captureOutcome, 'ASR_NONEMPTY');
  assert.strictEqual(res.toneStatus, 'TONE_EVIDENCE_PRESENT');
  assert.strictEqual(res.failureReason, null);
  console.log('  [PASS] Test A: normal evidence -> ASR_NONEMPTY, VALID');
}

// --- Test B: Authoritative ASR-empty ---
{
  const c = mockCase();
  const e = mockEvidence({
    rawMergedAsrText: '',
    segments: [],
    acousticToneSlices: [],
    status: 'OK_EMPTY_ASR',
  });
  const res = classifyAuthoritativeCaptureOutcome(e, c);
  assert.strictEqual(res.pass, true, 'Test B must pass');
  assert.strictEqual(res.captureStatus, 'VALID');
  assert.strictEqual(res.captureOutcome, 'ASR_EMPTY');
  assert.strictEqual(res.toneStatus, 'TONE_NOT_APPLICABLE_ASR_EMPTY');
  assert.strictEqual(res.runtimeClass, 'NO_ASR_CONTENT');
  assert.strictEqual(res.model2Eligibility, 'NOT_ELIGIBLE_NO_ASR');
  assert.strictEqual(res.failureReason, null);
  console.log('  [PASS] Test B: authoritative ASR-empty -> ASR_EMPTY, VALID, TONE_NOT_APPLICABLE_ASR_EMPTY, NOT_ELIGIBLE_NO_ASR');
}

// --- Test C: Broken non-empty evidence ---
{
  // C1: raw non-empty, segments empty
  {
    const c = mockCase();
    const e = mockEvidence({ segments: [] });
    const res = classifyAuthoritativeCaptureOutcome(e, c);
    assert.strictEqual(res.pass, false, 'Test C1 must fail');
    assert.strictEqual(res.captureStatus, 'INVALID');
    assert.strictEqual(res.captureOutcome, 'CAPTURE_INVALID');
    assert.strictEqual(res.failureReason, 'ASR_SEGMENT_MISSING');
  }
  // C2: raw non-empty, segments non-empty, missing timing
  {
    const c = mockCase();
    const e = mockEvidence({
      segments: [{ text: '无时间戳', words: [] }],
    });
    const res = classifyAuthoritativeCaptureOutcome(e, c);
    assert.strictEqual(res.pass, false, 'Test C2 must fail');
    assert.strictEqual(res.captureStatus, 'INVALID');
    assert.strictEqual(res.captureOutcome, 'CAPTURE_INVALID');
    assert.strictEqual(res.failureReason, 'TIMESTAMP_MISSING');
  }
  // C3: raw non-empty, segments with timing, missing tone slices
  {
    const c = mockCase();
    const e = mockEvidence({ acousticToneSlices: [] });
    const res = classifyAuthoritativeCaptureOutcome(e, c);
    assert.strictEqual(res.pass, false, 'Test C3 must fail');
    assert.strictEqual(res.captureStatus, 'INVALID');
    assert.strictEqual(res.captureOutcome, 'CAPTURE_INVALID');
    assert.strictEqual(res.failureReason, 'TONE_EVIDENCE_NOT_PERSISTED');
  }
  console.log('  [PASS] Test C: broken non-empty evidence -> CAPTURE_INVALID (not swallowed by ASR_EMPTY)');
}

// --- Test D: Inconsistent empty evidence ---
{
  // D1: raw empty, but segments non-empty
  {
    const c = mockCase();
    const e = mockEvidence({
      rawMergedAsrText: '',
      segments: [{ text: '幽灵段', words: [{ word: '幽', start: 0, end: 1 }] }],
      acousticToneSlices: [],
    });
    const res = classifyAuthoritativeCaptureOutcome(e, c);
    assert.strictEqual(res.pass, false, 'Test D1 must fail');
    assert.strictEqual(res.captureStatus, 'INVALID');
    assert.strictEqual(res.captureOutcome, 'CAPTURE_INVALID');
    assert.strictEqual(res.failureReason, 'INCONSISTENT_ASR_EVIDENCE');
  }
  // D2: raw empty, segments empty, but tone slices non-empty
  {
    const c = mockCase();
    const e = mockEvidence({
      rawMergedAsrText: '',
      segments: [],
      acousticToneSlices: [{ word: '幽', tone: 1 }],
    });
    const res = classifyAuthoritativeCaptureOutcome(e, c);
    assert.strictEqual(res.pass, false, 'Test D2 must fail');
    assert.strictEqual(res.captureStatus, 'INVALID');
    assert.strictEqual(res.captureOutcome, 'CAPTURE_INVALID');
    assert.strictEqual(res.failureReason, 'INCONSISTENT_TONE_EVIDENCE');
  }
  console.log('  [PASS] Test D: inconsistent empty evidence -> CAPTURE_INVALID (INCONSISTENT_ASR/TONE_EVIDENCE)');
}

console.log('\n=== Step 2: Real Pilot200 Authoritative Evidence Acceptance ===');

const allCases = fs
  .readFileSync(CASES_JSONL, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));

assert.strictEqual(allCases.length, 200, 'Pilot200 must have exactly 200 cases');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
assert.strictEqual(manifest.cases.length, 200, 'Manifest must contain 200 cases');

const manifestMap = new Map();
for (const m of manifest.cases) {
  manifestMap.set(m.caseId, m);
}

let nonemptyValidCount = 0;
let emptyValidCount = 0;
let invalidCount = 0;

const splitCounts = {
  DEV: { total: 0, valid: 0 },
  VALIDATION: { total: 0, valid: 0 },
  HOLDOUT: { total: 0, valid: 0 },
};

const userCounts = {
  U001: { total: 0, valid: 0 },
  U002: { total: 0, valid: 0 },
  U003: { total: 0, valid: 0 },
  U004: { total: 0, valid: 0 },
  U005: { total: 0, valid: 0 },
};

for (const caseRow of allCases) {
  const m = manifestMap.get(caseRow.caseId);
  assert.ok(m, `Manifest must contain entry for ${caseRow.caseId}`);
  assert.ok(m.evidenceFile, `Manifest entry for ${caseRow.caseId} must specify evidenceFile`);

  const evAbs = path.join(REPO, m.evidenceFile);
  assert.ok(fs.existsSync(evAbs), `Evidence file must exist on disk: ${evAbs}`);

  const evidence = JSON.parse(fs.readFileSync(evAbs, 'utf8'));
  const res = classifyAuthoritativeCaptureOutcome(evidence, caseRow);

  splitCounts[caseRow.split].total += 1;
  userCounts[caseRow.userId].total += 1;

  if (res.pass) {
    splitCounts[caseRow.split].valid += 1;
    userCounts[caseRow.userId].valid += 1;

    if (res.captureOutcome === 'ASR_NONEMPTY') {
      nonemptyValidCount += 1;
    } else if (res.captureOutcome === 'ASR_EMPTY') {
      emptyValidCount += 1;
    }
  } else {
    invalidCount += 1;
  }
}

console.log('Real Pilot200 Acceptance Counts:');
console.log(`  TOTAL_UNIQUE_CASES: ${allCases.length}`);
console.log(`  ASR_NONEMPTY_VALID_COUNT: ${nonemptyValidCount}`);
console.log(`  ASR_EMPTY_VALID_COUNT: ${emptyValidCount}`);
console.log(`  CAPTURE_INVALID_COUNT: ${invalidCount}`);
console.log(`  AUTHORITATIVE_CAPTURE_VALID_COUNT: ${nonemptyValidCount + emptyValidCount}`);

assert.strictEqual(nonemptyValidCount, 199, 'Must have exactly 199 ASR_NONEMPTY valid cases');
assert.strictEqual(emptyValidCount, 1, 'Must have exactly 1 ASR_EMPTY valid case');
assert.strictEqual(invalidCount, 0, 'Must have exactly 0 CAPTURE_INVALID cases');
assert.strictEqual(nonemptyValidCount + emptyValidCount, 200, 'Must have exactly 200 authoritative valid cases');

console.log('\nSplit Coverage:');
for (const [split, stats] of Object.entries(splitCounts)) {
  console.log(`  ${split}: ${stats.valid}/${stats.total}`);
  assert.strictEqual(stats.valid, stats.total, `${split} coverage must be 100%`);
}

console.log('\nUser Coverage:');
for (const [user, stats] of Object.entries(userCounts)) {
  console.log(`  ${user}: ${stats.valid}/${stats.total}`);
  assert.strictEqual(stats.valid, stats.total, `${user} coverage must be 100%`);
}

console.log('\n=== Step 3: Specific p2_u001_001 Acceptance ===');
{
  const p2Case = allCases.find((c) => c.caseId === 'p2_u001_001');
  assert.ok(p2Case, 'p2_u001_001 must exist in cases.jsonl');
  assert.strictEqual(p2Case.expectedBehaviorClass, 'PROFILE_TARGET');

  const p2Manifest = manifestMap.get('p2_u001_001');
  assert.ok(p2Manifest, 'p2_u001_001 must exist in manifest');
  assert.strictEqual(p2Manifest.evidenceStatus, 'PASS');
  assert.strictEqual(p2Manifest.captureOutcome, 'ASR_EMPTY');
  assert.strictEqual(p2Manifest.runtimeClass, 'NO_ASR_CONTENT');
  assert.strictEqual(p2Manifest.toneStatus, 'TONE_NOT_APPLICABLE_ASR_EMPTY');
  assert.strictEqual(p2Manifest.model2Eligibility, 'NOT_ELIGIBLE_NO_ASR');

  const p2EvAbs = path.join(REPO, p2Manifest.evidenceFile);
  const p2Ev = JSON.parse(fs.readFileSync(p2EvAbs, 'utf8'));
  const p2Res = classifyAuthoritativeCaptureOutcome(p2Ev, p2Case);

  assert.strictEqual(p2Res.pass, true);
  assert.strictEqual(p2Res.captureStatus, 'VALID');
  assert.strictEqual(p2Res.captureOutcome, 'ASR_EMPTY');
  assert.strictEqual(p2Res.runtimeClass, 'NO_ASR_CONTENT');
  assert.strictEqual(p2Res.toneStatus, 'TONE_NOT_APPLICABLE_ASR_EMPTY');
  assert.strictEqual(p2Res.model2Eligibility, 'NOT_ELIGIBLE_NO_ASR');
  assert.strictEqual(p2Ev.rawMergedAsrText, '');
  assert.deepStrictEqual(p2Ev.segments, []);
  assert.deepStrictEqual(p2Ev.acousticToneSlices, []);

  console.log('  [PASS] p2_u001_001 verified:');
  console.log('    datasetIntendedClass =', p2Case.expectedBehaviorClass);
  console.log('    observedRuntimeClass =', p2Res.runtimeClass);
  console.log('    captureOutcome       =', p2Res.captureOutcome);
  console.log('    captureStatus        =', p2Res.captureStatus);
  console.log('    toneStatus           =', p2Res.toneStatus);
  console.log('    model2Eligibility    =', p2Res.model2Eligibility);
  console.log('    rawMergedAsrText     = ""');
  console.log('    segments             = []');
  console.log('    toneSlices           = []');
}

console.log('\n=== Step 4: Negative Regression Check (No Case-Specific Workarounds) ===');
{
  const contractSrc = fs.readFileSync(
    path.join(__dirname, 'lib', 'pilot200-capture-contract.mjs'),
    'utf8'
  );
  assert.ok(
    !contractSrc.includes('p2_u001_001'),
    'pilot200-capture-contract.mjs must NOT contain caseId p2_u001_001'
  );

  const captureRunnerSrc = fs.readFileSync(
    path.join(__dirname, 'run-pilot200-frozen-tone-evidence-full-capture.mjs'),
    'utf8'
  );
  // Ensure p2_u001_001 is not used as an if condition
  const condPattern = /if\s*\([^)]*p2_u001_001[^)]*\)/;
  assert.ok(
    !condPattern.test(captureRunnerSrc),
    'run-pilot200-frozen-tone-evidence-full-capture.mjs must NOT contain if condition with p2_u001_001'
  );

  console.log('  [PASS] CASE_SPECIFIC_PATCH = NO');
}

console.log('\n>>> ALL 4 TEST SUITES PASSED (200/200 AUTHORITATIVE VALID) <<<');
