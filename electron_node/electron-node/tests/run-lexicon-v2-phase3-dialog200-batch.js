#!/usr/bin/env node
/**
 * Phase 3/4 dialog_200 batch: V2 Recall + Industry Routing + Session Intent.
 *
 *   set PROJECT_ROOT=D:\Programs\github\lingua_1
 *   node tests/run-lexicon-v2-phase3-dialog200-batch.js
 *   node tests/run-lexicon-v2-phase3-dialog200-batch.js --limit 20
 */
const fs = require('fs');
const path = require('path');
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess');

const args = process.argv.slice(2);
let limit = null;
let intentDrainSec = 240;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (args[i] === '--intent-drain-sec' && args[i + 1]) {
    intentDrainSec = parseInt(args[i + 1], 10);
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
      lexicon_v2_intent_enabled: true,
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
  const runtime = fw.runtime || {};
  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    sessionId,
    pass: contract.pass,
    contract_failures: contract.failures,
    text_asr_preview: text.slice(0, 80),
    raw_asr_preview: raw.slice(0, 80),
    text_asr: text,
    raw_asr_text: raw,
    text_changed: raw.length > 0 && text !== raw,
    asr_service_id: extra.asr_service_id,
    fw_triggered: fw.triggered === true,
    fw_applied_count: summary.appliedCount ?? 0,
    lexicon_runtime_status: extra.lexicon_runtime_status,
    lexicon_runtime_v2_status: extra.lexicon_runtime_v2_status,
    lexiconV2Enabled: extra.lexiconV2Enabled,
    intentLastOutcome: extra.intentLastOutcome,
    pipeline_ms: extra.pipeline_ms,
    fw_runtime: {
      lexiconRows: runtime.lexiconRows,
      pinyinIndexSize: runtime.pinyinIndexSize,
    },
    extra,
    error: null,
  };
}

async function exportAllSessions(port) {
  const res = await fetch(`http://127.0.0.1:${port}/session-migration/export-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceNodeId: 'phase3-dialog200' }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) return [];
  const body = await res.json();
  return body.sessions || [];
}

function summarizeIntentSessions(sessions) {
  const p3 = sessions.filter((s) => String(s.sessionId || '').startsWith('p3-d200-'));
  let withIntent = 0;
  let withKeywords = 0;
  let withPinyinKeys = 0;
  const outcomes = {};
  const domains = {};
  for (const s of p3) {
    const outcome = s.intentDiagnostics?.intentLastOutcome || 'unknown';
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;
    const intent = s.lexiconSessionIntent;
    if (intent?.primaryDomain) {
      withIntent += 1;
      domains[intent.primaryDomain] = (domains[intent.primaryDomain] || 0) + 1;
      if (intent.topicKeywords?.length > 0) withKeywords += 1;
      if (intent.topicKeywordPinyinKeys?.length > 0) withPinyinKeys += 1;
    }
  }
  return {
    session_count: p3.length,
    lexicon_session_intent_written: withIntent,
    with_topic_keywords: withKeywords,
    with_pinyin_keys: withPinyinKeys,
    intent_outcomes: outcomes,
    primary_domain_distribution: domains,
    write_rate: p3.length > 0 ? withIntent / p3.length : 0,
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
  console.log('Waiting for test server on', port);
  if (!(await waitHealth(port))) {
    console.error('Test server not ready');
    process.exit(1);
  }

  const batchStart = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    testScope: 'Lexicon V2 Phase 3/4 dialog_200 (V2 Recall + Industry Routing)',
    port,
    dialogDir: DIALOG_DIR,
    projectRoot: PROJECT_ROOT,
    total: cases.length,
    cases: [],
    summary: {},
    intent: {},
  };

  let pass = 0;
  let fail = 0;

  for (const caseDef of cases) {
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) {
      report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
      fail += 1;
      continue;
    }
    const sessionId = `p3-d200-${caseDef.id}-${Date.now()}`;
    try {
      const data = await runWav(port, wavPath, sessionId);
      const row = contractRow(caseDef, data, sessionId);
      report.cases.push(row);
      if (row.pass) {
        pass += 1;
        console.log(`[${caseDef.id}] PASS`, row.text_asr_preview.slice(0, 36));
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

  console.log(`\nDraining intent queue ${intentDrainSec}s...`);
  await new Promise((r) => setTimeout(r, intentDrainSec * 1000));

  const sessions = await exportAllSessions(port);
  report.intent = summarizeIntentSessions(sessions);
  report.batch_elapsed_sec = Math.round((Date.now() - batchStart) / 1000);

  const evaluated = report.cases.filter((r) => !r.skip && !r.error);
  report.summary = {
    total: cases.length,
    pass,
    fail,
    skip: report.cases.filter((r) => r.skip).length,
    pipeline_ok_rate: cases.length > 0 ? pass / cases.length : 0,
    fw_applied_total: evaluated.reduce((s, r) => s + (r.fw_applied_count || 0), 0),
    text_changed_count: evaluated.filter((r) => r.text_changed).length,
    lexicon_runtime_ok_count: evaluated.filter((r) => r.lexicon_runtime_status === 'ok').length,
    lexicon_runtime_v2_ok_count: evaluated.filter((r) => r.lexicon_runtime_v2_status === 'ok').length,
    batch_elapsed_sec: report.batch_elapsed_sec,
  };

  const outPath = path.join(__dirname, 'lexicon-v2-phase3-dialog200-batch-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log('Pipeline summary', JSON.stringify(report.summary, null, 2));
  console.log('Intent summary', JSON.stringify(report.intent, null, 2));
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
