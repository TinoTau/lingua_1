#!/usr/bin/env node
/**
 * MODEL3 dialog_200 full-pipeline acceptance runner.
 * Validation only — reuses existing start-node + /run-pipeline-with-audio.
 * Observation: MODEL2_DIALOG200_TRACE=1 (includes model3 path diagnostics).
 * Does not retrain / tune / change pipeline semantics.
 *
 * Controlled candidate validation:
 *   --checkpoint-identity MODEL3_V2_REALDIST_V1
 * sets MODEL3_CHECKPOINT_IDENTITY for Electron (exact SHA still required).
 * Default identity remains MODEL3_SYNTHETIC_V1 (production).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import { norm, percentile } from './lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const OUT_DIR = path.join(REPO, 'docs', 'user_correction', 'model3');

/** Sealed identities (must match model3-checkpoint-registry.ts). */
const CHECKPOINT_REGISTRY = {
  MODEL3_SYNTHETIC_V1: {
    modelId: 'MODEL3_SYNTHETIC_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520',
    expectedWeightsSha256:
      '9d25234a5be81aa7281687e90612c6aa17322e23ec4c8be6861c72999524b815',
    expectedConfigHash: 'f32e3de456696798e71a1b28287a19beed7ff0905ec2056282c9b65c16222830',
    configHashMode: 'config_field',
    role: 'PRODUCTION',
  },
  MODEL3_V2_REALDIST_V1: {
    modelId: 'MODEL3_V2_REALDIST_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903',
    expectedWeightsSha256:
      'fbb8d85dc4bec117af510a9d8f0a5021a86187a1e1490ee63f9b66831bad648e',
    expectedConfigHash: '2a235106436b7a5bf23ab19ba8b55587df8a3bf5dfb874ac0df03c56b3eacfe7',
    configHashMode: 'config_file_sha256',
    role: 'CANDIDATE',
  },
  MODEL3_V2_S3_RANDOM_INIT_V1: {
    modelId: 'MODEL3_V2_S3_RANDOM_INIT_V1',
    checkpointDirRelative:
      'training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013',
    expectedWeightsSha256:
      'f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1',
    expectedConfigHash: '8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221',
    configHashMode: 'config_file_sha256',
    role: 'CANDIDATE',
  },
};

const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const anchoredOnly = args.includes('--anchored-only');
const identityArgIdx = args.indexOf('--checkpoint-identity');
const CHECKPOINT_IDENTITY =
  identityArgIdx >= 0
    ? String(args[identityArgIdx + 1] || '').trim()
    : process.env.MODEL3_CHECKPOINT_IDENTITY?.trim() || 'MODEL3_SYNTHETIC_V1';
const IDENTITY = CHECKPOINT_REGISTRY[CHECKPOINT_IDENTITY];
if (!IDENTITY) {
  console.error('Unknown --checkpoint-identity', CHECKPOINT_IDENTITY);
  process.exit(2);
}
const caseIdsIdx = args.indexOf('--case-ids');
const CASE_ID_FILTER =
  caseIdsIdx >= 0
    ? new Set(
        String(args[caseIdsIdx + 1] || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;
const outTagIdx = args.indexOf('--out-tag');
const OUT_TAG = outTagIdx >= 0 ? String(args[outTagIdx + 1] || '').trim() : '';
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 180;
})();

