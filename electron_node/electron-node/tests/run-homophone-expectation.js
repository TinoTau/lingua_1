#!/usr/bin/env node
/**
 * Recover V3 homophone 期望验收（T-11 / historical-restore-v1）
 *
 * 用法：
 *   node tests/run-homophone-expectation.js
 *   node tests/run-homophone-expectation.js tests/dialog-200-batch-result.json
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let batchPath = path.join(__dirname, 'dialog-200-batch-result.json');
let expectationsPath = path.join(__dirname, 'recover_expectations', 'homophone_expectations.json');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--expectations' && args[i + 1]) {
    expectationsPath = path.resolve(args[++i]);
  } else if (args[i] === '--batch' && args[i + 1]) {
    batchPath = path.resolve(args[++i]);
  } else if (!args[i].startsWith('--')) {
    batchPath = path.resolve(args[i]);
  }
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const DEPRECATED_FIELDS = [
  'expectPickedHypothesis',
  'expectPickedHypothesisRank',
  'picked_hypothesis_index',
  'non_top1',
  'modifiedWithoutReplacement',
];

function collectDeprecatedFields(exp) {
  const found = [];
  for (const key of DEPRECATED_FIELDS) {
    if (exp[key] !== undefined) {
      found.push(key);
    }
  }
  return found;
}

function isSignoffExpectation(exp) {
  if (exp.signoff === false) return false;
  if (exp.deprecated === true) return false;
  if (exp.annotation_status && exp.annotation_status !== 'signoff') return false;
  if ((exp.note || '').includes('smoke')) return false;
  if ((exp.note || '').includes('non_top1')) return false;
  if ((exp.note || '').includes('modified_without_replacement')) return false;
  return true;
}

/** 批测行顶层字段 + extra 合并为 V3 可读视图 */
function normalizeBatchRow(row) {
  const extra = row.extra || {};
  const contractRepair = extra.sentence_repair || {};
  const replacements = contractRepair.replacements?.length
    ? contractRepair.replacements
    : row.replacements || [];
  const restoreMetrics = extra.restore_metrics || row.restore_metrics || {};
  return {
    pass: row.pass,
    text_asr_preview: row.text_asr_preview || '',
    extra,
    repair: {
      ...contractRepair,
      selectedText: contractRepair.selectedText || row.text_asr_preview || '',
      replacements,
      modified: contractRepair.modified ?? row.sentence_repair_modified,
      candidateSource: contractRepair.candidateSource || row.candidate_source,
      hypothesisIndex:
        contractRepair.hypothesisIndex ??
        contractRepair.pickedHypothesisRank ??
        row.picked_hypothesis_index,
      top1HypothesisIndex:
        contractRepair.top1HypothesisIndex ?? row.top1_hypothesis_index,
      pickedReason: contractRepair.pickedReason || row.picked_reason,
      candidates: contractRepair.candidates || [],
    },
    window_candidates: extra.window_candidates || [],
    window_candidate_count: row.window_candidate_count ?? (extra.window_candidates || []).length,
    restore_metrics: restoreMetrics,
    picked_from_raw_ctc_nbest_count:
      restoreMetrics.picked_from_raw_ctc_nbest_count ?? row.picked_from_raw_ctc_nbest_count ?? 0,
  };
}

function evaluateOne(exp, row) {
  const norm = normalizeBatchRow(row);
  const repair = norm.repair;
  const fullText = (repair.selectedText || norm.text_asr_preview || '').trim();
  const windows = norm.window_candidates;
  const replacements = repair.replacements || [];

  const recalled = (exp.mustRecall || []).every(
    (term) =>
      windows.some((w) => w.to === term || w.from === term) ||
      replacements.some((r) => r.to === term) ||
      (repair.candidates || []).some((c) => (c.recallHits || []).includes(term))
  );

  const repairHit =
    !exp.right ||
    fullText.includes(exp.right) ||
    replacements.some((r) => r.to === exp.right);

  const pickedWrong = (exp.mustNotPick || []).some(
    (bad) => bad && fullText.includes(bad) && (!exp.right || !fullText.includes(exp.right))
  );

  const mustContainOk = (exp.mustContain || []).every((term) => term && fullText.includes(term));

  const deprecatedFields = collectDeprecatedFields(exp);
  const hasDeprecatedExpectation = deprecatedFields.length > 0 || exp.deprecated === true;

  let expectPickedOk = true;
  if (
    !hasDeprecatedExpectation &&
    (exp.expectPickedHypothesis !== undefined || exp.expectPickedHypothesisRank !== undefined)
  ) {
    const expectRank =
      exp.expectPickedHypothesisRank !== undefined
        ? exp.expectPickedHypothesisRank
        : exp.expectPickedHypothesis;
    expectPickedOk = repair.hypothesisIndex === expectRank;
  }

  const forbidRawCtc =
    exp.forbidRawCtcPick !== false && (norm.picked_from_raw_ctc_nbest_count ?? 0) === 0;

  let candidateSourceOk = true;
  if (exp.expectCandidateSource) {
    candidateSourceOk = repair.candidateSource === exp.expectCandidateSource;
  }
  if (exp.expectModified === true && repair.modified !== true) {
    candidateSourceOk = false;
  }
  if (exp.expectReplacementsMin != null && replacements.length < exp.expectReplacementsMin) {
    candidateSourceOk = false;
  }

  let status = 'PASS';
  const failures = [];
  if (!row.pass) {
    status = 'FAIL';
    failures.push('pipeline_fail');
  }
  if (!recalled && (exp.mustRecall || []).length > 0) {
    status = 'FAIL';
    failures.push('mustRecall');
  }
  if (exp.right && !repairHit) {
    status = 'FAIL';
    failures.push('repair_miss');
  }
  if (pickedWrong) {
    status = 'FAIL';
    failures.push('mustNotPick');
  }
  if (!mustContainOk && (exp.mustContain || []).length > 0) {
    status = 'FAIL';
    failures.push('mustContain');
  }
  if (
    !expectPickedOk &&
    !hasDeprecatedExpectation &&
    (exp.expectPickedHypothesis !== undefined || exp.expectPickedHypothesisRank !== undefined)
  ) {
    status = 'FAIL';
    failures.push('expectPickedHypothesis');
  }
  if (!forbidRawCtc) {
    status = 'FAIL';
    failures.push('raw_ctc_pick');
  }
  if (!candidateSourceOk) {
    status = 'FAIL';
    failures.push('candidate_source');
  }

  let qualityTag = 'ok';
  if (status === 'PASS') {
    if (recalled && repairHit) qualityTag = 'correct';
    else if (recalled && !repairHit) qualityTag = 'recalled_not_selected';
    else if (repairHit && !recalled) qualityTag = 'repaired_without_window';
    else if (!exp.right && !exp.mustRecall?.length) qualityTag = 'smoke';
    else qualityTag = 'partial';
  }

  return {
    id: exp.id,
    scenario: exp.scenario,
    status,
    qualityTag,
    failures,
    recalled,
    repairHit,
    pickedWrong,
    expectPickedOk,
    candidate_source: repair.candidateSource,
    modified: repair.modified,
    window_candidate_count: norm.window_candidate_count,
    picked_from_raw_ctc_nbest_count: norm.picked_from_raw_ctc_nbest_count,
    replacements_count: replacements.length,
  };
}

