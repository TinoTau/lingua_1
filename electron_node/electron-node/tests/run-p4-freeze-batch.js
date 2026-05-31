#!/usr/bin/env node
/**
 * P1~P4 freeze acceptance batch — dialog_200 with optional restaurant profile via session migration.
 * Test-only: imports session profile before audio pipeline; does not change main-chain logic.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assessFwDetectorContractPass } = require('./lib/fw-detector-contract-assess');

const args = process.argv.slice(2);
let limit = null;
let maxMinutes = null;
let profile = 'general';
let outSuffix = 'general';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limit = parseInt(args[i + 1], 10);
    i += 1;
  } else if (args[i] === '--max-minutes' && args[i + 1]) {
    maxMinutes = parseFloat(args[i + 1], 10);
    i += 1;
  } else if (args[i] === '--profile' && args[i + 1]) {
    profile = args[i + 1].trim().toLowerCase();
    outSuffix = profile;
    i += 1;
  }
}

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const BATCH_SESSION_ID =
  profile === 'restaurant' ? 'freeze-d200-restaurant-v1' : 'freeze-d200-general-v1';

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

function buildMigrationPayload(sessionId, primaryDomain) {
  const body = {
    schemaVersion: 'session-migration-v1',
    exportedAtMs: Date.now(),
    sourceNodeId: 'freeze-acceptance-test',
    sessionId,
    assignedNodeId: 'node-local',
    sourceLang: 'zh',
    targetLangs: ['en'],
    rollingContext: [],
    activeLexiconProfile: {
      primaryDomain,
      secondaryDomains: [],
      boosts: primaryDomain === 'general' ? { general: 1.0 } : { general: 1.0, [primaryDomain]: 1.15 },
      profileVersion: `freeze-${primaryDomain}-v1`,
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
  const checksum = `sha256:${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  return { ...body, checksum };
}

async function importSessionProfile(port, sessionId, primaryDomain) {
  const payload = buildMigrationPayload(sessionId, primaryDomain);
  const res = await fetch(`http://127.0.0.1:${port}/session-migration/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetNodeId: 'node-local',
      replaceExisting: true,
      payload,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `import HTTP ${res.status}`);
  return data;
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

function contractRow(caseDef, data, sessionId, utteranceIndex) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const text = (data.text_asr || '').trim();
  const raw = (extra.raw_asr_text || '').trim();
  const contract = assessFwDetectorContractPass(extra, data);
  const summary = fw.summary || {};
  const recallDiag = fw.recallV2Diagnostics || null;
  const metaGate = fw.fwMetadataSpanGate || null;
  const sentenceRerank = fw.sentenceRerank || null;
  const spanCount = summary.spanCount ?? (fw.spans || []).length;
  const activeDomain =
    extra.activeLexiconProfile?.primaryDomain ||
    recallDiag?.active_domain ||
    recallDiag?.activeDomain ||
    null;

  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    sessionId,
    utterance_index: utteranceIndex,
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
    span_count: spanCount,
    span_gate_mode: fw.configSnapshot?.spanGateMode,
    use_sentence_level_rerank: fw.configSnapshot?.useSentenceLevelRerank,
    fw_applied_count: summary.appliedCount ?? 0,
    sentence_rerank: sentenceRerank,
    recall_v2_diagnostics: recallDiag,
    fw_metadata_span_gate: metaGate,
    active_domain: activeDomain,
    domain_hits: recallDiag?.domain_hits ?? recallDiag?.domainHits ?? 0,
    extra_profile: extra.activeLexiconProfile || null,
  };
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('Missing manifest:', MANIFEST_PATH);
    process.exit(1);
  }

  let cases = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (limit > 0) cases = cases.slice(0, limit);

  const port = getPort();
  console.log(`P4 freeze batch profile=${profile} session=${BATCH_SESSION_ID} port=${port}`);

  if (!(await waitHealth(port))) {
    console.error('Test server not ready');
    process.exit(1);
  }

  if (profile === 'restaurant') {
    await importSessionProfile(port, BATCH_SESSION_ID, 'restaurant');
    console.log('Imported restaurant session profile');
  } else {
    await importSessionProfile(port, BATCH_SESSION_ID, 'general');
    console.log('Imported general session profile');
  }

  const batchStart = Date.now();
  const report = {
    timestamp: new Date().toISOString(),
    testScope: `P1~P4 freeze acceptance dialog_200 profile=${profile}`,
    config: {
      spanGateMode: 'fw_metadata_gate',
      useLexiconRuntimeV2Recall: true,
      useIndustryRouting: false,
      useSentenceLevelRerank: true,
      maxSpans: 4,
      kenlmSpanGate_enabled: false,
      profilePrimaryDomain: profile === 'restaurant' ? 'restaurant' : 'general',
      session_id: BATCH_SESSION_ID,
    },
    port,
    total: cases.length,
    cases: [],
    summary: {},
  };

  let pass = 0;
  let fail = 0;
  const maxElapsedMs = maxMinutes > 0 ? maxMinutes * 60 * 1000 : null;

  for (let idx = 0; idx < cases.length; idx++) {
    const caseDef = cases[idx];
    if (maxElapsedMs != null && Date.now() - batchStart >= maxElapsedMs) {
      report.time_limit_reached = true;
      break;
    }
    const wavPath = path.join(DIALOG_DIR, caseDef.file);
    if (!fs.existsSync(wavPath)) {
      report.cases.push({ id: caseDef.id, pass: false, skip: true, error: 'missing wav' });
      fail += 1;
      continue;
    }
    try {
      const data = await runWav(port, wavPath, BATCH_SESSION_ID, idx);
      const row = contractRow(caseDef, data, BATCH_SESSION_ID, idx);
      report.cases.push(row);
      if (row.pass) pass += 1;
      else fail += 1;
      if ((idx + 1) % 20 === 0) {
        console.log(`[progress] ${idx + 1}/${cases.length} pass=${pass} fail=${fail}`);
      }
    } catch (e) {
      fail += 1;
      report.cases.push({ id: caseDef.id, pass: false, error: e.message });
    }
  }

  const evaluated = report.cases.filter((r) => !r.skip && !r.error);
  const domainHits = evaluated.map((r) => r.domain_hits || 0);
  const spanCounts = evaluated.map((r) => r.span_count || 0);
  const metaGateMs = evaluated.map((r) => r.fw_metadata_gate_ms).filter((n) => typeof n === 'number');
  const pipelineMs = evaluated.map((r) => r.pipeline_ms).filter((n) => typeof n === 'number');
  const fwStepMs = evaluated.map((r) => r.fw_detector_step_ms).filter((n) => typeof n === 'number');
  const kenlmBatch = evaluated
    .map((r) => r.sentence_rerank?.kenlmQueryCount)
    .filter((n) => typeof n === 'number');
  const comboCounts = evaluated
    .map((r) => r.sentence_rerank?.combinationCount)
    .filter((n) => typeof n === 'number');

  report.batch_elapsed_sec = Math.round((Date.now() - batchStart) / 1000);
  report.evaluated_count = evaluated.length;
  report.summary = {
    total: cases.length,
    pass,
    fail,
    pipeline_ok_rate: evaluated.length > 0 ? pass / evaluated.length : 0,
    fw_applied_total: evaluated.reduce((s, r) => s + (r.fw_applied_count || 0), 0),
    sentence_rerank_jobs: evaluated.filter((r) => r.sentence_rerank).length,
    picked_raw_count: evaluated.filter((r) => r.sentence_rerank?.pickedIsRaw === true).length,
    picked_candidate_count: evaluated.filter((r) => r.sentence_rerank?.pickedIsRaw === false).length,
    domain_hits_total: domainHits.reduce((a, b) => a + b, 0),
    domain_hits_gt0_jobs: domainHits.filter((n) => n > 0).length,
    active_domain_distribution: evaluated.reduce((acc, r) => {
      const d = r.active_domain || 'unknown';
      acc[d] = (acc[d] || 0) + 1;
      return acc;
    }, {}),
    span_job_p95: pct(spanCounts, 95),
    span_job_max: spanCounts.length ? Math.max(...spanCounts) : 0,
    metadata_gate_ms_p95: pct(metaGateMs, 95),
    pipeline_ms_p95: pct(pipelineMs, 95),
    fw_detector_step_ms_p95: pct(fwStepMs, 95),
    kenlm_batch_p95: pct(kenlmBatch, 95),
    combination_count_p95: pct(comboCounts, 95),
    batch_elapsed_sec: report.batch_elapsed_sec,
  };

  const outPath = path.join(__dirname, `p4-freeze-batch-${outSuffix}-result.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log('Summary', JSON.stringify(report.summary, null, 2));
  process.exit(fail > 0 && pass === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
