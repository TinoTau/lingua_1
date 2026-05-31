#!/usr/bin/env node
/**
 * Phase 2 E2E: Session Intent SSOT via CPU LLM + multi-turn session.
 * Requires: node :5020, lexicon_intent_cpu :5018, faster-whisper-vad.
 *
 *   set PROJECT_ROOT=D:\Programs\github\lingua_1
 *   node tests/run-lexicon-v2-phase2-intent-e2e.mjs
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const INTENT_URL = process.env.LEXICON_INTENT_SERVICE_URL || 'http://127.0.0.1:5018';

function getPort() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  const alt = path.join(process.env.APPDATA || '', 'electron-node', 'electron-node-config.json');
  for (const p of [cfgPath, alt]) {
    if (fs.existsSync(p)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (cfg.testServer?.port) return cfg.testServer.port;
      } catch (_) {}
    }
  }
  return 5020;
}

async function waitUrl(url, maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function exportSession(port, sessionId) {
  const url = `http://127.0.0.1:${port}/session-migration/export/${encodeURIComponent(sessionId)}?sourceNodeId=phase2-e2e`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const body = await res.json();
  return body.payload || null;
}

async function runTurn(port, wavPath, sessionId, turnId) {
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
      turn_id: turnId,
      lexicon_v2_intent_enabled: true,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function pollSessionIntent(port, sessionId, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const payload = await exportSession(port, sessionId);
    const intent = payload?.lexiconSessionIntent;
    const summary = payload?.lexiconIntentSummary;
    const diag = payload?.intentDiagnostics;
    if (payload?.lexiconSessionIntent?.primaryDomain) {
      return { payload, intent: payload.lexiconSessionIntent, summary: payload.lexiconIntentSummary, diag: payload.intentDiagnostics, waitedMs: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function probeIntentService() {
  const health = await fetch(`${INTENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
  const h = await health.json();
  if (!h.model_loaded) throw new Error('Intent service model not loaded');

  const res = await fetch(`${INTENT_URL}/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'phase2-probe',
      currentPrimary: 'general',
      finalizedTurnCount: 1,
      turns: [
        {
          turnId: 't1',
          rawAsrText: '你好，我想点一杯热拿铁，中杯，少糖',
          finalText: '你好，我想点一杯热拿铁，中杯，少糖',
          activeProfileAtTurn: 'general',
          recoverStats: { noTopkCandidate: 0, domainBoostApplied: 0 },
        },
      ],
      allowedDomains: [
        { id: 'restaurant', displayName: 'Restaurant', allowLLMSelect: true },
        { id: 'travel', displayName: 'Travel', allowLLMSelect: true },
        { id: 'transport', displayName: 'Transport', allowLLMSelect: true },
        { id: 'tech_ai', displayName: 'Tech AI', allowLLMSelect: true },
      ],
      promptPackVersion: 'v1',
    }),
    signal: AbortSignal.timeout(90000),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Intent HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.decision || body;
}

function validateIntent(intent, label) {
  const errors = [];
  if (!intent) errors.push(`${label}: missing lexiconSessionIntent`);
  else {
    if (!intent.summary?.trim()) errors.push(`${label}: empty summary`);
    if (!intent.primaryDomain || intent.primaryDomain === 'general') {
      errors.push(`${label}: invalid primaryDomain=${intent.primaryDomain}`);
    }
    if (!Array.isArray(intent.topicKeywords)) errors.push(`${label}: topicKeywords not array`);
    if (!Array.isArray(intent.topicKeywordPinyinKeys)) {
      errors.push(`${label}: topicKeywordPinyinKeys not array`);
    }
    if (
      intent.topicKeywords?.length > 0 &&
      intent.topicKeywordPinyinKeys?.length === 0
    ) {
      errors.push(`${label}: pinyin keys empty while topicKeywords present`);
    }
    if (intent.source !== 'cpu_llm') errors.push(`${label}: source=${intent.source}`);
  }
  return errors;
}

async function main() {
  const port = getPort();
  console.log('Phase 2 E2E — port', port, 'intent', INTENT_URL);

  if (!(await waitUrl(`http://127.0.0.1:${port}/health`))) {
    console.error('Node test server not ready');
    process.exit(1);
  }
  if (!(await waitUrl(`${INTENT_URL}/health`))) {
    console.error('Intent service not ready');
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    projectRoot: PROJECT_ROOT,
    port,
    intentUrl: INTENT_URL,
    steps: [],
    pass: false,
  };

  try {
    const decision = await probeIntentService();
    report.steps.push({
      step: 'intent_service_direct',
      pass: true,
      primaryDomain: decision.primaryDomain,
      topicKeywords: decision.topicKeywords || [],
      summaryPreview: (decision.summary || '').slice(0, 80),
    });
    console.log('[probe] Intent service OK', decision.primaryDomain, decision.topicKeywords);
  } catch (e) {
    report.steps.push({ step: 'intent_service_direct', pass: false, error: e.message });
    console.error('[probe] FAIL', e.message);
    fs.writeFileSync(
      path.join(__dirname, 'lexicon-v2-phase2-intent-e2e-result.json'),
      JSON.stringify(report, null, 2)
    );
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const cafeCases = manifest.filter((c) => c.scenario === 'cafe').slice(0, 1);
  const sessionId = `phase2-e2e-${Date.now()}`;

  for (let i = 0; i < cafeCases.length; i++) {
    const c = cafeCases[i];
    const wavPath = path.join(DIALOG_DIR, c.file);
    console.log(`[turn ${i + 1}] ${c.id}`, c.file);
    const data = await runTurn(port, wavPath, sessionId, `turn-${i + 1}`);
    report.steps.push({
      step: `pipeline_turn_${i + 1}`,
      id: c.id,
      pass: true,
      text_asr_preview: (data.text_asr || '').slice(0, 60),
      extra_intent: data.extra?.intentLastOutcome,
      lexiconV2Enabled: data.extra?.lexiconV2Enabled,
    });
  }

  console.log('[poll] waiting for lexiconSessionIntent...');
  const polled = await pollSessionIntent(port, sessionId, 120000);
  if (!polled) {
    report.steps.push({ step: 'session_intent_poll', pass: false, error: 'timeout' });
    console.error('Session intent poll timeout');
    fs.writeFileSync(
      path.join(__dirname, 'lexicon-v2-phase2-intent-e2e-result.json'),
      JSON.stringify(report, null, 2)
    );
    process.exit(1);
  }

  const errors = validateIntent(polled.intent, 'session');
  const turnBind = polled.intent
    ? {
        topicKeywords: polled.intent.topicKeywords,
        topicKeywordPinyinKeys: polled.intent.topicKeywordPinyinKeys,
        primaryDomain: polled.intent.primaryDomain,
        confidence: polled.intent.confidence,
        summary: polled.intent.summary,
        source: polled.intent.source,
        effectiveFromTurn: polled.intent.effectiveFromTurn,
      }
    : null;

  report.steps.push({
    step: 'session_intent_poll',
    pass: errors.length === 0,
    waitedMs: polled.waitedMs,
    errors,
    lexiconSessionIntent: turnBind,
    lexiconIntentSummary: polled.summary,
    intentLastOutcome: polled.diag?.lastOutcome,
    finalizedTurnCount: polled.payload?.finalizedTurnCount,
  });

  report.pass = errors.length === 0 && report.steps.every((s) => s.pass !== false);
  const outPath = path.join(__dirname, 'lexicon-v2-phase2-intent-e2e-result.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nWrote', outPath);
  console.log('PASS:', report.pass);
  if (turnBind) console.log('Intent:', JSON.stringify(turnBind, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
