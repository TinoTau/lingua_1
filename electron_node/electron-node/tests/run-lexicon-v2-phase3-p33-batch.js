#!/usr/bin/env node
/**
 * P3.3 FW Metadata Span Gate batch — V2 Recall ON, Industry Routing OFF.
 */
const fs = require('fs');
const path = require('path');
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess');

const args = process.argv.slice(2);
let limit = null;
let maxMinutes = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (args[i] === '--max-minutes' && args[i + 1]) {
    maxMinutes = parseFloat(args[i + 1], 10);
    i += 1;
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');

function getPort() {
  const paths = [
    path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json'),
    path.join(process.env.APPDATA || '', 'electron-node', 'electron-node-config.json'),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (cfg.testServer?.port) return cfg.testServer.port;
      } catch (_) {}
    }
  }
  return 5020;
}

async function waitHealth(port, maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function runWav(port, wavPath, sessionId) {
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
  const text = (data.text_asr || '').trim();
  const raw = (extra.raw_asr_text || '').trim();
  const contract = assessFwDetectorContractPass(extra, data);
  const summary = fw.summary || {};
  const recallDiag = fw.recallV2Diagnostics || null;
  const metaGate = fw.fwMetadataSpanGate || null;
  const spanCount = summary.spanCount ?? (fw.spans || []).length;
  const industryRoutingUsed =
    recallDiag?.industry_routing_lookup_count > 0 ||
    (recallDiag?.spans || []).some((s) => s.industry_routing_used === true);

  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    sessionId,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr: text,
    raw_asr_text: raw,
    text_changed: raw.length > 0 && text !== raw,
    pipeline_ms: extra.pipeline_ms,
    fw_detector_step_ms: extra.fw_detector_step_ms,
    kenlm_veto_ms: fw.kenlmVetoMs ?? fw.kenlmTiming?.batchMs,
    kenlm_veto_query_count: fw.kenlmVetoQueryCount ?? fw.kenlmTiming?.queryCount ?? summary.kenlmQueryCount,
    fw_metadata_gate_ms: metaGate?.fwMetadataGateMs,
    fw_metadata_gate_word_count: metaGate?.wordCount,
    fw_metadata_gate_selected: metaGate?.selectedCount,
    span_count: spanCount,
    span_gate_mode: fw.configSnapshot?.spanGateMode,
    fw_applied_count: summary.appliedCount ?? 0,
    recall_v2_diagnostics: recallDiag,
    fw_metadata_span_gate: metaGate,
    industry_routing_used: industryRoutingUsed,
    extra,
    error: null,
  };
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('Missing manifest:', MANIFEST_PATH);
    process.exit(1);
  }

  let cases = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (limit > 0) cases = cases.slice(0, limit);

  const port = getPort();
  console.log('P3.3 FW Metadata Span Gate batch — test server', port);

  if (!(await waitHealth(port))) {
    console.error('Test server not ready');
    process.exit(1);
  }

  const batchStart = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    testScope: 'P3.3 FW Metadata Span Gate + V2 Recall (Phase 3 Only)',
    config: {
      spanGateMode: 'fw_metadata_gate',
      useLexiconRuntimeV2Recall: true,
      useIndustryRouting: false,
      lexiconRuntimeV2_enabled: true,
      intent_drain_sec: 0,
      max_minutes: maxMinutes,
    },
    port,
    dialogDir: DIALOG_DIR,
    total: cases.length,
    planned_total: cases.length,
    evaluated_count: 0,
    time_limit_reached: false,
    cases: [],
    summary: {},
  };

  let pass = 0;
  let fail = 0;
  const maxElapsedMs = maxMinutes > 0 ? maxMinutes * 60 * 1000 : null;

  for (const caseDef of cases) {
    if (maxElapsedMs != null && Date.now() - batchStart >= maxElapsedMs) {
      console.log(`Time limit reached (${maxMinutes} min), stopping after ${report.cases.length} cases`);
      break;
    }
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) {
      report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
      fail += 1;
      continue;
    }
    const sessionId = `p33-d200-${caseDef.id}-${Date.now()}`;
    try {
      const data = await runWav(port, wavPath, sessionId);
      const row = contractRow(caseDef, data, sessionId);
      report.cases.push(row);
      if (row.pass) {
        pass += 1;
        console.log(`[${caseDef.id}] PASS pipeline_ms=${row.pipeline_ms} spans=${row.span_count}`);
      } else {
        fail += 1;
        console.log(`[${caseDef.id}] FAIL`, row.contract_failures);
      }
    } catch (e) {
      fail += 1;
      report.cases.push({ id: caseDef.id, pass: false, error: e.message });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  report.batch_elapsed_sec = Math.round((Date.now() - batchStart) / 1000);
  report.time_limit_reached =
    maxElapsedMs != null && report.cases.length < cases.length && Date.now() - batchStart >= maxElapsedMs;
  report.evaluated_count = report.cases.length;
  const evaluated = report.cases.filter((r) => !r.skip && !r.error);
  const routingUsedCount = evaluated.filter((r) => r.industry_routing_used).length;

  report.summary = {
    total: cases.length,
    pass,
    fail,
    skip: report.cases.filter((r) => r.skip).length,
    pipeline_ok_rate: cases.length > 0 ? pass / cases.length : 0,
    industry_routing_used_count: routingUsedCount,
    fw_applied_total: evaluated.reduce((s, r) => s + (r.fw_applied_count || 0), 0),
    text_changed_count: evaluated.filter((r) => r.text_changed).length,
    batch_elapsed_sec: report.batch_elapsed_sec,
    avg_wall_sec_per_case:
      evaluated.length > 0 ? Number((report.batch_elapsed_sec / evaluated.length).toFixed(2)) : 0,
  };

  const outPath = path.join(__dirname, 'lexicon-v2-phase3-p33-batch-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log('Summary', JSON.stringify(report.summary, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
