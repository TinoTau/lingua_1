#!/usr/bin/env node
/**
 * dialog_200 FW detector v1 批测（需节点 + test server :5020）
 *
 *   set PROJECT_ROOT=D:\Programs\github\lingua_1
 *   npm run start
 *   node tests/run-fw-detector-dialog-200-batch.js
 *   node tests/run-fw-detector-dialog-200-batch.js --limit 20
 */
const fs = require('fs');
const path = require('path');
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess');

const args = process.argv.slice(2);
let limit = null;
let dirArg = null;
let kenlmGateMode = null;
let kenlmVetoThreshold = null;
let enableKenLMGate = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (a === '--kenlm-gate-mode' && args[i + 1]) {
    kenlmGateMode = args[i + 1];
    i += 1;
  } else if (a === '--kenlm-veto-threshold' && args[i + 1]) {
    kenlmVetoThreshold = parseFloat(args[i + 1]);
    i += 1;
  } else if (a === '--enable-kenlm-gate' && args[i + 1]) {
    enableKenLMGate = args[i + 1] === 'true';
    i += 1;
  } else if (!a.startsWith('--')) {
    dirArg = a;
  }
}

const DIALOG_DIR = dirArg
  ? path.resolve(dirArg)
  : path.resolve(__dirname, '../../../test wav/dialog_200');

const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');

