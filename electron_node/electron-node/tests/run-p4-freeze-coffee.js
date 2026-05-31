#!/usr/bin/env node
/**
 * P4 Sentence Rerank — restaurant profile coffee/cafe dialog subset (real audio).
 * Uses session-migration import for profile=restaurant (test-only plumbing).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COFFEE_CASE_IDS = [
  'd001',
  'd002',
  'd003',
  'd046',
  'd091',
  'd092',
  'd093',
  'd137',
  'd138',
  'd181',
  'd182',
];
const SESSION_ID = 'freeze-p4-coffee-restaurant-v1';

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
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

function buildMigrationPayload(sessionId) {
  const body = {
    schemaVersion: 'session-migration-v1',
    exportedAtMs: Date.now(),
    sourceNodeId: 'freeze-coffee-test',
    sessionId,
    assignedNodeId: 'node-local',
    sourceLang: 'zh',
    targetLangs: ['en'],
    rollingContext: [],
    activeLexiconProfile: {
      primaryDomain: 'restaurant',
      secondaryDomains: [],
      boosts: { general: 1.0, restaurant: 1.15 },
      profileVersion: 'freeze-coffee-v1',
      confidence: 1,
      effectiveFromTurn: 0,
    },
    profileHistory: [],
    finalizedTurnCount: 0,
    lastIntentAtMs: 0,
    intentDiagnostics: {
      lexiconV2Configured: true,
      intentServiceReachable: false,
      intentModelLoaded: false,
      intentInferenceAttempted: false,
      intentInferenceSucceeded: false,
      intentLastOutcome: 'disabled',
    },
  };
  return { ...body, checksum: `sha256:${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')}` };
}

async function importSession(port) {
  const res = await fetch(`http://127.0.0.1:${port}/session-migration/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetNodeId: 'node-local',
      replaceExisting: true,
      payload: buildMigrationPayload(SESSION_ID),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `import ${res.status}`);
}

async function runCase(port, caseDef, idx) {
  const wavPath = path.join(DIALOG_DIR, caseDef.file);
  const res = await fetch(`http://127.0.0.1:${port}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wavPath,
      srcLang: 'zh',
      tgtLang: 'en',
      use_lexicon: true,
      is_manual_cut: true,
      session_id: SESSION_ID,
      utterance_index: idx,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function extractRow(caseDef, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const sr = fw.sentenceRerank || null;
  const recall = fw.recallV2Diagnostics || null;
  const spans = (fw.spans || []).map((s) => s.spanText || s.text || s.span);
  const spanCandidateSets = (fw.spans || []).map((s) => ({
    span: s.spanText || s.text,
    candidates: (s.candidates || []).map((c) => ({
      word: c.word,
      source: c.source,
      selected: c.selected,
    })),
  }));
  const domainCandidates = (fw.spans || [])
    .flatMap((s) => s.candidates || [])
    .filter((c) => c.source === 'domain' || c.source === 'domain_alias' || c.domain_id === 'restaurant');

  return {
    id: caseDef.id,
    refUtterance: caseDef.utterance,
    rawText: (extra.raw_asr_text || '').trim(),
    finalText: (data.text_asr || '').trim(),
    spans,
    spanCandidateSets,
    domain_candidates: domainCandidates,
    sentenceCandidates: sr?.sentenceCandidates || sr?.candidates || [],
    combinationCount: sr?.combinationCount,
    kenlmBatchSize: sr?.kenlmQueryCount,
    pickedIsRaw: sr?.pickedIsRaw,
    pickedSentence: sr?.pickedSentence,
    replacements: fw.replacements || sr?.replacements || [],
    apply_count: fw.summary?.appliedCount ?? 0,
    recall_v2: recall,
    domain_hits: recall?.domain_hits ?? recall?.domainHits ?? 0,
    active_domain: extra.activeLexiconProfile?.primaryDomain || recall?.active_domain,
    fw_metadata_span_gate: fw.fwMetadataSpanGate,
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const byId = Object.fromEntries(manifest.map((c) => [c.id, c]));
  const cases = COFFEE_CASE_IDS.map((id) => byId[id]).filter(Boolean);
  const port = getPort();

  const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
  if (!health.ok) {
    console.error('Test server not ready on', port);
    process.exit(1);
  }

  await importSession(port);
  const rows = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    try {
      const data = await runCase(port, c, i);
      rows.push(extractRow(c, data));
      console.log(`[${c.id}] raw=${rows[rows.length - 1].rawText.slice(0, 40)} domain_hits=${rows[rows.length - 1].domain_hits}`);
    } catch (e) {
      rows.push({ id: c.id, error: e.message });
      console.log(`[${c.id}] ERROR`, e.message);
    }
  }

  const out = {
    timestamp: new Date().toISOString(),
    method: 'real audio + session-migration restaurant profile',
    session_id: SESSION_ID,
    case_ids: COFFEE_CASE_IDS,
    rows,
    summary: {
      total: rows.length,
      domain_hits_total: rows.reduce((s, r) => s + (r.domain_hits || 0), 0),
      sentence_rerank_jobs: rows.filter((r) => r.combinationCount != null).length,
      apply_total: rows.reduce((s, r) => s + (r.apply_count || 0), 0),
    },
  };

  const outPath = path.join(__dirname, 'p4-freeze-coffee-result.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log(JSON.stringify(out.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
