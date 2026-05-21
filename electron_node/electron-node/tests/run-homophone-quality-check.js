#!/usr/bin/env node
/**
 * Homophone 质量验收（wrong/right），非 pipeline pass。
 *
 * 用法：
 *   node tests/run-homophone-quality-check.js
 *   node tests/run-homophone-quality-check.js tests/dialog-200-batch-result.json
 */
const fs = require('fs');
const path = require('path');

const batchPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'dialog-200-batch-result.json');
const expectationsPath = fs.existsSync(
  path.join(__dirname, 'recover_expectations', 'homophone_expectations.json')
)
  ? path.join(__dirname, 'recover_expectations', 'homophone_expectations.json')
  : path.join(__dirname, 'fixtures', 'homophone-expectations.json');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function evaluateOne(exp, row, extra) {
  const repair = extra.sentence_repair || {};
  const text = (row.text_asr_preview || extra.recall_hypothesis_text || '').trim();
  const fullText = (repair.selectedText || text).trim();
  const windows = extra.window_candidates || [];
  const replacements = repair.replacements || [];

  const recalled = (exp.mustRecall || []).every((term) =>
    windows.some((w) => w.to === term || w.from === term) ||
    replacements.some((r) => r.to === term)
  );

  const repairHit =
    exp.right.length > 0 &&
    (fullText.includes(exp.right) || replacements.some((r) => r.to === exp.right));

  const pickedWrong = (exp.mustNotPick || []).some(
    (bad) => fullText.includes(bad) && !fullText.includes(exp.right)
  );

  let status = 'missed';
  if (repairHit && recalled) status = 'correct';
  else if (recalled && !repairHit) status = 'recalled_not_selected';
  else if (repairHit && !recalled) status = 'repaired_without_window';
  else if (pickedWrong) status = 'picked_wrong';

  return {
    id: exp.id,
    scenario: exp.scenario,
    status,
    recalled,
    repairHit,
    pickedWrong,
    nbest_synthetic: extra.nbest_synthetic,
    hypothesis_count: (extra.asr_hypotheses || []).length,
    picked_hypothesis_index: repair.hypothesisIndex,
    replacements,
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

  const results = [];
  for (const exp of expectations) {
    const row = byId.get(exp.id);
    if (!row) {
      results.push({ id: exp.id, status: 'missing_batch_row' });
      continue;
    }
    if (!row.pass) {
      results.push({ id: exp.id, status: 'pipeline_fail' });
      continue;
    }
    const extra = row.extra || {};
    results.push(evaluateOne(exp, row, extra));
  }

  const summary = {
    total: results.length,
    correct: results.filter((r) => r.status === 'correct').length,
    recalled_not_selected: results.filter((r) => r.status === 'recalled_not_selected').length,
    repaired_without_window: results.filter((r) => r.status === 'repaired_without_window').length,
    picked_wrong: results.filter((r) => r.status === 'picked_wrong').length,
    missed: results.filter((r) => r.status === 'missed').length,
    pipeline_fail: results.filter((r) => r.status === 'pipeline_fail').length,
    missing_batch_row: results.filter((r) => r.status === 'missing_batch_row').length,
  };

  const outPath = path.join(__dirname, 'homophone-quality-result.json');
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), 'utf8');

  console.log('Homophone quality check');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Wrote', outPath);

  const hardFail = summary.picked_wrong > 0 || summary.pipeline_fail > 0;
  process.exit(hardFail ? 1 : 0);
}

main();
