#!/usr/bin/env node
/**
 * test-pilot200-governance.mjs
 *
 * Synthetic regression test suite for Full Pilot Run Matrix completeness & fail-closed governance.
 * Covers:
 * - Test C: Synthetic completeness classification (200 unique cases x 3 conditions = 600 valid runs)
 * - Test D: Duplicate 600 protection (600 records with duplicate caseId x condition)
 * - Test E: Condition imbalance protection (201 / 200 / 199)
 * - Test F: ASR_EMPTY validity (p2_u001_001 x 3 as valid runs)
 * - Test G: Report generator consistency & non-authoritative prose verification
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  validatePilotCompleteness,
  aggregateAndOutputReports,
  generateReportMarkdown,
  AUTH_SUMMARY_PATH,
  PARTIAL_SUMMARY_PATH,
} from './run-pilot200-post-pre-edge-full-remeasure.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateSyntheticCases(count = 200) {
  const cases = [];
  const splits = ['DEV', 'VALIDATION', 'HOLDOUT'];
  const domains = ['general_daily', 'software_meeting', 'medical', 'food_cafe', 'travel_hotel', 'retail_service'];
  const relations = ['n_l', 'in_ing', 'z_zh', 'sh_s', 'eng_en', 'h_f', 'ch_c'];
  const users = ['U001', 'U002', 'U003', 'U004', 'U005'];

  for (let i = 1; i <= count; i++) {
    const user = users[(i - 1) % users.length];
    const padId = String(i).padStart(3, '0');
    const caseId = `p2_${user.toLowerCase()}_${padId}`;
    cases.push({
      caseId,
      userId: user,
      split: splits[(i - 1) % splits.length],
      domain: domains[(i - 1) % domains.length],
      relationFamily: relations[(i - 1) % relations.length],
      evaluationTargetSurface: `目标词_${i}`,
      isModel2TargetCase: i !== 1, // i=1 is ASR_EMPTY
    });
  }
  return cases;
}

function generateSyntheticResults(cases, { duplicate = false, imbalanced = false } = {}) {
  const conditions = ['NO_PROFILE', 'CORRECT_PROFILE', 'WRONG_PROFILE'];
  const results = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const isAsrEmpty = (c.caseId === 'p2_u001_001');

    for (const cond of conditions) {
      const runId = `${c.caseId}_${cond}`;
      if (isAsrEmpty) {
        results.push({
          runId,
          caseId: c.caseId,
          condition: cond,
          runtimeOutcome: 'ASR_EMPTY',
          model2Applicable: false,
          gateA: 'NOT_APPLICABLE',
          gateB: 'NOT_APPLICABLE',
          gateC: 'NOT_APPLICABLE',
          gateD: 'NOT_APPLICABLE',
          gateE: 'NOT_APPLICABLE',
          gateF: 'NOT_APPLICABLE',
          gateG: 'NOT_APPLICABLE',
          gateH: 'NOT_APPLICABLE',
          gateI: 'NOT_APPLICABLE',
          firstFailureOwner: 'ASR_EMPTY',
          finalRepairCorrect: false,
          extraCandidatesCount: 0,
        });
      } else {
        const isPass = cond === 'CORRECT_PROFILE';
        results.push({
          runId,
          caseId: c.caseId,
          condition: cond,
          runtimeOutcome: 'EVALUATED',
          model2Applicable: true,
          gateA: 'PASS',
          gateB: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : 'PASS',
          gateC: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateD: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateE: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateF: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateG: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateH: cond === 'NO_PROFILE' ? 'NOT_APPLICABLE_NO_PROFILE' : (isPass ? 'PASS' : 'FAIL'),
          gateI: isPass ? 'PASS' : 'FAIL',
          firstFailureOwner: isPass ? 'SUCCESS' : (cond === 'NO_PROFILE' ? 'NO_PROFILE_BASE_REPAIR_FAIL' : 'LEXICON_RECALL'),
          finalRepairCorrect: isPass,
          extraCandidatesCount: cond === 'WRONG_PROFILE' ? 5 : 0,
        });
      }
    }
  }

  if (duplicate) {
    // Replace last element with a clone of element 0 (creates duplicate runId / case x condition, total still 600)
    results[results.length - 1] = { ...results[0] };
  }

  if (imbalanced) {
    // Modify one condition from WRONG_PROFILE to NO_PROFILE (201 NO_PROFILE, 200 CORRECT_PROFILE, 199 WRONG_PROFILE)
    const idx = results.findIndex(r => r.condition === 'WRONG_PROFILE' && r.caseId !== 'p2_u001_001');
    if (idx >= 0) {
      results[idx].condition = 'NO_PROFILE';
      results[idx].runId = `${results[idx].caseId}_NO_PROFILE_IMBALANCED`;
    }
  }

  return results;
}

async function runTestSuite() {
  console.log('=== RUNNING PILOT200 GOVERNANCE SYNTHETIC TEST SUITE ===\n');
  const syntheticCases = generateSyntheticCases(200);

  const tmpTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot200-gov-test-'));
  const expectedAuthSummary = path.join(tmpTestDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_SUMMARY.json');
  const expectedPartialSummary = path.join(tmpTestDir, 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_PARTIAL_PROBE_SUMMARY.json');

  try {
    // ----------------------------------------------------
    // Test C: Synthetic Completeness Classification
    // ----------------------------------------------------
    console.log('[Test C] Running Synthetic 600-Run Completeness Classification...');
    const valid600Results = generateSyntheticResults(syntheticCases);
    const compC = validatePilotCompleteness(syntheticCases, valid600Results);
    assert.strictEqual(compC.isValid, true, 'Test C: Completeness check should pass for valid 600 runs');
    assert.strictEqual(compC.uniqueCases, 200, 'Test C: Expected 200 unique cases');
    assert.strictEqual(compC.totalRuns, 600, 'Test C: Expected 600 total runs');
    assert.strictEqual(compC.conditionCounts.NO_PROFILE, 200);
    assert.strictEqual(compC.conditionCounts.CORRECT_PROFILE, 200);
    assert.strictEqual(compC.conditionCounts.WRONG_PROFILE, 200);

    // Test report generation in FULL mode using tmpTestDir so real artifacts are not touched
    const outputC = aggregateAndOutputReports(syntheticCases, valid600Results, {
      executionMode: 'FULL',
      selectionReason: 'NONE',
      outDir: tmpTestDir,
    });
    assert.strictEqual(outputC.summaryJson.executionMode, 'FULL');
    assert.strictEqual(outputC.summaryJson.authoritative, true);
    assert.strictEqual(outputC.targetSummaryPath, expectedAuthSummary);
    assert.notStrictEqual(outputC.summaryJson.pilotHypothesisStatus, 'NOT_EVALUATED');
    console.log('✓ Test C PASS: 600 unique valid runs properly classified as FULL / AUTHORITATIVE.\n');

    // ----------------------------------------------------
    // Test D: Duplicate 600 Protection
    // ----------------------------------------------------
    console.log('[Test D] Running Duplicate 600 Record Protection...');
    const duplicateResults = generateSyntheticResults(syntheticCases, { duplicate: true });
    assert.strictEqual(duplicateResults.length, 600, 'Array length is 600');
    const compD = validatePilotCompleteness(syntheticCases, duplicateResults);
    assert.strictEqual(compD.isValid, false, 'Test D: Completeness check must fail on duplicate runId');
    assert.match(compD.reason, /Duplicate/, 'Test D: Reason must mention Duplicate');

    const outputD = aggregateAndOutputReports(syntheticCases, duplicateResults, {
      executionMode: 'FULL', // Caller might request FULL, but validation must FAIL-CLOSE!
      selectionReason: 'NONE',
      outDir: tmpTestDir,
    });
    assert.strictEqual(outputD.summaryJson.executionMode, 'PARTIAL');
    assert.strictEqual(outputD.summaryJson.authoritative, false);
    assert.strictEqual(outputD.summaryJson.outcome, 'RUN_INCOMPLETE');
    assert.strictEqual(outputD.summaryJson.dominantFailureOwner, 'NOT_COMPUTED_FOR_INCOMPLETE_BASELINE');
    assert.strictEqual(outputD.summaryJson.pilotHypothesisStatus, 'NOT_EVALUATED');
    assert.strictEqual(outputD.summaryJson.oneNextOwner, 'PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE');
    assert.strictEqual(outputD.targetSummaryPath, expectedPartialSummary, 'Must route to PARTIAL output path');
    console.log('✓ Test D PASS: 600 records with duplicate runId successfully rejected and fail-closed.\n');

    // ----------------------------------------------------
    // Test E: Condition Imbalance Protection
    // ----------------------------------------------------
    console.log('[Test E] Running Condition Imbalance Protection (201/200/199)...');
    const imbalancedResults = generateSyntheticResults(syntheticCases, { imbalanced: true });
    assert.strictEqual(imbalancedResults.length, 600, 'Array length is 600');
    const compE = validatePilotCompleteness(syntheticCases, imbalancedResults);
    assert.strictEqual(compE.isValid, false, 'Test E: Completeness check must fail on condition imbalance');
    assert.match(compE.reason, /imbalanced|Duplicate/, 'Test E: Reason must detect anomaly');

    const outputE = aggregateAndOutputReports(syntheticCases, imbalancedResults, {
      executionMode: 'FULL',
      selectionReason: 'NONE',
      outDir: tmpTestDir,
    });
    assert.strictEqual(outputE.summaryJson.authoritative, false);
    assert.strictEqual(outputE.summaryJson.outcome, 'RUN_INCOMPLETE');
    assert.strictEqual(outputE.targetSummaryPath, expectedPartialSummary);
    console.log('✓ Test E PASS: Imbalanced condition distribution successfully rejected.\n');

  // ----------------------------------------------------
  // Test F: ASR_EMPTY Validity Verification
  // ----------------------------------------------------
  console.log('[Test F] Verifying ASR_EMPTY valid run semantics...');
  const asrEmptyRuns = valid600Results.filter(r => r.caseId === 'p2_u001_001');
  assert.strictEqual(asrEmptyRuns.length, 3, 'p2_u001_001 must expand into 3 runs');
  for (const r of asrEmptyRuns) {
    assert.strictEqual(r.runtimeOutcome, 'ASR_EMPTY');
    assert.strictEqual(r.model2Applicable, false);
    assert.strictEqual(r.firstFailureOwner, 'ASR_EMPTY');
  }
  // Confirm that presence of ASR_EMPTY runs does not invalidate completeness
  assert.strictEqual(compC.isValid, true, 'ASR_EMPTY runs are valid authoritative runs');
  console.log('✓ Test F PASS: ASR_EMPTY runs verified as valid authoritative baseline components.\n');

  // ----------------------------------------------------
  // Test G: Report Generator Consistency & Prose Check
  // ----------------------------------------------------
  console.log('[Test G] Checking report markdown generator consistency on partial run...');
  const partialSummary = {
    phase: 'LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE',
    executionMode: 'PARTIAL',
    authoritative: false,
    outcome: 'RUN_INCOMPLETE',
    dominantFailureOwner: 'NOT_COMPUTED_FOR_INCOMPLETE_BASELINE',
    oneNextOwner: 'PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE',
    pilotHypothesisStatus: 'NOT_EVALUATED',
    completedRuns: 6,
    uniqueCases: 2,
    conditionRuns: { NO_PROFILE: 2, CORRECT_PROFILE: 2, WRONG_PROFILE: 2 },
    finalRepairMetrics: { noProfileCorrect: 0, correctProfileCorrect: 0, wrongProfileCorrect: 0 },
    gateMetrics: {
      gateA: { applicable: 3, pass: 3, fail: 0, passRate: 1 },
      gateB: { applicable: 2, pass: 2, fail: 0, passRate: 1 },
      gateC: { applicable: 2, pass: 1, fail: 1, passRate: 0.5 },
      gateD: { applicable: 2, pass: 0, fail: 2, passRate: 0 },
      gateE: { applicable: 2, pass: 0, fail: 2, passRate: 0 },
      gateF: { applicable: 2, pass: 0, fail: 2, passRate: 0 },
      gateG: { applicable: 2, pass: 0, fail: 2, passRate: 0 },
      gateH: { applicable: 2, pass: 0, fail: 2, passRate: 0 },
      gateI: { applicable: 3, pass: 0, fail: 3, passRate: 0 },
    },
    model2ApplicableFirstFailureOwnerCounts: {},
    bySplit: {},
    byRelation: {},
    byUser: {},
    byDomain: {},
  };

  const partialReport = generateReportMarkdown(partialSummary);

  // Assertions against hardcoded falsehoods
  assert.doesNotMatch(partialReport, /600\/600 runs 完整执行且合法/, 'Must NOT assert 600/600 complete on partial run');
  assert.doesNotMatch(partialReport, /\| NO_PROFILE \| 200 \| 2 \| 200 \|/, 'Must NOT have hardcoded 200 in Valid Runs for partial');
  assert.doesNotMatch(partialReport, /ONE_NEXT_OWNER = PILOT_RESEARCH_CONCLUSION/, 'Must NOT conclude research on partial run');
  assert.doesNotMatch(partialReport, /Pilot200 核心研究假设当前定性？\s*\*\*NOT_SUPPORTED\*\*/, 'Must NOT conclude NOT_SUPPORTED on partial run without guard');

  // Assertions for presence of governance warnings
  assert.match(partialReport, /WARNING: PARTIAL \/ PROBE RUN \(NON-AUTHORITATIVE\)/, 'Must display partial warning banner');
  assert.match(partialReport, /\*\*NO\*\*。本次仅执行了 6\/600 runs/, 'Must truthfully state executed counts');
  assert.match(partialReport, /ONE_NEXT_OWNER = PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE/, 'Must route ONE_NEXT_OWNER to full remeasure');
  console.log('✓ Test G PASS: Report generator verified strictly consistent and free of hardcoded false prose.\n');

  console.log('=== ALL TESTS (C, D, E, F, G) PASSED SUCCESSFULLY ===');
  } finally {
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
