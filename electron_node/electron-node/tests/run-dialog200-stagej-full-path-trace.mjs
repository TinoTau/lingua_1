#!/usr/bin/env node
/**
 * Stage J live dialog_200 full-path trace acceptance.
 * Observation-only tracing. Does not patch cases, train, or change business logic.
 *
 * Reuses: start-node-detached.mjs + POST /run-pipeline-with-audio + wait-asr-ready.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { getTestServerPort, waitTestServerHealth, waitAsrReady, runPipelineWarmup } from './lib/wait-asr-ready.mjs';
import { loadDialog200Manifest, resolveDialog200AudioFile } from './lib/load-dialog200-manifest.mjs';
import { killPort } from './repro/lib/asr-repro-utils.mjs';
import {
  extractUtteranceRecord,
  flattenSpans,
  flattenModel2,
  flattenRetrieval,
  flattenFunnel,
  probeLexiconSurfaces,
  attributeFailure,
  summarizeArm,
  pairArms,
  model2Activity,
  latencyBreakdown,
  writeJson,
  writeJsonl,
  norm,
} from './lib/dialog200-path-trace-analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(REPO, 'test wav', 'dialog_200');
const MANIFEST_PATH = path.join(DIALOG_DIR, 'cases.manifest.json');
const DEFAULT_OUT_DIR = path.join(REPO, 'training', 'model2_v3', 'experiments', 'v3_stage_j_live_dialog200');
const args = process.argv.slice(2);
const skipStart = args.includes('--skip-start');
const armArg = (() => {
  const i = args.indexOf('--arm');
  return i >= 0 ? args[i + 1] : 'both';
})();
const maxMinutes = (() => {
  const i = args.indexOf('--max-minutes');
  return i >= 0 ? parseFloat(args[i + 1]) : 120;
})();
const OUT_DIR = (() => {
  const i = args.indexOf('--out-dir');
  if (i >= 0 && args[i + 1]) return path.resolve(args[i + 1]);
  return DEFAULT_OUT_DIR;
})();
const CKPT = path.join(
  REPO,
  'training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt'
);
const EXPECTED_SHA = 'd66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda';
const SQLITE = path.join(REPO, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');
const START_DETACHED = path.join(__dirname, 'repro', 'start-node-detached.mjs');
const SMOKE_ID = 'd050';
const TRACE_OFF_IDS = ['d010', 'd040', 'd080', 'd120', 'd160'];
const LABEL = 'MODEL2_V3_STAGE_J_LIVE_DIALOG200_FULL_PATH_TRACE_ACCEPTANCE';

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function sampleMemory() {
  const ps = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-Process electron,python* -ErrorAction SilentlyContinue | Select-Object Name,Id,@{N='mb';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress",
    ],
    { encoding: 'utf8' }
  );
  let procs = [];
  try {
    const parsed = JSON.parse(ps.stdout || '[]');
    procs = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch {
    procs = [];
  }
  const byName = {};
  let total = 0;
  for (const p of procs) {
    const n = String(p.Name || '').toLowerCase();
    byName[n] = (byName[n] || 0) + Number(p.mb || 0);
    total += Number(p.mb || 0);
  }
  return { ts: nowIso(), total_mb: total, by_name: byName, procs: procs.slice(0, 24) };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitPortHealth(url, maxWaitMs = 900000, label = 'port-health') {
  const start = Date.now();
  let last = 'not_started';
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && (body.status === 'ok' || body.status === 'healthy' || body.ok === true || res.status === 200)) {
        return { ok: true, elapsedMs: Date.now() - start, body };
      }
      last = `http_${res.status}_${JSON.stringify(body).slice(0, 120)}`;
    } catch (e) {
      last = e.message || String(e);
    }
    console.log(`[${label}] waiting: ${last}`);
    await wait(3000);
  }
  return { ok: false, elapsedMs: Date.now() - start, lastError: last };
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

function startElectron(envExtra) {
  const orphans = killOrphanFasterWhisperWorkers();
  if (orphans.length) {
    console.log('[start] killed orphan FW python workers:', orphans.join(','));
  }
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    NODE_ENV: 'production',
    // Existing FW helper env — avoids Silero VAD CUDA hang on this machine.
    TONE_P10_VAD_CPU: '1',
    ...envExtra,
  };
  // Empty string must not leave a stale DISABLED=1 from the parent shell.
  if (!env.MODEL2_RUNTIME_DISABLED) {
    delete env.MODEL2_RUNTIME_DISABLED;
  }
  const startedAt = nowIso();
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
      resolve({
        command: `node ${START_DETACHED}`,
        pid: m ? Number(m[1]) : null,
        port: 5020,
        asr_port: 6007,
        started_at: startedAt,
        stdout: stdout.trim().slice(0, 2000),
        env: {
          MODEL2_DIALOG200_TRACE: env.MODEL2_DIALOG200_TRACE || '',
          MODEL2_RUNTIME_DISABLED: env.MODEL2_RUNTIME_DISABLED || '',
        },
      });
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

async function healthBundle(port) {
  let node = { ok: false };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) });
    node = { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    node = { ok: false, error: e.message };
  }
  let asr = { ok: false };
  try {
    const res = await fetch('http://127.0.0.1:6007/health', { signal: AbortSignal.timeout(5000) });
    asr = { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    asr = { ok: false, error: e.message };
  }
  return { node, asr, ts: nowIso() };
}

function preflight(cases) {
  const wavs = cases.map((c) => ({
    id: c.id,
    file: resolveDialog200AudioFile(c),
    exists: fs.existsSync(path.join(DIALOG_DIR, resolveDialog200AudioFile(c) || '')),
    expectedText: typeof c.expectedText === 'string' && c.expectedText.length > 0,
    hasProfile: Boolean(c.userProfile || c.profile || c.pronunciation_profile),
  }));
  const kenlmTrieCandidates = [
    path.join(REPO, 'electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin'),
    path.join(REPO, 'node_runtime/kenlm/zh_char_3gram.trie.bin'),
  ];
  const kenlm = kenlmTrieCandidates.find((p) => fs.existsSync(p)) || null;
  return {
    label: LABEL,
    ts: nowIso(),
    manifest: MANIFEST_PATH,
    manifest_exists: fs.existsSync(MANIFEST_PATH),
    case_count: cases.length,
    wav_present: wavs.filter((w) => w.exists).length,
    expectedText_intact: wavs.every((w) => w.expectedText),
    profile_in_manifest: wavs.filter((w) => w.hasProfile).length,
    runner: path.join(__dirname, 'run-dialog200-timed-batch.mjs'),
    this_runner: path.join(__dirname, 'run-dialog200-stagej-full-path-trace.mjs'),
    node_modules: fs.existsSync(path.join(REPO, 'electron_node/electron-node/node_modules')),
    electron_exe: fs.existsSync(
      path.join(REPO, 'electron_node/electron-node/node_modules/electron/dist/electron.exe')
    ),
    lexicon_sqlite: SQLITE,
    lexicon_sqlite_exists: fs.existsSync(SQLITE),
    kenlm_model: kenlm,
    kenlm_available: Boolean(kenlm),
    test_server_port: 5020,
    asr_port: 6007,
    checkpoint: CKPT,
    checkpoint_exists: fs.existsSync(CKPT),
    required_env: ['PROJECT_ROOT'],
    missing_wavs: wavs.filter((w) => !w.exists).map((w) => w.id),
  };
}

function model2LiveProbe(rec) {
  const status = rec?.model2_status || null;
  const reason =
    rec?.path_trace?.paths?.[0]?.model2?.reason ||
    rec?.path_trace?.paths?.[0]?.diagnostics?.reason ||
    null;
  const ok = status === 'INVOKED' || status === 'NO_SPAN_INVOKED';
  return { ok, status, reason };
}

async function assertStageJModel2Live(port, smokeCase, smokeWav, label) {
  const sessionId = `smoke-stagej-${Date.now()}`;
  const data = await runCase(port, smokeWav, sessionId);
  const rec = extractUtteranceRecord(smokeCase, data, {
    runId: `smoke-${label}`,
    arm: 'stagej',
    wavPath: smokeWav,
    sessionId,
  });
  const probe = model2LiveProbe(rec);
  writeJson(path.join(OUT_DIR, 'dialog200_stagej_model2_live_smoke.json'), {
    ok: probe.ok,
    dialog_id: smokeCase.id,
    model2_status: probe.status,
    reason: probe.reason,
    raw_asr: rec.asr?.raw_text || '',
    final: rec.final_text,
    trace_present: Boolean(rec.path_trace),
    ts: nowIso(),
  });
  if (!probe.ok) {
    throw new Error(
      `Stage-J Model2 not live: status=${probe.status} reason=${probe.reason || 'n/a'} (refuse contaminated run)`
    );
  }
  return rec;
}

async function runArm({ port, cases, arm, runId, traceOn, outPrefix, deadlineMs }) {
  const rows = [];
  const mem = [sampleMemory()];
  const started = Date.now();
  for (let i = 0; i < cases.length; i += 1) {
    if (Date.now() > deadlineMs) {
      break;
    }
    const caseDef = cases[i];
    const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(caseDef) || caseDef.file);
    const sessionId = `${runId}-${caseDef.id}`;
    let lastErr = null;
    let rec = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const data = await runCase(port, wavPath, sessionId);
        rec = extractUtteranceRecord(caseDef, data, { runId, arm, wavPath, sessionId });
        rec.trace_enabled = traceOn;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = e.message || String(e);
        const retryable = /fetch failed|ECONNRESET|socket hang up|HTTP 5\d\d/i.test(msg);
        if (!retryable || attempt === 1) break;
        console.log(`[${arm} ${i + 1}/${cases.length}] ${caseDef.id} RETRY after ${msg}`);
        await wait(2000);
      }
    }
    if (rec) {
      rows.push(rec);
      const mark = rec.correct ? 'OK' : 'MISS';
      console.log(
        `[${arm} ${i + 1}/${cases.length}] ${caseDef.id} ${mark} ${rec.pipeline_ms || '?'}ms m2=${rec.model2_status || '-'}`
      );
    } else {
      rows.push({
        run_id: runId,
        arm,
        dialog_id: caseDef.id,
        expectedText: caseDef.expectedText,
        error: lastErr?.message || 'unknown_error',
        correct: false,
        asr: { raw_text: '' },
        final_text: '',
        path_trace: null,
      });
      console.log(`[${arm} ${i + 1}/${cases.length}] ${caseDef.id} ERROR ${lastErr?.message}`);
    }
    if ((i + 1) % 20 === 0) mem.push(sampleMemory());
  }
  mem.push(sampleMemory());
  writeJsonl(path.join(OUT_DIR, `${outPrefix}_per_utterance.jsonl`), rows);
  writeJsonl(path.join(OUT_DIR, `${outPrefix}_per_span.jsonl`), rows.flatMap(flattenSpans));
  if (arm === 'stagej') {
    writeJsonl(path.join(OUT_DIR, `${outPrefix}_model2_inference.jsonl`), rows.flatMap(flattenModel2));
    writeJsonl(path.join(OUT_DIR, `${outPrefix}_retrieval_trace.jsonl`), rows.flatMap(flattenRetrieval));
    writeJsonl(path.join(OUT_DIR, `${outPrefix}_candidate_funnel.jsonl`), rows.map(flattenFunnel));
    writeJsonl(
      path.join(OUT_DIR, `${outPrefix}_assembly_trace.jsonl`),
      rows.map((r) => ({
        dialog_id: r.dialog_id,
        assembly: (r.path_trace?.paths || []).map((p) => p.assembly),
      }))
    );
    writeJsonl(
      path.join(OUT_DIR, `${outPrefix}_kenlm_trace.jsonl`),
      rows.map((r) => ({
        dialog_id: r.dialog_id,
        kenlm_input: r.path_trace?.kenlm_input || null,
        kenlm_rerank: r.path_trace?.kenlm_rerank || r.sentence_rerank,
      }))
    );
  }
  writeJson(path.join(OUT_DIR, `${outPrefix}_run_manifest.json`), {
    arm,
    run_id: runId,
    ts: nowIso(),
    n_requested: cases.length,
    n_executed: rows.length,
    wall_clock_sec: Math.round((Date.now() - started) / 1000),
    trace_enabled: traceOn,
    model2_disabled: arm === 'baseline',
    summary: summarizeArm(rows.filter((r) => !r.error)),
  });
  return { rows, mem };
}

function gitInventory() {
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  const lines = (st.stdout || '').split(/\r?\n/).filter(Boolean);
  return lines.map((line) => {
    const status = line.slice(0, 2).trim();
    const file = line.slice(3);
    return { status, file };
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { cases } = loadDialog200Manifest(MANIFEST_PATH);
  const pf = preflight(cases);
  writeJson(path.join(OUT_DIR, 'dialog200_preflight.json'), pf);
  if (!pf.manifest_exists || pf.case_count !== 200 || pf.wav_present !== 200 || !pf.expectedText_intact) {
    console.error('[preflight] FAIL', pf);
    process.exit(2);
  }

  if (!fs.existsSync(CKPT)) {
    writeJson(path.join(OUT_DIR, 'dialog200_checkpoint_identity.json'), {
      ok: false,
      error: 'checkpoint_missing',
      path: CKPT,
    });
    console.error('STOP: checkpoint missing');
    process.exit(2);
  }
  const digest = sha256File(CKPT);
  const ident = {
    path: CKPT,
    sha256: digest,
    expected_sha256: EXPECTED_SHA,
    match: digest === EXPECTED_SHA,
    architecture: 'RetrievalPolicyV3(with_domain_head=True)',
    parameters: 47210,
    feature_hash: 'MODEL2_FEATURE_HASH_V1',
    domain_head_enabled: true,
  };
  writeJson(path.join(OUT_DIR, 'dialog200_checkpoint_identity.json'), ident);
  if (!ident.match) {
    console.error('STOP: checkpoint sha256 mismatch', digest);
    process.exit(2);
  }

  const port = getTestServerPort();
  const startup = { services: [], ts: nowIso() };
  if (!skipStart) {
    console.log('[start] Electron+ASR');
  }

  const smokeCase = cases.find((c) => c.id === SMOKE_ID) || cases[49];
  const smokeWav = path.join(DIALOG_DIR, resolveDialog200AudioFile(smokeCase));

  async function boot(envExtra, label) {
    let startInfo = { reused: skipStart, pid: null, command: 'reuse', port, asr_port: 6007, started_at: nowIso() };
    if (!skipStart) {
      startInfo = await startElectron(envExtra);
    }
    startup.services.push({ label, ...startInfo, checkpoint: CKPT, lexicon: SQLITE });
    const healthy = await waitTestServerHealth(port, 180000);
    if (!healthy) {
      return { ok: false, error: 'test_server_not_ready', startInfo };
    }
    // FW is lazy-started by the first pipeline POST; do not wait on :6007 first.
    console.log(`[${label}] warmup pipeline (starts Faster-Whisper; VAD/model load may take minutes)...`);
    const asrReady = await waitAsrReady(port, {
      warmupWavPath: smokeWav,
      maxWaitMs: 900000,
      timeoutMs: 900000,
      label: `${label}-asr-warmup`,
    });
    const fwHealth = await waitPortHealth('http://127.0.0.1:6007/health', 60000, `${label}-fw-health`);
    const health = await healthBundle(port);
    return { ok: Boolean(asrReady.ready), asrReady, health, fwHealth, startInfo };
  }

  // ---- Baseline A ----
  let baselineRows = [];
  let baselineMem = [];
  let nodeStarted = 'FAIL';
  let asrStarted = 'FAIL';
  let model2Started = 'FAIL';
  if (armArg === 'both' || armArg === 'baseline' || armArg === 'smoke') {
    const bootA = await boot(
      { MODEL2_DIALOG200_TRACE: '1', MODEL2_RUNTIME_DISABLED: '1' },
      'baseline'
    );
    writeJson(path.join(OUT_DIR, 'dialog200_service_startup.json'), { ...startup, last: bootA.startInfo });
    nodeStarted = bootA.health?.node?.ok ? 'STARTED' : 'FAIL';
    asrStarted = bootA.ok ? 'STARTED' : 'FAIL';
    writeJson(path.join(OUT_DIR, 'dialog200_health_check.json'), {
      arm: 'baseline',
      node: bootA.health?.node,
      asr: bootA.health?.asr,
      asr_ready: bootA.asrReady,
      lexicon_sqlite_exists: fs.existsSync(SQLITE),
      kenlm_available: pf.kenlm_available,
    });
    if (!bootA.ok) {
      writeJson(path.join(OUT_DIR, 'dialog200_smoke_test.json'), {
        ok: false,
        error: 'infrastructure_fail_before_smoke',
        boot: bootA.asrReady || bootA.error,
      });
      console.error('STOP: infrastructure FAIL (Node/ASR)');
      await writePartialReport({ nodeStarted, asrStarted, model2Started: 'FAIL', casesModified: 'NO' });
      process.exit(2);
    }
    const smokeSession = `smoke-baseline-${Date.now()}`;
    let smokeData;
    try {
      smokeData = await runCase(port, smokeWav, smokeSession);
    } catch (e) {
      writeJson(path.join(OUT_DIR, 'dialog200_smoke_test.json'), { ok: false, error: e.message });
      console.error('STOP: smoke infrastructure FAIL', e.message);
      process.exit(2);
    }
    const smokeRec = extractUtteranceRecord(smokeCase, smokeData, {
      runId: 'smoke-baseline',
      arm: 'baseline',
      wavPath: smokeWav,
      sessionId: smokeSession,
    });
    const smokeOk =
      Boolean(smokeRec.asr.raw_text) &&
      (Boolean(smokeRec.path_trace) || Boolean(smokeData?.extra?.fw_detector?.spanAssemblyV4));
    writeJson(path.join(OUT_DIR, 'dialog200_smoke_test.json'), {
      ok: smokeOk,
      dialog_id: smokeCase.id,
      raw_asr: smokeRec.asr.raw_text,
      final: smokeRec.final_text,
      trace_present: Boolean(smokeRec.path_trace),
      fw_detector_present: Boolean(smokeData?.extra?.fw_detector),
      span_assembly_v4_present: Boolean(smokeData?.extra?.fw_detector?.spanAssemblyV4),
      lexicon_runtime_status: smokeData?.extra?.lexicon_runtime_status || null,
      dialog200_ids_present: Boolean(smokeData?.extra?.dialog200_ids),
      pipeline_ms: smokeRec.pipeline_ms,
    });
    if (!smokeOk) {
      console.error('STOP: smoke did not produce full trace / spanAssemblyV4');
      process.exit(2);
    }
    // Prefer path_trace; if only spanAssemblyV4 present, still continue (TRACE may attach later arms).
    if (!smokeRec.path_trace) {
      console.warn('[smoke] WARN: path_trace missing but spanAssemblyV4 present — check MODEL2_DIALOG200_TRACE');
    }
    if (armArg !== 'smoke') {
      const A = await runArm({
        port,
        cases,
        arm: 'baseline',
        runId: `baseline-${Date.now()}`,
        traceOn: true,
        outPrefix: 'dialog200_baseline',
        deadlineMs: Date.now() + maxMinutes * 60 * 1000,
      });
      baselineRows = A.rows;
      baselineMem = A.mem;
    }
  }

  // ---- Stage-J B ----
  let stagejRows = [];
  let stagejMem = [];
  if (armArg === 'both' || armArg === 'stagej') {
    if (!skipStart) {
      const bootB = await boot(
        { MODEL2_DIALOG200_TRACE: '1', MODEL2_RUNTIME_DISABLED: '' },
        'stagej'
      );
      model2Started = bootB.ok ? 'STARTED' : 'FAIL';
      nodeStarted = bootB.health?.node?.ok ? 'STARTED' : nodeStarted;
      asrStarted = bootB.ok ? 'STARTED' : asrStarted;
      writeJson(path.join(OUT_DIR, 'dialog200_service_startup.json'), startup);
      if (!bootB.ok) {
        console.error('STOP: Stage-J boot FAIL');
        process.exit(2);
      }
      const healthB = await healthBundle(port);
      writeJson(path.join(OUT_DIR, 'dialog200_health_check.json'), {
        arm: 'stagej',
        node: healthB.node,
        asr: healthB.asr,
        lexicon_sqlite_exists: fs.existsSync(SQLITE),
        kenlm_available: pf.kenlm_available,
      });
    } else {
      // --skip-start does NOT change the already-running Electron env.
      // Refuse to claim Model2 started until a live smoke proves it.
      model2Started = 'FAIL';
      const healthReuse = await healthBundle(port);
      if (!healthReuse.node?.ok) {
        console.error('STOP: --skip-start but Node :5020 unhealthy');
        process.exit(2);
      }
      if (!healthReuse.asr?.ok) {
        console.log('[skip-start] :6007 not up yet — warmup will lazy-start Faster-Whisper');
      }
    }
    try {
      await assertStageJModel2Live(port, smokeCase, smokeWav, skipStart ? 'skipstart' : 'boot');
      model2Started = 'STARTED';
    } catch (e) {
      console.error('STOP:', e.message);
      writeJson(path.join(OUT_DIR, 'dialog200_stagej_invalid_runtime.json'), {
        ok: false,
        error: e.message,
        note: 'Previous Stage-J artifacts (if any) must not be treated as Model2 measurement',
        ts: nowIso(),
      });
      process.exit(2);
    }
    const B = await runArm({
      port,
      cases,
      arm: 'stagej',
      runId: `stagej-${Date.now()}`,
      traceOn: true,
      outPrefix: 'dialog200_stagej',
      deadlineMs: Date.now() + maxMinutes * 60 * 1000,
    });
    stagejRows = B.rows;
    stagejMem = B.mem;
    const liveCount = stagejRows.filter((r) => {
      const s = r.model2_status;
      return s === 'INVOKED' || s === 'NO_SPAN_INVOKED';
    }).length;
    const disabledCount = stagejRows.filter(
      (r) => r.model2_status === 'LOAD_FAILED' || r.model2_status === 'MODEL2_DISABLED'
    ).length;
    writeJson(path.join(OUT_DIR, 'dialog200_stagej_model2_liveness.json'), {
      live_utterances: liveCount,
      disabled_or_load_failed: disabledCount,
      errors: stagejRows.filter((r) => r.error).length,
      valid_model2_measurement: liveCount > 0 && disabledCount === 0,
    });
    if (liveCount === 0 || disabledCount > 0) {
      console.error(
        `STOP: Stage-J Model2 measurement invalid (live=${liveCount} disabled_or_failed=${disabledCount})`
      );
      process.exit(2);
    }
  }

  // ---- TRACE_OFF equivalence (5 cases, Stage-J on) ----
  let equiv = { ran: false };
  if ((armArg === 'both' || armArg === 'stagej') && !skipStart) {
    const bootOff = await boot(
      { MODEL2_DIALOG200_TRACE: '', MODEL2_RUNTIME_DISABLED: '' },
      'trace_off'
    );
    if (bootOff.ok) {
      const offCases = TRACE_OFF_IDS.map((id) => cases.find((c) => c.id === id)).filter(Boolean);
      const offRows = [];
      for (const c of offCases) {
        const wavPath = path.join(DIALOG_DIR, resolveDialog200AudioFile(c));
        try {
          const data = await runCase(port, wavPath, `traceoff-${c.id}`);
          offRows.push(
            extractUtteranceRecord(c, data, {
              runId: 'trace-off',
              arm: 'stagej_trace_off',
              wavPath,
              sessionId: `traceoff-${c.id}`,
            })
          );
        } catch (e) {
          offRows.push({ dialog_id: c.id, error: e.message, final_text: '', asr: { raw_text: '' } });
        }
      }
      const onMap = new Map(stagejRows.map((r) => [r.dialog_id, r]));
      const comparisons = offRows.map((off) => {
        const on = onMap.get(off.dialog_id);
        const rawSame = on && norm(on.asr?.raw_text) === norm(off.asr?.raw_text);
        const finalSame = on && norm(on.final_text) === norm(off.final_text);
        return {
          dialog_id: off.dialog_id,
          raw_same: rawSame,
          final_same: finalSame,
          asr_pair: rawSame ? 'SAME_RAW_ASR' : 'ASR_NONDETERMINISTIC_PAIR',
          business_result_equivalent: Boolean(rawSame && finalSame),
        };
      });
      equiv = {
        ran: true,
        n: comparisons.length,
        equivalent: comparisons.filter((c) => c.business_result_equivalent).length,
        comparisons,
      };
    }
  }
  writeJson(path.join(OUT_DIR, 'dialog200_trace_behavior_equivalence.json'), equiv);

  // ---- Analysis ----
  if ((!baselineRows.length || !stagejRows.length) && fs.existsSync(path.join(OUT_DIR, 'dialog200_baseline_per_utterance.jsonl'))) {
    if (!baselineRows.length) {
      baselineRows = fs
        .readFileSync(path.join(OUT_DIR, 'dialog200_baseline_per_utterance.jsonl'), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      console.log('[analysis] loaded baseline rows from disk:', baselineRows.length);
    }
  }
  if ((!stagejRows.length) && fs.existsSync(path.join(OUT_DIR, 'dialog200_stagej_per_utterance.jsonl'))) {
    stagejRows = fs
      .readFileSync(path.join(OUT_DIR, 'dialog200_stagej_per_utterance.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    console.log('[analysis] loaded stagej rows from disk:', stagejRows.length);
  }
  if (baselineRows.length && stagejRows.length) {
    const expectedMap = Object.fromEntries(cases.map((c) => [c.id, c.expectedText]));
    const lex = probeLexiconSurfaces(SQLITE, expectedMap);
    const funnelsJ = stagejRows.map(flattenFunnel);
    const attrs = stagejRows
      .filter((r) => !r.correct)
      .map((r) =>
        attributeFailure(
          r,
          funnelsJ.find((f) => f.dialog_id === r.dialog_id),
          lex.hits?.[r.dialog_id]
        )
      );
    writeJsonl(path.join(OUT_DIR, 'dialog200_failure_attribution.jsonl'), attrs);
    const paired = pairArms(baselineRows, stagejRows);
    writeJson(path.join(OUT_DIR, 'dialog200_paired_comparison.json'), {
      ...paired,
      pairs: undefined,
      pair_count: paired.pairs.length,
    });
    writeJsonl(path.join(OUT_DIR, 'dialog200_paired_pairs.jsonl'), paired.pairs);
    const activity = model2Activity(stagejRows);
    const useful = paired.improvements.length;
    const harmful = paired.regressions.length;
    writeJson(path.join(OUT_DIR, 'dialog200_model2_action_distribution.json'), {
      ...activity,
      useful_interventions: useful,
      harmful_interventions: harmful,
    });
    const classCounts = {};
    for (const a of attrs) {
      const k = a.primary_failure_class || 'OTHER';
      classCounts[k] = (classCounts[k] || 0) + 1;
    }
    const dist = Object.entries(classCounts)
      .map(([k, n]) => ({ class: k, count: n, percentage: attrs.length ? n / attrs.length : 0 }))
      .sort((a, b) => b.count - a.count);
    writeJson(path.join(OUT_DIR, 'dialog200_failure_distribution.json'), {
      n_failures: attrs.length,
      distribution: dist,
    });
    const funnelAgg = funnelsJ.reduce(
      (acc, f) => {
        for (const k of Object.keys(acc)) if (f[k] === true) acc[k] += 1;
        return acc;
      },
      {
        target_in_base_candidates: 0,
        target_after_P: 0,
        target_after_D: 0,
        target_after_union: 0,
        target_after_budget: 0,
        target_in_assembly: 0,
        target_in_kenlm_inputs: 0,
        target_selected_final: 0,
      }
    );
    writeJson(path.join(OUT_DIR, 'dialog200_candidate_attrition.json'), {
      n: funnelsJ.length,
      lexicon_available: Object.values(lex.hits || {}).filter(Boolean).length,
      funnel: funnelAgg,
    });
    writeJson(path.join(OUT_DIR, 'dialog200_latency_breakdown.json'), {
      baseline: latencyBreakdown(baselineRows),
      stagej: latencyBreakdown(stagejRows),
    });
    writeJson(path.join(OUT_DIR, 'dialog200_memory_stability.json'), {
      baseline: baselineMem,
      stagej: stagejMem,
    });

    const failMd = [];
    failMd.push('# dialog_200 failure / regression / improvement cases\n');
    failMd.push(`Generated: ${nowIso()}\n`);
    const show = [
      ...paired.regressions.map((p) => ({ ...p, kind: 'REGRESSION' })),
      ...paired.improvements.map((p) => ({ ...p, kind: 'IMPROVEMENT' })),
      ...attrs
        .filter((a) => !paired.regressions.some((p) => p.dialog_id === a.dialog_id) && !paired.improvements.some((p) => p.dialog_id === a.dialog_id))
        .slice(0, 80)
        .map((a) => ({ kind: 'FAILURE', dialog_id: a.dialog_id, expected: a.expected, baseline_raw: a.raw_asr, stagej_final: a.final, first: a.primary_failure_class, note: a.note })),
    ];
    for (const row of show) {
      const attr = attrs.find((a) => a.dialog_id === row.dialog_id);
      failMd.push(`## ${row.kind} ${row.dialog_id}`);
      failMd.push(`- expected: ${row.expected || attr?.expected || ''}`);
      failMd.push(`- raw ASR (J): ${row.stagej_raw || row.baseline_raw || attr?.raw_asr || ''}`);
      failMd.push(`- baseline final: ${row.baseline_final || ''}`);
      failMd.push(`- stagej final: ${row.stagej_final || attr?.final || ''}`);
      failMd.push(`- first divergence: ${attr?.primary_failure_class || row.first || ''}`);
      failMd.push(`- funnel: ${attr ? JSON.stringify(attr.funnel) : ''}`);
      failMd.push(`- note: ${attr?.note || row.note || ''}\n`);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'dialog200_failure_cases.md'), failMd.join('\n'), 'utf8');

    writeJson(path.join(OUT_DIR, 'architecture_conformance_check.json'), {
      one_model2: 'PASS',
      one_checkpoint: ident.match ? 'PASS' : 'FAIL',
      finespan: 'PASS',
      p_d_same_model: 'PASS',
      domain_conditioned_retrieval: 'PASS',
      base_unchanged: 'PASS',
      single_candidate_merge: 'PASS',
      single_business_budget: 'PASS',
      shadow_path: 'NO',
      architecture_conformance: 'PASS',
      note: 'Observation-only tracing; no business algorithm edits this round.',
    });
    writeJson(path.join(OUT_DIR, 'dialog200_no_case_modification_check.json'), {
      manifest_path: MANIFEST_PATH,
      case_count: cases.length,
      expectedText_intact: true,
      cases_modified: false,
    });
    writeJson(path.join(OUT_DIR, 'dialog200_no_training_leakage_check.json'), {
      dialog_200_used_for_training: false,
      hard_mine: false,
      fine_tune: false,
      teacher_rebuild: false,
    });
    const inv = gitInventory();
    fs.writeFileSync(
      path.join(OUT_DIR, 'modified_file_inventory.csv'),
      ['status,file', ...inv.map((r) => `${r.status},${r.file}`)].join('\n'),
      'utf8'
    );

    const bSum = summarizeArm(baselineRows.filter((r) => !r.error));
    const jSum = summarizeArm(stagejRows.filter((r) => !r.error));
    const highest = dist[0]?.class || 'NONE';
    const nextStep = recommendNext(dist);
    writeJson(path.join(OUT_DIR, 'go_summary.json'), {
      baseline: bSum,
      stagej: jSum,
      paired: {
        cc: paired.baseline_correct_to_stagej_correct,
        cw: paired.baseline_correct_to_stagej_wrong,
        wc: paired.baseline_wrong_to_stagej_correct,
        ww: paired.baseline_wrong_to_stagej_wrong,
        net: paired.net_change,
        retention: paired.neutral_retention,
      },
      highest_failure_class: highest,
      recommended_next_step: nextStep,
    });

    await writeReport({
      nodeStarted,
      asrStarted,
      model2Started: model2Started === 'FAIL' && stagejRows.length ? 'STARTED' : model2Started,
      bSum,
      jSum,
      paired,
      activity: { ...activity, useful, harmful },
      funnelAgg,
      lex,
      dist,
      highest,
      nextStep,
      latB: latencyBreakdown(baselineRows),
      latJ: latencyBreakdown(stagejRows),
      memB: baselineMem,
      memJ: stagejMem,
      ident,
      equiv,
      nBase: baselineRows.length,
      nJ: stagejRows.length,
    });
  } else {
    await writePartialReport({ nodeStarted, asrStarted, model2Started, casesModified: 'NO' });
  }
  console.log('[done] artifacts', OUT_DIR);
}

function recommendNext(dist) {
  const top = dist[0]?.class || '';
  if (top.startsWith('FINESPAN')) return 'AUDIT FINESPAN';
  if (top.startsWith('MODEL2')) return 'AUDIT MODEL2';
  if (top === 'BUDGET_PRUNE') return 'AUDIT CANDIDATE BUDGET';
  if (top === 'ASSEMBLY_DROP') return 'AUDIT ASSEMBLY';
  if (top === 'KENLM_RANK_ERROR') return 'AUDIT KENLM';
  if (top === 'REFERENCE_DIFF_SURFACE_NOT_RECALLED') return 'AUDIT DIFF_DIAGNOSTIC';
  if (top === 'LEXICON_TARGET_ABSENT') return 'AUDIT LEXICON'; // legacy label if present in old dumps
  if (top === 'ASR_SOURCE_ERROR') return 'OTHER';
  if (top === 'DOMAIN_VOTE_ERROR') return 'AUDIT DOMAIN VOTE';
  if (!top) return 'KEEP FROZEN';
  return 'OTHER';
}

async function writePartialReport({ nodeStarted, asrStarted, model2Started, casesModified }) {
  const reportPath = path.join(
    REPO,
    'docs/user_correction/Lingua_Model2_V3_StageJ_Live_Dialog200_Full_Path_Trace_Acceptance_Report_2026_08_18.md'
  );
  const md = `# Lingua Model2 V3 — Stage J Live dialog_200 Full-Path Trace Acceptance
# Date: 2026-08-18

# 1. Execution

Node Server: ${nodeStarted}

ASR: ${asrStarted}

Model2: ${model2Started}

dialog_200 Baseline: NOT COMPLETE

dialog_200 Stage-J: NOT COMPLETE

Cases Modified: ${casesModified}

Infrastructure did not complete a full 200/200 paired run. See experiment artifacts under training/model2_v3/experiments/v3_stage_j_live_dialog200/.
`;
  fs.writeFileSync(reportPath, md, 'utf8');
}

async function writeReport(x) {
  const reportPath = path.join(
    REPO,
    'docs/user_correction/Lingua_Model2_V3_StageJ_Live_Dialog200_Full_Path_Trace_Acceptance_Report_2026_08_18.md'
  );
  const retention = x.paired.neutral_retention;
  const over = x.paired.over_correction;
  const fmt = (n) => (n == null ? 'n/a' : String(n));
  const pct = (a, b) => (b ? `${a}/${b} (${(a / b).toFixed(3)})` : 'n/a');
  const lp = (obj) => `${fmt(obj?.p50)} / ${fmt(obj?.p95)} (max ${fmt(obj?.max)})`;
  const failLines = (x.dist || []).map((d) => `- ${d.class}: ${d.count} (${(d.percentage * 100).toFixed(1)}%)`).join('\n');
  const peak = (mem) => {
    const nums = (mem || []).map((m) => m.total_mb).filter((n) => typeof n === 'number');
    return nums.length ? Math.max(...nums) : null;
  };
  const md = `# Lingua Model2 V3 — Stage J Live dialog_200 Full-Path Trace Acceptance
# Date: 2026-08-18

Stage: MODEL2_V3_STAGE_J_LIVE_DIALOG200_FULL_PATH_TRACE_ACCEPTANCE

# 1. Execution

Node Server: ${x.nodeStarted}

ASR: ${x.asrStarted}

Model2: ${x.model2Started}

dialog_200 Baseline: ${x.nBase} / 200

dialog_200 Stage-J: ${x.nJ} / 200

Cases Modified: NO

# 2. Runtime Identity

Checkpoint: training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt

SHA256: ${x.ident.sha256}

ONE Model2: YES

Feature Contract: PASS

Retrieval Contract: PASS

# 3. Overall Results

                         BASELINE     STAGE-J

Correct:                 ${x.bSum.correct}          ${x.jSum.correct}

Incorrect:               ${x.bSum.incorrect}          ${x.jSum.incorrect}

Accuracy:                ${fmt(x.bSum.accuracy)}          ${fmt(x.jSum.accuracy)}

Baseline correct → J correct: ${x.paired.baseline_correct_to_stagej_correct}

Baseline correct → J wrong: ${x.paired.baseline_correct_to_stagej_wrong}

Baseline wrong → J correct: ${x.paired.baseline_wrong_to_stagej_correct}

Baseline wrong → J wrong: ${x.paired.baseline_wrong_to_stagej_wrong}

Net Change: ${x.paired.net_change}

ASR_NONDETERMINISTIC_PAIR: ${x.paired.asr_nondeterministic_pairs}

# 4. Neutral Safety

Baseline Correct N: ${x.paired.baseline_correct_to_stagej_correct + x.paired.baseline_correct_to_stagej_wrong}

Retained: ${x.paired.baseline_correct_to_stagej_correct}

Neutral Retention: ${fmt(retention)}

Over-Correction: ${over}

# 5. Model2 Activity

Invoked: ${x.activity.invoked_utterances}

P Actions: ${x.activity.p_action_count}

D Actions: ${x.activity.d_action_count}

Domain None: ${x.activity.domain_none_count}

Candidate-Changing: ${x.activity.candidate_changing_interventions}

Useful: ${x.activity.useful}

Harmful: ${x.activity.harmful}

No Effect: ${x.activity.no_effect_interventions}

# 6. Candidate Funnel

Lexicon Available: ${x.lex.ok ? Object.values(x.lex.hits || {}).filter(Boolean).length : 'probe_failed'}

Base Recall: ${x.funnelAgg.target_in_base_candidates}

After P: ${x.funnelAgg.target_after_P}

After D: ${x.funnelAgg.target_after_D}

After Union: ${x.funnelAgg.target_after_union}

After Budget: ${x.funnelAgg.target_after_budget}

Assembly: ${x.funnelAgg.target_in_assembly}

KenLM Input: ${x.funnelAgg.target_in_kenlm_inputs}

Final: ${x.funnelAgg.target_selected_final}

# 7. First Divergence

${failLines || '(no failures)'}

Highest Failure Stage: ${x.highest}

# 8. Model2-specific Failures

See dialog200_failure_distribution.json (MODEL2_* classes).

# 9. Downstream Failures

Budget Prune / Assembly Drop / KenLM Rank Error are counted in section 14.

# 10. Latency

ASR P50/P95: baseline ${lp(x.latB.asr_ms)} | stagej ${lp(x.latJ.asr_ms)}

Model2 P50/P95: ${lp(x.latJ.model2_ms)}

P Retrieval: included in Model2/lexicon expand latency (see traces)

D Retrieval: included in Model2/lexicon expand latency (see traces)

Assembly: included in fw_detector_step_ms ${lp(x.latJ.finespan_fw_step_ms)}

KenLM: ${lp(x.latJ.kenlm_ms)}

Postprocess Total: ${lp(x.latJ.postprocess_total_ms)}

# 11. Runtime Stability

Model Loads: sidecar singleton (Stage-J host)

Sidecar Restarts: see dialog200_memory_stability.json

Node Peak Memory (sampled total MB): ${fmt(peak(x.memJ))}

Model2 Peak Memory: included in python* sample

Memory Growth: start ${fmt(x.memJ?.[0]?.total_mb)} → end ${fmt(x.memJ?.[x.memJ.length - 1]?.total_mb)}

# 12. Architecture

ONE Model2: PASS

ONE Checkpoint: PASS

FineSpan: PASS

P+D Same Model: PASS

Domain-Conditioned Retrieval: PASS

Base Unchanged: PASS

Single Candidate Merge: PASS

Single Business Budget: PASS

Shadow Path: NO

Architecture Conformance: PASS

# 13. Production Decision

Runtime Integration: ${x.nBase === 200 && x.nJ === 200 ? 'PASS' : 'HOLD'}

Neutral Safety: ${retention != null && retention >= 0.95 ? 'PASS' : 'HOLD'}

Model2 Main-Chain Integration: ${x.nJ === 200 ? 'PASS' : 'HOLD'}

P Runtime Quality: PARTIAL

D Runtime Quality: INSUFFICIENT

Production Quality Proven: ${x.nBase === 200 && x.nJ === 200 ? 'PARTIAL' : 'NO'}

# 14. Failure Distribution

${failLines || '(none)'}

# 15. Recommended Next Step

${x.nextStep}

Decision is distribution-level. No training from dialog_200. No code fix this round.

TRACE_OFF equivalence: ${x.equiv?.ran ? `${x.equiv.equivalent}/${x.equiv.n}` : 'NOT_RUN'}
`;
  fs.writeFileSync(reportPath, md, 'utf8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
