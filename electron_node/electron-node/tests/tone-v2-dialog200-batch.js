#!/usr/bin/env node
/**
 * Tone V2 — generic dialog_200 deployment smoke (time-capped).
 * SSOT batch script for model iteration (p1 canonical, p2/p3 candidate, etc.).
 *
 * Usage:
 *   $env:TONE_MODEL_PATH = "...\tone_cnn_p2.npz"   # set before starting Electron Node / FW
 *   node tests/tone-v2-dialog200-batch.js --session tone-v2-p2-d200 --out experiments/p2-result.json
 *
 * Options:
 *   --session <id>       Session id (default: tone-v2-d200-v1)
 *   --out <path>         Output JSON (default: experiments/tone-v2-dialog200-batch-result.json)
 *   --max-minutes <n>    Time cap in minutes (default: 15)
 *   --limit <n>          Max cases from manifest
 *   --wait-fw            Wait for FW utterance_ready (default: true)
 *   --no-wait-fw         Skip FW readiness wait
 *   --warmup-cases <n>   Run first n cases before timed batch (ASR warm-up; default: 0)
 *
 * Env: PROJECT_ROOT, TONE_MODEL_PATH (recorded in report only; must be set at Node/FW start)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const opts = {
    maxMinutes: 15,
    limit: null,
    sessionId: 'tone-v2-d200-v1',
    outPath: null,
    waitFw: true,
    warmupCases: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-minutes' && argv[i + 1]) {
      opts.maxMinutes = parseFloat(argv[++i]);
    } else if (a === '--limit' && argv[i + 1]) {
      opts.limit = parseInt(argv[++i], 10);
    } else if (a === '--session' && argv[i + 1]) {
      opts.sessionId = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      opts.outPath = argv[++i];
    } else if (a === '--wait-fw') {
      opts.waitFw = true;
    } else if (a === '--no-wait-fw') {
      opts.waitFw = false;
    } else if (a === '--warmup-cases' && argv[i + 1]) {
      opts.warmupCases = parseInt(argv[++i], 10);
    }
  }
  return opts;
}

const { getFwFrozenPort, resolveProjectRoot } = require('./lib/fw-port-ssot.js');
const { classifyFwHealthResponse } = require('./lib/fw-health-identity.js');

const opts = parseArgs(process.argv.slice(2));
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const OUT_PATH = opts.outPath
  ? path.isAbsolute(opts.outPath)
    ? opts.outPath
    : path.join(__dirname, opts.outPath)
  : path.join(__dirname, 'experiments', 'tone-v2-dialog200-batch-result.json');
const SESSION_ID = opts.sessionId;
const FW_PORT = getFwFrozenPort(PROJECT_ROOT);
const TONE_MODEL_PATH = process.env.TONE_MODEL_PATH || null;

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

function buildMigrationPayload(sessionId) {
  const body = {
    schemaVersion: 'session-migration-v1',
    exportedAtMs: Date.now(),
    sourceNodeId: 'tone-v2-dialog200-batch',
    sessionId,
    assignedNodeId: 'node-local',
    sourceLang: 'zh',
    targetLangs: ['en'],
    rollingContext: [],
    activeLexiconProfile: {
      primaryDomain: 'general',
      secondaryDomains: [],
      boosts: { general: 1.0 },
      profileVersion: `${sessionId}-profile`,
      confidence: 1,
      effectiveFromTurn: 0,
    },
    profileHistory: [],
    finalizedTurnCount: 0,
    lastIntentAtMs: 0,
    intentDiagnostics: { lexiconV2Configured: true, intentLastOutcome: 'disabled' },
  };
  const checksum = `sha256:${crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')}`;
  return { ...body, checksum };
}

async function importSession(port, sessionId) {
  const res = await fetch(`http://127.0.0.1:${port}/session-migration/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetNodeId: 'node-local',
      replaceExisting: true,
      payload: buildMigrationPayload(sessionId),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`session import HTTP ${res.status}`);
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

async function probeFwHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${FW_PORT}/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json().catch(() => ({}));
    const identity = classifyFwHealthResponse(body, res.status);
    if (identity.code === 'WRONG_SERVICE_ON_FW_PORT') {
      throw new Error(`WRONG_SERVICE_ON_FW_PORT on ${FW_PORT}: ${identity.detail}`);
    }
    if (!res.ok) return { ok: false, httpStatus: res.status, identity };
    const readiness = body.readiness || {};
    const worker = body.asr_worker || {};
    return {
      ok: true,
      status: body.status,
      utterance_ready: readiness.utterance_ready === true,
      worker_alive: worker.is_running === true && worker.worker_pid != null,
      worker_state: worker.worker_state,
      worker_pid: worker.worker_pid,
      queue_depth: worker.queue_depth,
      readiness,
      identity,
    };
  } catch (e) {
    if (e.message?.includes('WRONG_SERVICE_ON_FW_PORT')) throw e;
    return { ok: false, error: e.message };
  }
}

async function waitFwReady(maxMs = 180000) {
  const start = Date.now();
  let last = await probeFwHealth();
  if (last.utterance_ready) return last;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 5000));
    last = await probeFwHealth();
    if (last.utterance_ready) return last;
  }
  return last;
}

async function runWav(port, wavPath, utteranceIndex, sessionId) {
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

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function extractRow(caseDef, data, idx) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const spanV4 = fw.spanAssemblyV4 || {};
  const toneDiag = spanV4.tone || fw.tone || {};
  const asrTone = extra.utterance_tone || extra.tone || null;
  const text = (data.text_asr || '').trim();
  const raw = (extra.raw_asr_text || text).trim();
  const expected = caseDef.expectedText || caseDef.utterance || '';
  const nExp = norm(expected);
  const nOut = norm(text);
  const cer = nExp.length ? levenshtein(nExp, nOut) / nExp.length : null;
  const skippedReason = asrTone?.skippedReason ?? null;

  return {
    id: caseDef.id,
    scenario: caseDef.scenario,
    utterance_index: idx,
    durationSec: caseDef.durationSec,
    expected_preview: expected.slice(0, 80),
    text_asr: text,
    raw_asr_text: raw,
    text_changed: raw.length > 0 && text !== raw,
    cer,
    exact_match: nOut === nExp,
    pipeline_ms: extra.pipeline_ms,
    asr_ms: extra.asr_ms,
    fw_detector_step_ms: extra.fw_detector_step_ms,
    fw_triggered: fw.triggered,
    fw_applied_count: fw.summary?.appliedCount ?? 0,
    span_count: fw.summary?.spanCount ?? (fw.spans || []).length,
    sentence_rerank: fw.sentenceRerank
      ? {
          pickedIsRaw: fw.sentenceRerank.pickedIsRaw,
          maxDelta: fw.sentenceRerank.maxDelta,
          combinationCount: fw.sentenceRerank.combinationCount,
        }
      : null,
    tone: {
      asr_payload: asrTone
        ? {
            toneEnabled: asrTone.toneEnabled,
            sliceCount: asrTone.sliceCount ?? asrTone.acousticToneSlices?.length,
            skippedReason,
            model_error: skippedReason === 'model_error',
          }
        : null,
      recall: {
        toneEnabled: toneDiag.toneEnabled,
        toneSkippedReason: toneDiag.toneSkippedReason,
        toneSliceCount: toneDiag.toneSliceCount,
        recallToneCompatibleCount: toneDiag.recallToneCompatibleCount ?? 0,
        recallToneFallbackCount: toneDiag.recallToneFallbackCount ?? 0,
        toneExactHitCount: toneDiag.toneExactHitCount ?? 0,
        plainFallbackHitCount: toneDiag.plainFallbackHitCount ?? 0,
        ngramTonePatternHitCount: toneDiag.ngramTonePatternHitCount ?? 0,
      },
      assembly_guard_absent: spanV4.metrics?.toneGuardBlockedCount == null,
      effective_chain:
        asrTone?.toneEnabled === true &&
        toneDiag.toneEnabled === true &&
        ((toneDiag.recallToneFallbackCount ?? 0) > 0 || (toneDiag.recallToneCompatibleCount ?? 0) > 0),
    },
    spanAssemblyV4_metrics: spanV4.metrics
      ? {
          domainCandidateCount: spanV4.metrics.domainCandidateCount,
          baseCandidateCount: spanV4.metrics.baseCandidateCount,
          mainDomainAwareSpanSetsTotal: spanV4.metrics.mainDomainAwareSpanSetsTotal,
        }
      : null,
  };
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function artifactMetadata(modelPath) {
  if (!modelPath) return { path: null, exists: false };
  const meta = { path: modelPath, exists: fs.existsSync(modelPath) };
  if (meta.exists) {
    const st = fs.statSync(modelPath);
    meta.sizeBytes = st.size;
    meta.mtime = st.mtime.toISOString();
  }
  return meta;
}

async function runCaseBatch(port, cases, dialogDir, sessionId, { maxElapsedMs, batchStart, label }) {
  const rows = [];
  for (let idx = 0; idx < cases.length; idx++) {
    if (maxElapsedMs != null && Date.now() - batchStart >= maxElapsedMs) {
      return { rows, time_limit_reached: true };
    }
    const caseDef = cases[idx];
    const wavPath = path.join(dialogDir, caseDef.file || caseDef.audio);
    if (!fs.existsSync(wavPath)) {
      rows.push({ id: caseDef.id, skip: true, error: 'missing wav' });
      continue;
    }
    const t0 = Date.now();
    try {
      const data = await runWav(port, wavPath, idx, sessionId);
      const row = extractRow(caseDef, data, idx);
      row.case_elapsed_ms = Date.now() - t0;
      rows.push(row);
      const prefix = label ? `[${label}]` : '';
      console.log(
        `${prefix}[${row.id}] cer=${row.cer?.toFixed(3) ?? 'n/a'} fw=${row.fw_triggered} tone=${row.tone.recall.toneEnabled} effective=${row.tone.effective_chain} model_err=${row.tone.asr_payload?.model_error ?? false} ms=${row.case_elapsed_ms}`
      );
    } catch (e) {
      rows.push({ id: caseDef.id, error: e.message, case_elapsed_ms: Date.now() - t0 });
      console.log(`${label ? `[${label}]` : ''}[${caseDef.id}] ERROR ${e.message}`);
    }
  }
  return { rows, time_limit_reached: false };
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('Missing manifest:', MANIFEST_PATH);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  let cases = manifest.cases || manifest;
  if (opts.limit > 0) cases = cases.slice(0, opts.limit);

  const port = getPort();
  console.log(
    `Tone V2 dialog_200 batch port=${port} fw=${FW_PORT} session=${SESSION_ID} maxMinutes=${opts.maxMinutes}`
  );
  if (TONE_MODEL_PATH) console.log(`TONE_MODEL_PATH=${TONE_MODEL_PATH}`);
  else console.log('TONE_MODEL_PATH=(not set in this shell; recorded as null)');

  let fwHealth = null;
  if (opts.waitFw) {
    fwHealth = await waitFwReady();
    console.log('FW health:', JSON.stringify(fwHealth));
  }

  if (!(await waitHealth(port))) {
    console.error('Node test server not ready on port', port);
    process.exit(1);
  }

  await importSession(port, SESSION_ID);

  const warmupRows = [];
  if (opts.warmupCases > 0) {
    const warmupSlice = cases.slice(0, Math.min(opts.warmupCases, cases.length));
    console.log(`Warm-up: running ${warmupSlice.length} case(s) before timed batch`);
    const warm = await runCaseBatch(port, warmupSlice, DIALOG_DIR, SESSION_ID, {
      maxElapsedMs: null,
      batchStart: Date.now(),
      label: 'warmup',
    });
    warmupRows.push(...warm.rows);
  }

  const batchStart = Date.now();
  const maxElapsedMs = opts.maxMinutes * 60 * 1000;
  const timed = await runCaseBatch(port, cases, DIALOG_DIR, SESSION_ID, {
    maxElapsedMs,
    batchStart,
    label: null,
  });

  const report = {
    timestamp: new Date().toISOString(),
    testScope: 'Tone V2 dialog_200 deployment smoke (generic batch)',
    sessionId: SESSION_ID,
    port,
    fwPort: FW_PORT,
    maxMinutes: opts.maxMinutes,
    warmup_cases: opts.warmupCases,
    deploymentConfig: {
      TONE_MODEL_PATH,
      artifact: artifactMetadata(TONE_MODEL_PATH),
      envInheritedByFwWorker: true,
    },
    fwHealthAtStart: fwHealth,
    warmup: warmupRows,
    cases: timed.rows,
    time_limit_reached: timed.time_limit_reached,
  };

  const ok = report.cases.filter((r) => !r.skip && !r.error);
  const cerList = ok.map((r) => r.cer).filter((n) => typeof n === 'number');
  const pipelineMs = ok.map((r) => r.pipeline_ms).filter((n) => typeof n === 'number');
  const fwMs = ok.map((r) => r.fw_detector_step_ms).filter((n) => typeof n === 'number');
  const caseMs = ok.map((r) => r.case_elapsed_ms).filter((n) => typeof n === 'number');

  report.batch_elapsed_sec = Math.round((Date.now() - batchStart) / 1000);
  report.evaluated_count = ok.length;
  report.effective_chain_count = ok.filter((r) => r.tone?.effective_chain === true).length;
  report.model_error_count = ok.filter((r) => r.tone?.asr_payload?.model_error === true).length;
  report.toneEnabled_count = ok.filter((r) => r.tone?.asr_payload?.toneEnabled === true).length;
  report.recall_tone_active_count = ok.filter((r) => r.tone?.recall?.toneEnabled === true).length;
  report.assembly_guard_absent = ok.every((r) => r.tone?.assembly_guard_absent !== false);

  report.summary = {
    exact_match_rate: ok.length ? ok.filter((r) => r.exact_match).length / ok.length : 0,
    mean_cer: cerList.length ? cerList.reduce((a, b) => a + b, 0) / cerList.length : null,
    p50_cer: pct(cerList, 50),
    p95_cer: pct(cerList, 95),
    fw_triggered_rate: ok.length ? ok.filter((r) => r.fw_triggered).length / ok.length : 0,
    fw_applied_total: ok.reduce((s, r) => s + (r.fw_applied_count || 0), 0),
    tone_enabled_cases: report.toneEnabled_count,
    tone_recall_active: report.recall_tone_active_count,
    recall_tone_compatible_total: ok.reduce((s, r) => s + (r.tone?.recall?.recallToneCompatibleCount || 0), 0),
    recall_tone_fallback_total: ok.reduce((s, r) => s + (r.tone?.recall?.recallToneFallbackCount || 0), 0),
    tone_effective_chain_cases: report.effective_chain_count,
    model_error_cases: report.model_error_count,
    assembly_guard_absent_all: report.assembly_guard_absent,
    pipeline_ms: {
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      mean: pipelineMs.length ? pipelineMs.reduce((a, b) => a + b, 0) / pipelineMs.length : 0,
    },
    fw_step_ms: { p50: pct(fwMs, 50), p95: pct(fwMs, 95) },
    case_ms: {
      p50: pct(caseMs, 50),
      p95: pct(caseMs, 95),
      mean: caseMs.length ? caseMs.reduce((a, b) => a + b, 0) / caseMs.length : 0,
    },
  };
  report.samples = ok.slice(0, 12);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nWrote ${OUT_PATH} evaluated=${ok.length} elapsed=${report.batch_elapsed_sec}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
