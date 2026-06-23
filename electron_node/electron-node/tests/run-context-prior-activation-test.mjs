#!/usr/bin/env node
/**
 * FW Repair V4 — Context Prior E2E Activation Test
 * Uses session-migration/import (same as P4 freeze) — test plumbing only.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const AUDIO_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200', 'context_prior');
const MANIFEST_PATH = path.join(AUDIO_DIR, 'context_prior_manifest.json');
const OUT_JSON = path.join(__dirname, 'context-prior-activation-test-result.json');

const PHASES = [
  {
    name: 'restaurant',
    sessionId: 'cp-restaurant-test',
    primaryDomain: 'restaurant',
    caseIds: ['cp_001', 'cp_002', 'cp_003', 'cp_006', 'cp_008', 'cp_009'],
  },
  {
    name: 'travel',
    sessionId: 'cp-travel-test',
    primaryDomain: 'travel',
    caseIds: ['cp_001', 'cp_002', 'cp_003', 'cp_004', 'cp_006'],
  },
  {
    name: 'general',
    sessionId: 'cp-general-test',
    primaryDomain: 'general',
    caseIds: ['cp_001', 'cp_002', 'cp_003'],
  },
];

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

function buildMigrationPayload(sessionId, primaryDomain) {
  const boosts = { general: 1.0 };
  if (primaryDomain !== 'general') {
    boosts[primaryDomain] = 1.15;
  }
  const body = {
    schemaVersion: 'session-migration-v1',
    exportedAtMs: Date.now(),
    sourceNodeId: 'context-prior-activation-test',
    sessionId,
    assignedNodeId: 'node-local',
    sourceLang: 'zh',
    targetLangs: ['en'],
    rollingContext: [],
    activeLexiconProfile: {
      primaryDomain,
      secondaryDomains: [],
      boosts,
      profileVersion: `cp-activation-${primaryDomain}-v1`,
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

async function importSession(port, sessionId, primaryDomain) {
  const res = await fetch(`http://127.0.0.1:${port}/session-migration/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetNodeId: 'node-local',
      replaceExisting: true,
      payload: buildMigrationPayload(sessionId, primaryDomain),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `import ${res.status}`);
  return data;
}

async function runWav(port, wavPath, sessionId, utteranceIndex) {
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
      utterance_index: utteranceIndex,
      lexicon_v2_intent_enabled: false,
    }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function extractRow(phase, caseDef, data, utteranceIndex) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const runtime = fw.runtime || {};
  const v4 = fw.spanAssemblyV4 || {};
  const vote = v4.domainVote || {};
  return {
    phase: phase.name,
    sessionId: phase.sessionId,
    expectedPrior: phase.primaryDomain,
    id: caseDef.id,
    file: caseDef.file,
    text: caseDef.text,
    utterance_index: utteranceIndex,
    utteranceDomain: v4.utteranceDomain ?? vote.utteranceDomain ?? null,
    domainScores: v4.domainScores ?? vote.domainScores ?? {},
    insufficientEvidence: v4.insufficientEvidence ?? vote.insufficientEvidence ?? null,
    contextPriorDomain: runtime.contextPriorDomain ?? null,
    contextPriorApplied: runtime.contextPriorApplied ?? false,
    contextPriorSkippedReason: runtime.contextPriorSkippedReason ?? null,
    contextPriorMultiplierMin: v4.contextPriorMultiplierMin ?? null,
    contextPriorMultiplierMax: v4.contextPriorMultiplierMax ?? null,
    recallScopeSource: runtime.recallScopeSource ?? v4.recallScopeSource ?? null,
    availableFineDomains: runtime.availableFineDomains ?? null,
    domainHierarchyVersion: runtime.domainHierarchyVersion ?? null,
    fw_applied_count: fw.summary?.appliedCount ?? 0,
    pipeline_ms: extra.pipeline_ms ?? null,
    raw_asr: (extra.raw_asr_text || '').slice(0, 100),
    final_asr: (data.text_asr || '').slice(0, 100),
  };
}

function summarizePhase(rows) {
  const applied = rows.filter((r) => r.contextPriorApplied === true);
  const mins = rows.map((r) => r.contextPriorMultiplierMin).filter((n) => typeof n === 'number');
  const maxs = rows.map((r) => r.contextPriorMultiplierMax).filter((n) => typeof n === 'number');
  const skipped = {};
  for (const r of rows) {
    const reason = r.contextPriorSkippedReason || '(none)';
    skipped[reason] = (skipped[reason] || 0) + 1;
  }
  const domains = {};
  for (const r of rows) {
    const d = r.utteranceDomain || 'unknown';
    domains[d] = (domains[d] || 0) + 1;
  }
  return {
    caseCount: rows.length,
    contextPriorAppliedCount: applied.length,
    contextPriorAppliedRate: rows.length ? applied.length / rows.length : 0,
    utteranceDomain_dist: domains,
    skippedReasonCounts: skipped,
    multiplierMin: mins.length ? Math.min(...mins) : null,
    multiplierMax: maxs.length ? Math.max(...maxs) : null,
    multiplierMinAll: mins,
    multiplierMaxAll: maxs,
  };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const byId = Object.fromEntries(manifest.map((c) => [c.id, c]));
  const port = getPort();

  try {
    const h = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    if (!h.ok) throw new Error(`health ${h.status}`);
  } catch (e) {
    console.error('Test server not ready:', e.message);
    process.exit(1);
  }

  const report = {
    timestamp: new Date().toISOString(),
    port,
    audioDir: AUDIO_DIR,
    phases: [],
    allRows: [],
  };

  for (const phase of PHASES) {
    console.log(`\n=== Phase: ${phase.name} (${phase.sessionId}) ===`);
    await importSession(port, phase.sessionId, phase.primaryDomain);
    const rows = [];
    let idx = 0;
    for (const caseId of phase.caseIds) {
      const caseDef = byId[caseId];
      if (!caseDef) {
        console.warn('missing case', caseId);
        continue;
      }
      const wavPath = path.join(AUDIO_DIR, caseDef.file);
      console.log(`[${phase.name}] ${caseId} ${caseDef.file}`);
      try {
        const data = await runWav(port, wavPath, phase.sessionId, idx);
        idx += 1;
        const row = extractRow(phase, caseDef, data, idx - 1);
        rows.push(row);
        console.log(
          `  vote=${row.utteranceDomain} applied=${row.contextPriorApplied} min=${row.contextPriorMultiplierMin} max=${row.contextPriorMultiplierMax} skip=${row.contextPriorSkippedReason}`
        );
      } catch (e) {
        rows.push({
          phase: phase.name,
          id: caseId,
          error: e.message,
        });
        console.log('  ERROR', e.message);
      }
    }
    const summary = summarizePhase(rows.filter((r) => !r.error));
    report.phases.push({ ...phase, summary, rows });
    report.allRows.push(...rows);
  }

  // Vote consistency: same case id across phases
  const voteConsistency = [];
  const caseIds = [...new Set(report.allRows.map((r) => r.id).filter(Boolean))];
  for (const id of caseIds) {
    const perPhase = report.allRows.filter((r) => r.id === id && !r.error);
    if (perPhase.length < 2) continue;
    const domains = perPhase.map((r) => r.utteranceDomain);
    const scores = perPhase.map((r) => JSON.stringify(r.domainScores || {}));
    voteConsistency.push({
      id,
      utteranceDomains: domains,
      domainScoresEqual: scores.every((s) => s === scores[0]),
      phases: perPhase.map((r) => r.phase),
    });
  }

  report.voteConsistency = voteConsistency;
  report.voteConsistencyAllMatch = voteConsistency.every((v) => v.domainScoresEqual);

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log('\nWrote', OUT_JSON);
  return report;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
