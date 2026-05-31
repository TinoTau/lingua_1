#!/usr/bin/env node
/** Retry failed cases from lexicon-v2-p4-batch-result.json and merge. */
const fs = require('fs');
const path = require('path');
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess');

const resultPath = path.join(__dirname, 'lexicon-v2-p4-batch-result.json');
const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const failed = report.cases.filter((c) => c.error);
if (!failed.length) {
  console.log('No failed cases to retry');
  process.exit(0);
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIALOG_DIR, 'cases.manifest.json'), 'utf8')
);
const caseById = Object.fromEntries(manifest.map((c) => [c.id, c]));
const port = report.port || 5020;

async function runWav(wavPath, sessionId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: sessionId,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function contractRow(caseDef, data, sessionId) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const contract = assessFwDetectorContractPass(extra, data);
  const summary = fw.summary || {};
  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    sessionId,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr: (data.text_asr || '').trim(),
    raw_asr_text: (extra.raw_asr_text || '').trim(),
    text_changed: false,
    pipeline_ms: extra.pipeline_ms,
    fw_detector_step_ms: extra.fw_detector_step_ms,
    kenlm_veto_ms: fw.kenlmVetoMs ?? fw.kenlmTiming?.batchMs,
    kenlm_veto_query_count: fw.kenlmVetoQueryCount ?? summary.kenlmQueryCount,
    fw_metadata_gate_ms: fw.fwMetadataSpanGate?.fwMetadataGateMs,
    span_count: summary.spanCount ?? 0,
    fw_applied_count: summary.appliedCount ?? 0,
    sentence_rerank: fw.sentenceRerank || null,
    recall_v2_diagnostics: fw.recallV2Diagnostics || null,
    error: null,
  };
}

async function main() {
  console.log('Retrying', failed.length, 'failed cases');
  const byId = Object.fromEntries(report.cases.map((c) => [c.id, c]));
  let ok = 0;
  for (const prev of failed) {
    const caseDef = caseById[prev.id];
    if (!caseDef) continue;
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    try {
      const data = await runWav(wavPath, `p4-retry-${caseDef.id}-${Date.now()}`);
      const row = contractRow(caseDef, data, `retry-${caseDef.id}`);
      row.text_changed =
        row.raw_asr_text.length > 0 && row.text_asr !== row.raw_asr_text;
      byId[caseDef.id] = row;
      if (row.pass) ok += 1;
      console.log(`[${caseDef.id}] ${row.pass ? 'PASS' : 'FAIL'} apply=${row.fw_applied_count}`);
    } catch (e) {
      byId[caseDef.id] = { id: caseDef.id, pass: false, error: e.message };
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }
  report.cases = manifest.map((c) => byId[c.id]).filter(Boolean);
  const evaluated = report.cases.filter((c) => !c.skip && !c.error);
  report.summary.pass = evaluated.filter((c) => c.pass).length;
  report.summary.fail = report.cases.length - report.summary.pass;
  report.summary.pipeline_ok_rate =
    evaluated.length > 0 ? report.summary.pass / evaluated.length : 0;
  report.summary.fw_applied_total = evaluated.reduce((s, r) => s + (r.fw_applied_count || 0), 0);
  report.summary.text_changed_count = evaluated.filter((r) => r.text_changed).length;
  report.summary.sentence_rerank_jobs = evaluated.filter((r) => r.sentence_rerank).length;
  report.summary.picked_raw_count = evaluated.filter((r) => r.sentence_rerank?.pickedIsRaw === true).length;
  report.summary.picked_candidate_count = evaluated.filter(
    (r) => r.sentence_rerank?.pickedIsRaw === false
  ).length;
  report.retry_merged_at = new Date().toISOString();
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Merged summary', report.summary);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
