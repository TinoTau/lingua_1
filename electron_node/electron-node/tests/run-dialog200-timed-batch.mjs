#!/usr/bin/env node
/**
 * dialog_200 batch with wall-clock deadline (default 15 min).
 * Requires test server :5020 + node running.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let maxMs = 15 * 60 * 1000;
let dirArg = null;
let outName = 'fw-detector-dialog-200-batch-result.json';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--max-minutes' && args[i + 1]) {
    maxMs = parseFloat(args[i + 1]) * 60 * 1000;
    i += 1;
  } else if (a === '--out' && args[i + 1]) {
    outName = args[i + 1];
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
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch (_) {}
  }
  return 5020;
}

async function waitHealth(port, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
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

function contractRow(caseDef, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const text = (data.text_asr || '').trim();
  const raw = (extra.raw_asr_text || '').trim();
  const contract = assessFwDetectorContractPass(extra, data);
  const spans = fw.spans || [];
  const applied = spans.filter((s) => s.applied === true);
  const summary = fw.summary || {};
  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr_preview: text.slice(0, 120),
    raw_asr_preview: raw.slice(0, 120),
    text_changed: raw.length > 0 && text !== raw,
    asr_service_id: extra.asr_service_id,
    fw_triggered: fw.triggered === true,
    fw_reason: fw.reason,
    fw_span_count: summary.spanCount ?? spans.length,
    fw_candidate_count: summary.candidateCount ?? 0,
    fw_applied_count: summary.appliedCount ?? applied.length,
    fw_kenlm_approved_count: summary.kenlmApprovedCount ?? 0,
    fw_kenlm_vetoed_count: summary.kenlmVetoedCount ?? 0,
    lexicon_runtime_status: extra.lexicon_runtime_status,
    pipeline_ms: extra.pipeline_ms,
    extra,
    error: null,
  };
}

const cases = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const port = getPort();
const batchStart = Date.now();
const deadline = batchStart + maxMs;

console.log('[dialog200-timed] waiting for test server on', port);
if (!(await waitHealth(port))) {
  console.error('[dialog200-timed] test server not ready');
  process.exit(1);
}

const report = {
  timestamp: new Date().toISOString(),
  port,
  dialogDir: DIALOG_DIR,
  projectRoot: process.env.PROJECT_ROOT || null,
  testScope: 'Lexicon V3.1 single-manifest + patch runtime dialog_200 timed batch',
  maxMinutes: maxMs / 60000,
  totalManifestCases: cases.length,
  cases: [],
  summary: {},
  stoppedReason: null,
};

let pass = 0;
let fail = 0;
let skip = 0;
let index = 0;

for (const caseDef of cases) {
  if (Date.now() >= deadline) {
    report.stoppedReason = 'deadline';
    console.log('[dialog200-timed] deadline reached after', index, 'cases');
    break;
  }
  index += 1;
  const wavPath = path.join(DIALOG_DIR, caseDef.file);
  if (!fs.existsSync(wavPath)) {
    report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
    skip += 1;
    continue;
  }
  const sessionId = `v31-d200-${caseDef.id}-${Date.now()}`;
  const caseStart = Date.now();
  try {
    const data = await runWav(port, wavPath, sessionId);
    const row = contractRow(caseDef, data);
    report.cases.push(row);
    if (row.pass) {
      pass += 1;
      console.log(`[${caseDef.id}] PASS ${row.pipeline_ms}ms`, row.text_asr_preview.slice(0, 36));
    } else {
      fail += 1;
      console.log(`[${caseDef.id}] FAIL`, row.contract_failures);
    }
  } catch (e) {
    fail += 1;
    report.cases.push({
      id: caseDef.id,
      scenario: caseDef.scenario,
      pass: false,
      error: e.message,
    });
    console.log(`[${caseDef.id}] ERROR`, e.message);
  }
  const elapsed = Date.now() - batchStart;
  console.log(`[dialog200-timed] progress ${report.cases.length}/${cases.length} elapsed ${Math.round(elapsed / 1000)}s`);
}

if (!report.stoppedReason) {
  report.stoppedReason = 'completed_all';
}

const evaluated = report.cases.filter((r) => !r.skip);
report.summary = {
  evaluated: evaluated.length,
  pass,
  fail,
  skip,
  wall_clock_sec: Math.round((Date.now() - batchStart) / 1000),
  pipeline_ok_rate: evaluated.length > 0 ? pass / evaluated.length : 0,
  fw_triggered_count: evaluated.filter((r) => r.fw_triggered).length,
  fw_applied_case_count: evaluated.filter((r) => (r.fw_applied_count || 0) > 0).length,
  text_changed_count: evaluated.filter((r) => r.text_changed).length,
  lexicon_runtime_ok_count: evaluated.filter((r) => r.lexicon_runtime_status === 'ok').length,
  asr_service_id_distribution: evaluated.reduce((acc, r) => {
    const id = r.asr_service_id || 'unknown';
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {}),
};

const outPath = path.join(__dirname, outName);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log('[dialog200-timed] wrote', outPath);
console.log('[dialog200-timed] summary', JSON.stringify(report.summary, null, 2));
process.exit(fail > 0 && report.stoppedReason !== 'deadline' ? 1 : 0);