function getPort() {
  const cfgPath = path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch (_) {}
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

function buildAudioBody(wavPath, sessionId) {
  const body = {
    wavPath,
    srcLang: 'zh',
    tgtLang: 'en',
    use_lexicon: true,
    is_manual_cut: true,
    session_id: sessionId,
    lexicon_v2_intent_enabled: false,
  };
  if (typeof enableKenLMGate === 'boolean') {
    body.enableKenLMGate = enableKenLMGate;
  }
  if (kenlmGateMode === 'hard_gate' || kenlmGateMode === 'weak_veto') {
    body.kenlmGateMode = kenlmGateMode;
  }
  if (typeof kenlmVetoThreshold === 'number' && !Number.isNaN(kenlmVetoThreshold)) {
    body.kenlmVetoThreshold = kenlmVetoThreshold;
  }
  return body;
}

async function runWav(port, wavPath, sessionId) {
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAudioBody(wavPath, sessionId)),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function contractRow(caseDef, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const text = (data.text_asr || '').trim();
  const raw = (extra.raw_asr_text || '').trim();
  const contract = assessFwDetectorContractPass(extra, data);
  const spans = fw.spans || [];
  const applied = spans.filter((s) => s.applied === true);
  const summary = fw.summary || {};

  const kenlmApproved = summary.kenlmApprovedCount ?? 0;
  const kenlmVetoed = summary.kenlmVetoedCount ?? 0;

  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr_preview: text.slice(0, 80),
    raw_asr_preview: raw.slice(0, 80),
    text_changed: raw.length > 0 && text !== raw,
    asr_service_id: extra.asr_service_id,
    fw_triggered: fw.triggered === true,
    fw_reason: fw.reason,
    fw_span_count: summary.spanCount ?? spans.length,
    fw_candidate_count: summary.candidateCount ?? 0,
    fw_applied_count: summary.appliedCount ?? applied.length,
    fw_kenlm_approved_count: kenlmApproved,
    fw_kenlm_vetoed_count: kenlmVetoed,
    fw_picked_topk_win_count: summary.pickedTopKWinCount ?? 0,
    fw_candidate_sentence_count: summary.candidateSentenceCount ?? 0,
    fw_kenlm_query_count: summary.kenlmQueryCount ?? 0,
    fw_kenlm_gate_mode: fw.configSnapshot?.kenlmGateMode,
    fw_kenlm_veto_threshold: fw.configSnapshot?.kenlmVetoThreshold,
    lexicon_runtime_status: extra.lexicon_runtime_status,
    pipeline_ms: extra.pipeline_ms,
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
  console.log('Waiting for test server on', port, '...');
  if (!(await waitHealth(port))) {
    console.error('Test server not ready. Start node with PROJECT_ROOT set.');
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    port,
    dialogDir: DIALOG_DIR,
    projectRoot: process.env.PROJECT_ROOT || null,
    testScope: 'FW detector v1 dialog_200',
    kenlmBatchOptions: {
      enableKenLMGate,
      kenlmGateMode,
      kenlmVetoThreshold,
    },
    total: cases.length,
    cases: [],
    summary: {},
  };

  let pass = 0;
  let fail = 0;
  let skip = 0;

  for (const caseDef of cases) {
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) {
      report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
      skip += 1;
      console.log(`[${caseDef.id}] SKIP missing wav`);
      continue;
    }
    const sessionId = `fw-d200-${caseDef.id}-${Date.now()}`;
    try {
      const data = await runWav(port, wavPath, sessionId);
      const row = contractRow(caseDef, data);
      report.cases.push(row);
      if (row.pass) {
        pass += 1;
        console.log(
          `[${caseDef.id}] PASS`,
          row.text_asr_preview.slice(0, 40),
          'fw_applied',
          row.fw_applied_count
        );
      } else {
        fail += 1;
        console.log(`[${caseDef.id}] FAIL`, row.contract_failures);
      }
    } catch (e) {
      fail += 1;
      report.cases.push({ id: caseDef.id, scenario: caseDef.scenario, pass: false, error: e.message });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  const evaluated = report.cases.filter((r) => !r.skip);
  report.summary = {
    total: cases.length,
    pass,
    fail,
    skip,
    pipeline_ok_rate: cases.length - skip > 0 ? pass / (cases.length - skip) : 0,
    fw_triggered_count: evaluated.filter((r) => r.fw_triggered).length,
    fw_applied_case_count: evaluated.filter((r) => (r.fw_applied_count || 0) > 0).length,
    fw_applied_total: evaluated.reduce((s, r) => s + (r.fw_applied_count || 0), 0),
    fw_candidate_total: evaluated.reduce((s, r) => s + (r.fw_candidate_count || 0), 0),
    text_changed_count: evaluated.filter((r) => r.text_changed).length,
    asr_service_id_distribution: evaluated.reduce((acc, r) => {
      const id = r.asr_service_id || 'unknown';
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {}),
    lexicon_runtime_ok_count: evaluated.filter((r) => r.lexicon_runtime_status === 'ok').length,
    kenlm_approved_total: evaluated.reduce((s, r) => s + (r.fw_kenlm_approved_count || 0), 0),
    kenlm_vetoed_total: evaluated.reduce((s, r) => s + (r.fw_kenlm_vetoed_count || 0), 0),
    picked_topk_win_total: evaluated.reduce((s, r) => s + (r.fw_picked_topk_win_count || 0), 0),
    candidate_sentence_total: evaluated.reduce((s, r) => s + (r.fw_candidate_sentence_count || 0), 0),
    kenlm_query_total: evaluated.reduce((s, r) => s + (r.fw_kenlm_query_count || 0), 0),
    false_repair_count: evaluated.filter(
      (r) => r.text_changed && (r.fw_applied_count || 0) > 0 && r.scenario !== 'lexicon_homophone'
    ).length,
    by_scenario: {},
  };

  for (const row of report.cases) {
    const sc = row.scenario || 'unknown';
    if (!report.summary.by_scenario[sc]) {
      report.summary.by_scenario[sc] = {
        pass: 0,
        fail: 0,
        skip: 0,
        applied_cases: 0,
        triggered_cases: 0,
      };
    }
    if (row.skip) report.summary.by_scenario[sc].skip += 1;
    else if (row.pass) report.summary.by_scenario[sc].pass += 1;
    else report.summary.by_scenario[sc].fail += 1;
    if (!row.skip && row.fw_triggered) report.summary.by_scenario[sc].triggered_cases += 1;
    if (!row.skip && (row.fw_applied_count || 0) > 0) {
      report.summary.by_scenario[sc].applied_cases += 1;
    }
  }

  const outPath = path.join(__dirname, 'fw-detector-dialog-200-batch-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nWrote', outPath);
  console.log('Summary', JSON.stringify(report.summary, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