function coverageStats(expectations, results) {
  const byScenario = {};
  for (const exp of expectations) {
    const sc = exp.scenario || 'unknown';
    if (!byScenario[sc]) byScenario[sc] = { total: 0, pass: 0, fail: 0 };
    byScenario[sc].total += 1;
    const r = results.find((x) => x.id === exp.id);
    if (r?.status === 'PASS') byScenario[sc].pass += 1;
    else byScenario[sc].fail += 1;
  }
  return {
    expectation_count: expectations.length,
    evaluated: results.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    by_scenario: byScenario,
    quality_tags: results.reduce((acc, r) => {
      acc[r.qualityTag] = (acc[r.qualityTag] || 0) + 1;
      return acc;
    }, {}),
  };
}

function main() {
  if (!fs.existsSync(batchPath)) {
    console.error('Missing batch result:', batchPath);
    process.exit(1);
  }
  if (!fs.existsSync(expectationsPath)) {
    console.error('Missing expectations:', expectationsPath);
    process.exit(1);
  }

  const batch = loadJson(batchPath);
  const expectations = loadJson(expectationsPath);
  const byId = new Map(batch.cases.map((c) => [c.id, c]));

  const deprecatedWarnings = [];
  const results = [];
  for (const exp of expectations) {
    const deprecatedFields = collectDeprecatedFields(exp);
    if (deprecatedFields.length > 0) {
      deprecatedWarnings.push({ id: exp.id, fields: deprecatedFields });
    }
    const row = byId.get(exp.id);
    if (!row) {
      results.push({
        id: exp.id,
        status: 'FAIL',
        qualityTag: 'missing_batch_row',
        failures: ['missing_batch_row'],
      });
      continue;
    }
    results.push(evaluateOne(exp, row));
  }

  const summary = coverageStats(expectations, results);
  const signoffIds = new Set(expectations.filter(isSignoffExpectation).map((e) => e.id));
  const signoffResults = results.filter((r) => signoffIds.has(r.id));
  summary.signoff_total = signoffResults.length;
  summary.signoff_pass = signoffResults.filter((r) => r.status === 'PASS').length;
  summary.signoff_fail = signoffResults.filter((r) => r.status === 'FAIL').length;

  const lexiconIds = expectations.filter((e) => e.scenario === 'lexicon_homophone').map((e) => e.id);
  const lexiconResults = results.filter((r) => lexiconIds.includes(r.id));
  summary.lexicon_homophone_total = lexiconResults.length;
  summary.lexicon_homophone_pass = lexiconResults.filter((r) => r.status === 'PASS').length;

  const outPath = path.join(__dirname, 'homophone-expectation-result.json');
  summary.deprecated_field_warnings = deprecatedWarnings.length;
  fs.writeFileSync(
    outPath,
    JSON.stringify({ summary, results, deprecatedWarnings }, null, 2),
    'utf8'
  );

  console.log('Homophone expectation check (V3 / historical-restore-v1)');
  if (deprecatedWarnings.length > 0) {
    console.warn(
      `[deprecated] ${deprecatedWarnings.length} expectations use legacy fields (not counted in signoff)`
    );
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log('Wrote', outPath);

  // GB-6：lexicon_homophone 12 条为 V3 结项门禁（允许 1 条已知质量债 d135，见 Formal Completion Signoff）
  const lexiconGateFail = summary.lexicon_homophone_pass < 11;
  process.exit(lexiconGateFail ? 1 : 0);
}

main();