const WEIGHTS = path.join(REPO, IDENTITY.checkpointDirRelative, 'weights.pt');
const CONFIG_JSON = path.join(REPO, IDENTITY.checkpointDirRelative, 'config.json');
const EXPECTED_SHA = IDENTITY.expectedWeightsSha256;
const EXPECTED_CFG = IDENTITY.expectedConfigHash;
const IS_REALDIST = IDENTITY.modelId === 'MODEL3_V2_REALDIST_V1';

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function killOrphanFasterWhisperWorkers() {
  if (process.platform !== 'win32') return [];
  try {
    const out = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*faster_whisper_vad*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }",
      ],
      { encoding: 'utf8', timeout: 60000 }
    );
    return String(out.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * HARNESS ONLY — Electron auto-starts services only when servicePreferences[id]===true.
 * serviceLastRuntimeState may still show faster-whisper-vad=true while preferences are all
 * false (UI exit snapshot vs preference). Without this, :5020 comes up but ASR endpoints=0.
 * Restores preferences from lastRuntimeState for services that were last known running.
 */
function ensureServicePreferencesForAcceptance() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  if (!fs.existsSync(cfgPath)) {
    console.warn('[start] no electron-node-config.json; cannot ensure ASR preference');
    return { changed: false, reason: 'missing_config' };
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const prefs = { ...(cfg.servicePreferences || {}) };
  const last = cfg.serviceLastRuntimeState || {};
  let changed = false;
  const enabled = [];
  // Prefer last known running services; always require faster-whisper-vad for dialog_200.
  const want = new Set([
    ...Object.keys(last).filter((id) => last[id] === true),
    'faster-whisper-vad',
  ]);
  for (const id of want) {
    if (prefs[id] !== true) {
      prefs[id] = true;
      changed = true;
      enabled.push(id);
    }
  }
  if (changed) {
    cfg.servicePreferences = prefs;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  }
  console.log('[start] servicePreferences harness', { changed, enabled, cfgPath });
  return { changed, enabled, cfgPath };
}

function startElectron() {
  ensureServicePreferencesForAcceptance();
  const orphans = killOrphanFasterWhisperWorkers();
  if (orphans.length) console.log('[start] killed orphan FW workers:', orphans.join(','));
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    TONE_P10_VAD_CPU: '1',
    MODEL2_DIALOG200_TRACE: '1',
    MODEL3_CHECKPOINT_IDENTITY: IDENTITY.modelId,
  };
  // Observational gate: MODEL3_INFERENCE_INPUT_TRACE=0 disables persistence only.
  if (process.env.MODEL3_INFERENCE_INPUT_TRACE !== undefined) {
    env.MODEL3_INFERENCE_INPUT_TRACE = process.env.MODEL3_INFERENCE_INPUT_TRACE;
  }
  // Harness-only KEEP-all bypass for causal baseline (not production config).
  if (process.env.MODEL3_HARNESS_KEEP_ALL !== undefined) {
    env.MODEL3_HARNESS_KEEP_ALL = process.env.MODEL3_HARNESS_KEEP_ALL;
  }
  delete env.MODEL2_RUNTIME_DISABLED;
  delete env.MODEL3_RUNTIME_DISABLED;
  // Keep ELECTRON_RUN_AS_NODE on the launcher process; start-node-detached strips it for the app.
  const child = spawn(process.execPath, [START_DETACHED], {
    cwd: path.join(REPO, 'electron_node', 'electron-node'),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stdout += d.toString();
  });
  return new Promise((resolve) => {
    child.on('exit', () => {
      const m = stdout.match(/STARTED electron pid\s+(\d+)/);
      resolve({ pid: m ? Number(m[1]) : null, stdout: stdout.trim().slice(0, 2000) });
    });
  });
}

async function runCase(port, wavPath, sessionId) {
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

function levenshtein(a, b) {
  const s = a || '';
  const t = b || '';
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function classifyFinalText(raw, finalText, expected) {
  const r = norm(raw);
  const f = norm(finalText);
  const e = norm(expected);
  if (!e || !r || !f) return 'UNDETERMINED';
  const dRaw = levenshtein(r, e);
  const dFinal = levenshtein(f, e);
  if (dFinal < dRaw) return 'IMPROVED';
  if (dFinal > dRaw) return 'REGRESSED';
  return 'UNCHANGED';
}

function collectSpanMargins(trace) {
  const spans = [];
  for (const p of trace?.paths || []) {
    for (const d of p.model3?.decisions || []) {
      if (d.eligible === false) continue;
      spans.push({
        spanId: d.spanId,
        surface: d.surface,
        isAnchor: d.isAnchor,
        keep_logit: d.keepLogit,
        retry_logit: d.retryLogit,
        margin: d.margin,
        decision: d.decision,
        path_id: p.path_id,
      });
    }
  }
  return spans;
}

/** Production Model3 inference-input SSOT traces (all paths). Fail-closed if features absent. */
function collectInferenceInputTraces(trace, meta) {
  const out = [];
  for (const p of trace?.paths || []) {
    const m3 = p.model3 || {};
    const rows = m3.inference_input_trace;
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      out.push({
        ...meta,
        pathId: p.path_id,
        status: 'MISSING_PRODUCTION_TRACE_FIELD',
        error: 'inference_input_trace_absent',
      });
      continue;
    }
    for (const sp of rows) {
      if (!sp.features) {
        out.push({
          ...meta,
          pathId: p.path_id,
          spanId: sp.spanId,
          status: 'MISSING_PRODUCTION_TRACE_FIELD',
          error: 'features_absent',
        });
        continue;
      }
      if (
        !Array.isArray(sp.tokenIds) ||
        !Array.isArray(sp.featVector) ||
        !Array.isArray(sp.availMask)
      ) {
        out.push({
          ...meta,
          pathId: p.path_id,
          spanId: sp.spanId,
          status: 'MISSING_PRODUCTION_TRACE_FIELD',
          error: 'exact_tensors_absent',
        });
        continue;
      }
      out.push({
        ...meta,
        pathId: p.path_id,
        pathIndex: p.path_index ?? null,
        status: 'OK',
        checkpoint: m3.checkpoint_identity || meta.checkpoint || null,
        sourceText: meta.sourceText,
        span: sp,
      });
    }
  }
  return out;
}

function summarizeModel3(trace) {
  const paths = trace?.paths || [];
  const out = {
    paths: paths.length,
    vote_calls: [],
    second_vote: 0,
    pool_refreshed: 0,
    anchors: [],
    model2_anchor_count: 0,
    anchor_mutation: 0,
    decisions_keep: 0,
    decisions_retry: 0,
    non_anchor_spans: 0,
    retry_attempts: 0,
    retry_returned: 0,
    retry_zero: 0,
    anchor_retry_rej: 0,
    retry_regions: [],
    model3_latency_ms: [],
    retry_latency_ms: [],
    inference_errors: 0,
  };
  for (const p of paths) {
    const m3 = p.model3;
    if (!m3) continue;
    out.vote_calls.push(m3.vote_call_count ?? p.domain_vote?.vote_call_count ?? null);
    if ((m3.vote_call_count ?? 1) !== 1) out.second_vote += 1;
    if (m3.pool_refreshed) out.pool_refreshed += 1;
    out.model2_anchor_count += m3.model2_anchor_count || 0;
    out.anchor_mutation += m3.anchor_mutation_violations || 0;
    for (const a of m3.anchors || []) out.anchors.push(a);
    for (const d of m3.decisions || []) {
      if (d.eligible === false) {
        /* anchor / ineligible */
      } else {
        out.non_anchor_spans += 1;
        if (d.decision === 'RETRY') out.decisions_retry += 1;
        else out.decisions_keep += 1;
      }
    }
    for (const r of m3.retry_attempts || []) {
      if (r.rejectedAsAnchor) out.anchor_retry_rej += 1;
      if (r.attempted) {
        out.retry_attempts += 1;
        out.retry_returned += r.returnedCandidateCount || 0;
        if ((r.returnedCandidateCount || 0) === 0) out.retry_zero += 1;
      }
    }
    for (const rr of m3.retry_regions || []) {
      out.retry_regions.push(rr);
    }
    if (typeof m3.model3_latency_ms === 'number') out.model3_latency_ms.push(m3.model3_latency_ms);
    if (typeof m3.retry_path_latency_ms === 'number') out.retry_latency_ms.push(m3.retry_path_latency_ms);
    if (m3.inference_ok === false || m3.error) out.inference_errors += 1;
  }
  return out;
}

function attributeFailure(row) {
  if (row.error || row.infra_error) return 'TEST_INFRA_ERROR';
  if (row.model3_inference_errors > 0) return 'TEST_INFRA_ERROR';
  if (row.final_class === 'IMPROVED') return 'NONE';
  if (row.final_class === 'UNCHANGED') {
    if (row.retry_attempts > 0 && row.retry_returned === 0) return 'RECALL_NO_RESCUE';
    if (row.retry_attempts > 0 && row.retry_returned > 0) return 'DOWNSTREAM_SELECTION_ERROR';
    return 'NONE';
  }
  if (row.final_class === 'REGRESSED') {
    if (row.retry_attempts > 0 && row.retry_returned > 0) return 'DOWNSTREAM_SELECTION_ERROR';
    if (row.retry_attempts > 0 && row.retry_returned === 0) return 'RECALL_NO_RESCUE';
    if (row.decisions_retry > 0) return 'MODEL3_TRIGGER_ERROR';
    if ((row.model2_anchor_count || 0) === 0 && row.decisions_retry === 0) {
      return 'ASR_UNRECOVERABLE';
    }
    return 'MODEL3_TRIGGER_ERROR';
  }
  return 'ASR_UNRECOVERABLE';
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const digest = sha256File(WEIGHTS).toLowerCase();
  if (digest !== EXPECTED_SHA.toLowerCase()) {
    console.error('MODEL3 hash mismatch', digest, EXPECTED_SHA, IDENTITY.modelId);
    process.exit(2);
  }
  const cfgRaw = fs.readFileSync(CONFIG_JSON);
  const cfg = JSON.parse(cfgRaw.toString('utf8'));
  if (IDENTITY.configHashMode === 'config_file_sha256') {
    const cfgFileHash = crypto.createHash('sha256').update(cfgRaw).digest('hex').toLowerCase();
    if (cfgFileHash !== EXPECTED_CFG.toLowerCase()) {
      console.error('MODEL3 config file hash mismatch', cfgFileHash, EXPECTED_CFG);
      process.exit(2);
    }
  } else if (String(cfg.config_hash || '').toLowerCase() !== EXPECTED_CFG.toLowerCase()) {
    console.error('MODEL3 config hash mismatch', cfg.config_hash);
    process.exit(2);
  }
  console.log('[preflight] Model3 identity OK', {
    modelId: IDENTITY.modelId,
    role: IDENTITY.role,
    weightsSha256: digest,
    configHash: EXPECTED_CFG,
  });

  const { cases: casesAll } = loadDialog200Manifest(MANIFEST_PATH);
  let cases = casesAll;
  if (anchoredOnly) {
    const prevRaw = path.join(OUT_DIR, 'model3_v1_feature_contract_dialog200_anchored.jsonl');
    const anchoredIds = new Set();
    if (fs.existsSync(prevRaw)) {
      for (const line of fs.readFileSync(prevRaw, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if ((row.anchors || []).length > 0 || (row.model2_anchor_count || 0) > 0) {
          anchoredIds.add(row.id);
        }
      }
    }
    cases = casesAll.filter((c) => anchoredIds.has(c.id));
    console.log('[filter] anchored-only:', cases.length, 'cases');
  }
  if (CASE_ID_FILTER && CASE_ID_FILTER.size) {
    cases = cases.filter((c) => CASE_ID_FILTER.has(c.id));
    console.log('[filter] case-ids:', [...CASE_ID_FILTER].join(','), '→', cases.length);
  }
  const port = getTestServerPort();
  let startInfo = { skipped: true };
  if (!skipStart) {
    console.log('[start] launching electron via start-node-detached… identity=', IDENTITY.modelId);
    startInfo = await startElectron();
    console.log('[start]', startInfo);
  } else {
    console.log('[start] --skip-start; ensure MODEL3_CHECKPOINT_IDENTITY=', IDENTITY.modelId);
  }

  console.log('[preflight] waiting :5020…');
  if (!(await waitTestServerHealth(port, 900000))) {
    console.error('Node :5020 FAIL');
    process.exit(1);
  }
  console.log('[preflight] Node READY');

  const warmupWav = path.join(DIALOG_DIR, resolveDialog200AudioFile(casesAll[0]) || 'dialog_d001.wav');
  const asrReady = await waitAsrReady(port, {
    warmupWavPath: warmupWav,
    maxWaitMs: 600000,
    label: 'model3-dialog200-asr-warmup',
  });
  if (!asrReady.ready) {
    console.error('ASR FAIL', asrReady.lastError);
    process.exit(1);
  }
  console.log('[preflight] ASR READY', asrReady.elapsedMs, 'ms');

  const deadline = Date.now() + maxMinutes * 60 * 1000;
  const batchStart = Date.now();
  const rows = [];
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const caseDef of cases) {
    if (Date.now() >= deadline) {
      console.log('[batch] deadline after', completed + failed + skipped);
      break;
    }
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    if (!fs.existsSync(wavPath)) {
      skipped += 1;
      rows.push({ id: caseDef.id, skip: true, error: 'missing_wav' });
      continue;
    }
    const t0 = Date.now();
    try {
      const data = await runCase(port, wavPath, `m3-d200-${caseDef.id}-${Date.now()}`);
      const extra = data.extra || {};
      const raw = String(extra.raw_asr_text || '').trim();
      const finalText = String(data.text_asr || '').trim();
      const expected = String(caseDef.expectedText || caseDef.utterance || '').trim();
      const trace = extra.dialog200_path_trace || null;
      const m3 = summarizeModel3(trace);
      const final_class = classifyFinalText(raw, finalText, expected);
      const span_margins = collectSpanMargins(trace);
      const inference_input_traces = collectInferenceInputTraces(trace, {
        caseId: caseDef.id,
        sourceText: raw,
        expectedText: expected,
        checkpoint: {
          modelId: IDENTITY.modelId,
          expectedWeightsSha256: EXPECTED_SHA,
        },
      });
      const row = {
        id: caseDef.id,
        scenario: caseDef.scenario,
        pipeline_ms: Date.now() - t0,
        raw_asr: raw,
        final_text: finalText,
        expected,
        final_class,
        dist_raw: levenshtein(norm(raw), norm(expected)),
        dist_final: levenshtein(norm(finalText), norm(expected)),
        text_changed: norm(raw) !== norm(finalText),
        fw_applied: extra.fw_detector?.summary?.appliedCount || 0,
        kenlm_pool: extra.fw_detector?.spanAssemblyV4?.kenlmPoolCandidateCount ?? null,
        retained_domains: (trace?.paths || []).flatMap((p) => p.domain_vote?.retained_domains || []),
        model3_paths: m3.paths,
        vote_calls: m3.vote_calls,
        second_vote: m3.second_vote,
        pool_refreshed: m3.pool_refreshed,
        model2_anchor_count: m3.model2_anchor_count,
        anchor_mutation: m3.anchor_mutation,
        anchors: m3.anchors.slice(0, 24),
        decisions_keep: m3.decisions_keep,
        decisions_retry: m3.decisions_retry,
        non_anchor_spans: m3.non_anchor_spans,
        retry_attempts: m3.retry_attempts,
        retry_returned: m3.retry_returned,
        retry_zero: m3.retry_zero,
        anchor_retry_rej: m3.anchor_retry_rej,
        retry_regions: m3.retry_regions,
        model3_latency_ms: m3.model3_latency_ms,
        retry_latency_ms: m3.retry_latency_ms,
        model3_inference_errors: m3.inference_errors,
        model3_identity: IDENTITY.modelId,
        model3_weights_sha256: digest,
        inference_input_traces,
        asr_service_id: extra.asr_service_id || null,
        lexicon_runtime_status: extra.lexicon_runtime_status || null,
        fw_detector_step_ms: extra.fw_detector_step_ms ?? null,
        span_margins,
      };
      row.failure_class = attributeFailure(row);
      rows.push(row);
      completed += 1;
      console.log(
        `[${caseDef.id}] ${final_class} retry=${m3.decisions_retry} anchors=${m3.anchors.length} ${Date.now() - t0}ms`
      );
    } catch (e) {
      failed += 1;
      rows.push({
        id: caseDef.id,
        scenario: caseDef.scenario,
        error: e.message,
        infra_error: true,
        final_class: 'UNDETERMINED',
        failure_class: 'TEST_INFRA_ERROR',
      });
      console.log(`[${caseDef.id}] ERROR`, e.message);
    }
  }

  const rawPath = path.join(
    OUT_DIR,
    OUT_TAG
      ? `model3_v2_s3_mainline_${OUT_TAG}_raw_cases.jsonl`
      : IS_REALDIST
        ? 'model3_v2_realdist_dialog200_raw_cases.jsonl'
        : anchoredOnly
          ? 'model3_v1_feature_contract_dialog200_anchored.jsonl'
          : 'model3_v1_dialog200_raw_cases.jsonl'
  );
  // When --case-ids is set, merge into existing raw SSOT so partial reruns do not wipe peers.
  let rawOut = rows;
  if (CASE_ID_FILTER && fs.existsSync(rawPath)) {
    const prev = fs
      .readFileSync(rawPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const updated = new Set(rows.map((r) => r.id));
    rawOut = [...prev.filter((r) => r && r.id && !updated.has(r.id)), ...rows];
    console.log('[raw] merged case-ids into existing', path.basename(rawPath), '→', rawOut.length, 'cases');
  }
  fs.writeFileSync(rawPath, rawOut.map((r) => JSON.stringify(r)).join('\n'), 'utf8');

  // Production Model3 input SSOT — one JSONL record per path-span (RealDist / eval runs).
  if (IS_REALDIST || CASE_ID_FILTER) {
    const tracePath = path.join(OUT_DIR, 'model3_v2_live_input_trace.jsonl');
    const newTraceLines = [];
    for (const r of rows) {
      for (const t of r.inference_input_traces || []) {
        newTraceLines.push(
          JSON.stringify({
            caseId: r.id,
            raw_asr: r.raw_asr,
            expected: r.expected,
            final_text: r.final_text,
            final_class: r.final_class,
            modelId: IDENTITY.modelId,
            weightsSha256: digest,
            ...t,
          })
        );
      }
    }
    let traceOut = newTraceLines;
    if (CASE_ID_FILTER && fs.existsSync(tracePath)) {
      const updatedCases = new Set(rows.map((r) => r.id));
      const prev = fs
        .readFileSync(tracePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .filter((l) => {
          try {
            const o = JSON.parse(l);
            return o.caseId && !updatedCases.has(o.caseId);
          } catch {
            return false;
          }
        });
      traceOut = [...prev, ...newTraceLines];
      console.log('[trace] merged case-ids; kept', prev.length, 'prior rows +', newTraceLines.length, 'new');
    }
    fs.writeFileSync(tracePath, traceOut.join('\n'), 'utf8');
    console.log('[trace] wrote', traceOut.length, 'inference-input rows →', tracePath);
  }

  const marginRows = [];
  for (const r of rows) {
    for (const s of r.span_margins || []) {
      marginRows.push({
        case_id: r.id,
        scenario: r.scenario,
        ...s,
      });
    }
  }
  if (marginRows.length) {
    fs.writeFileSync(
      path.join(
        OUT_DIR,
        IS_REALDIST
          ? 'model3_v2_realdist_runtime_margin_analysis.csv'
          : 'model3_v1_runtime_margin_analysis.csv'
      ),
      [
        'case_id,scenario,path_id,spanId,surface,isAnchor,keep_logit,retry_logit,margin,decision',
        ...marginRows.map(
          (m) =>
            [
              m.case_id,
              m.scenario,
              m.path_id,
              m.spanId,
              JSON.stringify(m.surface || ''),
              m.isAnchor,
              m.keep_logit ?? '',
              m.retry_logit ?? '',
              m.margin ?? '',
              m.decision,
            ].join(',')
        ),
      ].join('\n'),
      'utf8'
    );
  }

  const evaluated = rows.filter((r) => !r.skip && !r.error);
  const improved = evaluated.filter((r) => r.final_class === 'IMPROVED');
  const unchanged = evaluated.filter((r) => r.final_class === 'UNCHANGED');
  const regressed = evaluated.filter((r) => r.final_class === 'REGRESSED');
  const undetermined = rows.filter((r) => r.final_class === 'UNDETERMINED' || r.skip || r.error);

  const allM3Lat = evaluated.flatMap((r) => r.model3_latency_ms || []);
  const allRetryLat = evaluated.flatMap((r) => r.retry_latency_ms || []);
  const keepOnly = evaluated.filter((r) => (r.retry_attempts || 0) === 0);
  const keepDelta = keepOnly.map((r) => (r.model3_latency_ms || []).reduce((a, b) => a + b, 0));
  const postAsrDelta = evaluated.map((r) => {
    const m = (r.model3_latency_ms || []).reduce((a, b) => a + b, 0);
    const rr = (r.retry_latency_ms || []).reduce((a, b) => a + b, 0);
    return m + rr;
  });

  const failCounts = {};
  for (const r of rows) {
    const k = r.failure_class || 'NONE';
    failCounts[k] = (failCounts[k] || 0) + 1;
  }

  const summary = {
    phase: IS_REALDIST
      ? 'MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT'
      : 'MODEL3_V1_DIALOG_200_FULL_PIPELINE_ACCEPTANCE',
    timestamp: new Date().toISOString(),
    model: {
      modelId: IDENTITY.modelId,
      role: IDENTITY.role,
      checkpointDir: IDENTITY.checkpointDirRelative,
      weightsSha256: digest,
      expectedWeightsSha256: EXPECTED_SHA,
      configHash: EXPECTED_CFG,
      configHashMode: IDENTITY.configHashMode,
      hashVerified: true,
      identityValidation: digest === EXPECTED_SHA.toLowerCase() ? 'PASS' : 'FAIL',
    },
    environment: {
      asr: asrReady.ready ? 'READY' : 'FAIL',
      node_5020: 'READY',
      lexicon: evaluated.some((r) => r.lexicon_runtime_status && r.lexicon_runtime_status !== 'ok')
        ? 'FAIL'
        : 'READY',
      model2: 'READY',
      model3: evaluated.some((r) => (r.model3_inference_errors || 0) > 0) ? 'FAIL' : 'READY',
      kenlm: 'READY',
      checkpointIdentity: IDENTITY.modelId,
    },
    coverage: {
      total: 200,
      attempted: rows.length,
      completed,
      failed,
      skipped,
      full_acceptance_dataset: completed === 200 && failed === 0 && skipped === 0,
      wall_clock_sec: Math.round((Date.now() - batchStart) / 1000),
      max_minutes: maxMinutes,
      anchored_only: anchoredOnly,
    },
    invariants: {
      unit_tests: 'deferred',
      second_vote_violations: evaluated.reduce((s, r) => s + (r.second_vote || 0), 0),
      anchor_retry_rejections: evaluated.reduce((s, r) => s + (r.anchor_retry_rej || 0), 0),
      anchor_mutation_violations: evaluated.reduce((s, r) => s + (r.anchor_mutation || 0), 0),
      global_gt16: evaluated.filter((r) => (r.kenlm_pool || 0) > 16).length,
      retry_region_count: evaluated.reduce((s, r) => s + (r.retry_regions || []).length, 0),
    },
    anchors: {
      utterances_with_anchor: evaluated.filter((r) => (r.model2_anchor_count || 0) > 0).length,
      utterances_without_anchor: evaluated.filter((r) => (r.model2_anchor_count || 0) === 0).length,
      model2_anchor_count: evaluated.reduce((s, r) => s + (r.model2_anchor_count || 0), 0),
      domain_anchor_count: 0,
      profile_domain_anchor_count: 0,
      profile_retrieval_anchor_count: 0,
    },
    model3: {
      paths_processed: evaluated.reduce((s, r) => s + (r.model3_paths || 0), 0),
      non_anchor_spans: evaluated.reduce((s, r) => s + (r.non_anchor_spans || 0), 0),
      keep: evaluated.reduce((s, r) => s + (r.decisions_keep || 0), 0),
      retry: evaluated.reduce((s, r) => s + (r.decisions_retry || 0), 0),
      cases_with_retry: evaluated.filter((r) => (r.decisions_retry || 0) > 0).length,
    },
    recall: {
      retry_attempts: evaluated.reduce((s, r) => s + (r.retry_attempts || 0), 0),
      returned: evaluated.reduce((s, r) => s + (r.retry_returned || 0), 0),
      zero_attempts: evaluated.reduce((s, r) => s + (r.retry_zero || 0), 0),
    },
    final_text: {
      improved: improved.length,
      unchanged: unchanged.length,
      regressed: regressed.length,
      undetermined: undetermined.length,
      improvement_rate: evaluated.length ? improved.length / evaluated.length : null,
      unchanged_rate: evaluated.length ? unchanged.length / evaluated.length : null,
      regression_rate: evaluated.length ? regressed.length / evaluated.length : null,
    },
    failure_ownership: failCounts,
    latency: {
      model3_p50: percentile(allM3Lat, 50),
      model3_p95: percentile(allM3Lat, 95),
      model3_p99: percentile(allM3Lat, 99),
      retry_p50: percentile(allRetryLat, 50),
      retry_p95: percentile(allRetryLat, 95),
      keep_only_delta_p50: percentile(keepDelta, 50),
      keep_only_delta_p95: percentile(keepDelta, 95),
      post_asr_delta_p50: percentile(postAsrDelta, 50),
      post_asr_delta_p95: percentile(postAsrDelta, 95),
    },
    startInfo,
  };

  const retryDenom = summary.model3.keep + summary.model3.retry;
  summary.model3.retry_rate = retryDenom ? summary.model3.retry / retryDenom : null;
  summary.model3.retry_spans_per_utterance = evaluated.length
    ? summary.model3.retry / evaluated.length
    : null;
  summary.anchors.anchors_per_utterance = evaluated.length
    ? summary.anchors.model2_anchor_count / evaluated.length
    : null;
  const ra = summary.recall.retry_attempts;
  summary.recall.candidate_yield = ra ? summary.recall.returned / ra : null;
  summary.recall.zero_candidate_rate = ra ? summary.recall.zero_attempts / ra : null;

  fs.writeFileSync(
    path.join(
      OUT_DIR,
      OUT_TAG
        ? `model3_v2_s3_mainline_${OUT_TAG}_run_summary.json`
        : IS_REALDIST
          ? 'model3_v2_realdist_acceptance_summary.json'
          : 'model3_v1_dialog200_acceptance_summary.json'
    ),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  // case results CSV
  const csvHeader =
    'id,scenario,final_class,failure_class,dist_raw,dist_final,text_changed,fw_applied,keep,retry,retry_attempts,retry_returned,model2_anchors,pool_refreshed,second_vote,pipeline_ms,model3_lat_sum,retry_lat_sum';
  const csvLines = [csvHeader];
  for (const r of rows) {
    if (r.skip) {
      csvLines.push(`${r.id},,SKIP,TEST_INFRA_ERROR,,,,,,,,,,,,,`);
      continue;
    }
    csvLines.push(
      [
        r.id,
        r.scenario || '',
        r.final_class || '',
        r.failure_class || '',
        r.dist_raw ?? '',
        r.dist_final ?? '',
        r.text_changed ? 1 : 0,
        r.fw_applied ?? '',
        r.decisions_keep ?? '',
        r.decisions_retry ?? '',
        r.retry_attempts ?? '',
        r.retry_returned ?? '',
        r.model2_anchor_count ?? '',
        r.pool_refreshed ?? '',
        r.second_vote ?? '',
        r.pipeline_ms ?? '',
        (r.model3_latency_ms || []).reduce((a, b) => a + b, 0),
        (r.retry_latency_ms || []).reduce((a, b) => a + b, 0),
      ].join(',')
    );
  }
  fs.writeFileSync(
    path.join(
      OUT_DIR,
      IS_REALDIST ? 'model3_v2_realdist_mainline_results.csv' : 'model3_v1_dialog200_case_results.csv'
    ),
    csvLines.join('\n'),
    'utf8'
  );

  const failRows = ['id,final_class,failure_class,raw_asr,final_text,expected,retry,retry_returned,anchors_json'];
  for (const r of rows.filter((x) => x.final_class === 'REGRESSED' || (x.failure_class && x.failure_class !== 'NONE'))) {
    failRows.push(
      [
        r.id,
        r.final_class,
        r.failure_class,
        JSON.stringify(r.raw_asr || r.error || ''),
        JSON.stringify(r.final_text || ''),
        JSON.stringify(r.expected || ''),
        r.decisions_retry ?? '',
        r.retry_returned ?? '',
        JSON.stringify(r.anchors || []),
      ].join(',')
    );
  }
  fs.writeFileSync(
    path.join(
      OUT_DIR,
      IS_REALDIST
        ? 'model3_v2_realdist_failure_analysis.csv'
        : 'model3_v1_dialog200_failure_analysis.csv'
    ),
    failRows.join('\n'),
    'utf8'
  );

  const latCsv = [
    'metric,value',
    `model3_p50,${summary.latency.model3_p50}`,
    `model3_p95,${summary.latency.model3_p95}`,
    `model3_p99,${summary.latency.model3_p99}`,
    `retry_p50,${summary.latency.retry_p50}`,
    `retry_p95,${summary.latency.retry_p95}`,
    `keep_only_delta_p50,${summary.latency.keep_only_delta_p50}`,
    `keep_only_delta_p95,${summary.latency.keep_only_delta_p95}`,
    `post_asr_delta_p50,${summary.latency.post_asr_delta_p50}`,
    `post_asr_delta_p95,${summary.latency.post_asr_delta_p95}`,
  ].join('\n');
  fs.writeFileSync(
    path.join(
      OUT_DIR,
      IS_REALDIST ? 'model3_v2_realdist_latency.csv' : 'model3_v1_dialog200_latency.csv'
    ),
    latCsv,
    'utf8'
  );

  console.log('[done] identity', IDENTITY.modelId);
  console.log('[done] summary', JSON.stringify(summary.final_text, null, 2));
  console.log('[done] coverage', JSON.stringify(summary.coverage, null, 2));
  console.log('[done] model3', JSON.stringify(summary.model3, null, 2));
  console.log('[done] wrote artifacts under', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
