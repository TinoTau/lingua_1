#!/usr/bin/env node
/**
 * 504 → 503 storm reproduction with full timeline capture.
 * Read-only w.r.t. production + ASR service logic.
 *
 * Usage:
 *   node tests/repro/504-503-storm-repro-runner.mjs --use-existing-stack
 *   node tests/repro/504-503-storm-repro-runner.mjs --scenarios A,B,C --repeat 2
 *   node tests/repro/504-503-storm-repro-runner.mjs --managed-stack
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PROJECT_ROOT,
  DIALOG_DIR,
  loadManifest,
  caseWavPath,
  waitAsrReady,
  waitTestServer,
  postUtterance,
  postPipeline,
  sleep,
  restartElectronStack,
} from './lib/asr-repro-utils.mjs';
import {
  HealthSnapshotCollector,
  GpuSnapshotCollector,
  ProcessSnapshotCollector,
  sliceTimelineJsonl,
  readJsonl,
} from './lib/storm-collectors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = path.join(__dirname, `storm-repro-${RUN_ID}`);

function parseArgs() {
  const args = process.argv.slice(2);
  let scenarios = ['A', 'B', 'C'];
  let repeat = 2;
  let mode = 'utterance';
  let useExisting = true;
  let managedStack = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--scenarios' && args[i + 1]) {
      scenarios = args[i + 1].split(',').map((s) => s.trim().toUpperCase());
      i += 1;
    } else if (a === '--repeat' && args[i + 1]) {
      repeat = parseInt(args[i + 1], 10) || 2;
      i += 1;
    } else if (a === '--mode' && args[i + 1]) {
      mode = args[i + 1];
      i += 1;
    } else if (a === '--managed-stack') {
      managedStack = true;
      useExisting = false;
    } else if (a === '--use-existing-stack') {
      useExisting = true;
    }
  }
  return { scenarios, repeat, mode, useExisting, managedStack };
}

function caseById(manifest, id) {
  const c = manifest.find((x) => x.id === id);
  if (!c) throw new Error(`case not found: ${id}`);
  return c;
}

async function runOneRequest(runWriter, ctx) {
  const { caseId, wavPath, mode, scenario, round, index } = ctx;
  const reqId = `${scenario}-r${round}-i${index}-${caseId}-${Date.now()}`;
  const startMs = Date.now();
  runWriter.write({
    kind: 'request_start',
    req_id: reqId,
    timestamp: new Date().toISOString(),
    ts_ms: startMs,
    case_id: caseId,
    scenario,
    round,
    index,
    mode,
    wav_path: wavPath,
  });

  const result =
    mode === 'pipeline'
      ? await postPipeline(wavPath, caseId, { sessionId: reqId })
      : await postUtterance(wavPath, { jobId: reqId, traceId: reqId });

  const endMs = Date.now();
  const row = {
    kind: 'request_end',
    req_id: reqId,
    timestamp: new Date().toISOString(),
    ts_ms: endMs,
    case_id: caseId,
    scenario,
    round,
    index,
    mode,
    ok: result.ok,
    status: result.status,
    latency_ms: result.latencyMs ?? endMs - startMs,
    error: result.error || result.detail || null,
    text_len: result.textLen,
    pipeline_ms: result.pipeline_ms,
    asr_service_id: result.asr_service_id,
    is_504: result.status === 504,
    is_503: result.status === 503,
  };
  runWriter.write(row);
  return row;
}

async function runOverlapBurst(runWriter, ctx) {
  const { caseIds, mode, scenario, round, concurrency } = ctx;
  const starts = [];
  for (let i = 0; i < concurrency; i++) {
    const caseId = caseIds[i % caseIds.length];
    const c = caseById(loadManifest(), caseId);
    const wav = caseWavPath(c);
    const reqId = `${scenario}-overlap-r${round}-i${i + 1}-${caseId}-${Date.now()}`;
    const startMs = Date.now();
    runWriter.write({
      kind: 'request_start',
      req_id: reqId,
      timestamp: new Date().toISOString(),
      ts_ms: startMs,
      case_id: caseId,
      scenario,
      round,
      index: i + 1,
      mode,
      overlap: true,
      wav_path: wav,
    });
    const p = (async () => {
      const result =
        mode === 'pipeline'
          ? await postPipeline(wav, caseId, { sessionId: reqId })
          : await postUtterance(wav, { jobId: reqId, traceId: reqId });
      const endMs = Date.now();
      return {
        kind: 'request_end',
        req_id: reqId,
        timestamp: new Date().toISOString(),
        ts_ms: endMs,
        case_id: caseId,
        scenario,
        round,
        index: i + 1,
        mode,
        overlap: true,
        ok: result.ok,
        status: result.status,
        latency_ms: result.latencyMs ?? endMs - startMs,
        error: result.error || result.detail || null,
        text_len: result.textLen,
        pipeline_ms: result.pipeline_ms,
        asr_service_id: result.asr_service_id,
        is_504: result.status === 504,
        is_503: result.status === 503,
      };
    })();
    starts.push(p);
  }
  return Promise.all(starts);
}

function buildScenarioSequences(scenarios, repeat) {
  const seqs = [];
  if (scenarios.includes('A')) {
    seqs.push({
      id: 'A',
      label: `A_repeat_d008_x${repeat}`,
      cases: Array.from({ length: repeat }, () => 'd008'),
    });
  }
  if (scenarios.includes('B')) {
    for (let r = 0; r < repeat; r++) {
      seqs.push({
        id: 'B',
        label: `B_alternate_d008_d009_r${r + 1}`,
        cases: ['d008', 'd009', 'd008', 'd009'],
      });
    }
  }
  if (scenarios.includes('C')) {
    for (let r = 0; r < repeat; r++) {
      seqs.push({
        id: 'C',
        label: `C_chain_d045_d047_r${r + 1}`,
        cases: ['d045', 'd046', 'd047'],
      });
    }
  }
  if (scenarios.includes('D')) {
    for (let r = 0; r < repeat; r++) {
      seqs.push({
        id: 'D',
        label: `D_overlap_burst_d008_x4_r${r + 1}`,
        overlap: true,
        caseIds: ['d008', 'd008', 'd009', 'd009'],
        concurrency: 4,
      });
    }
    for (let r = 0; r < repeat; r++) {
      seqs.push({
        id: 'D',
        label: `D_overlap_burst_d045_d047_x6_r${r + 1}`,
        overlap: true,
        caseIds: ['d045', 'd046', 'd047', 'd045', 'd046', 'd047'],
        concurrency: 6,
      });
    }
  }
  if (scenarios.includes('E')) {
    seqs.push({
      id: 'E',
      label: 'E_slow_d008_then_overlap',
      slowThenOverlap: true,
      slowCase: 'd008',
      burstCaseIds: ['d009', 'd009', 'd008', 'd008'],
      concurrency: 4,
      delayMs: 500,
    });
  }
  if (scenarios.includes('F')) {
    seqs.push({
      id: 'F',
      label: 'F_warmup_d040_d050_then_d051_storm',
      warmupCases: Array.from({ length: 11 }, (_, i) =>
        `d${String(40 + i).padStart(3, '0')}`
      ),
      slowThenOverlap: true,
      slowCase: 'd051',
      burstCaseIds: ['d052', 'd053', 'd054', 'd051'],
      concurrency: 4,
      delayMs: 300,
    });
  }
  return seqs;
}

function analyzeResults(outDir, requests, events504) {
  const health = readJsonl(path.join(outDir, 'health-timeline.jsonl'));
  const analysis = {
    request_total: requests.filter((r) => r.kind === 'request_end').length,
    count_504: requests.filter((r) => r.is_504).length,
    count_503: requests.filter((r) => r.is_503).length,
    first_504: requests.find((r) => r.is_504) || null,
    first_503_after_504: null,
    events_504: [],
  };

  for (const ev of events504) {
    const center = ev.ts_ms;
    const healthSlice = sliceTimelineJsonl(
      path.join(outDir, 'health-timeline.jsonl'),
      center,
      10000,
      60000
    );
    const gpuSlice = sliceTimelineJsonl(
      path.join(outDir, 'gpu-timeline.jsonl'),
      center,
      10000,
      60000
    );
    const procSlice = sliceTimelineJsonl(
      path.join(outDir, 'process-timeline.jsonl'),
      center,
      10000,
      60000
    );
    const reqSlice = requests.filter(
      (r) => r.kind === 'request_end' && r.ts_ms >= center - 10000 && r.ts_ms <= center + 60000
    );

    const at504 = healthSlice.filter((h) => Math.abs(h.ts_ms - center) < 2000);
    const after504 = healthSlice.filter((h) => h.ts_ms > center && h.ts_ms <= center + 15000);
    const at503 = healthSlice.filter((h) =>
      reqSlice.some((r) => r.is_503 && Math.abs(r.ts_ms - h.ts_ms) < 1500)
    );

    analysis.events_504.push({
      req_id: ev.req_id,
      case_id: ev.case_id,
      ts_ms: center,
      health_at_504: at504.slice(0, 3),
      health_after_504_15s: after504.slice(0, 20),
      health_near_503: at503.slice(0, 10),
      queue_at_504: at504.map((h) => h.queue_depth),
      pending_at_504: at504.map((h) => h.pending_results),
      worker_pid_at_504: at504.map((h) => h.worker_pid),
      worker_restarts_at_504: at504.map((h) => h.worker_restarts),
      queue_on_503_requests: reqSlice
        .filter((r) => r.is_503)
        .map((r) => {
          const h = healthSlice.find((x) => Math.abs(x.ts_ms - r.ts_ms) < 1500);
          return {
            req_id: r.req_id,
            case_id: r.case_id,
            queue_depth: h?.queue_depth,
            pending_results: h?.pending_results,
            worker_state: h?.worker_state,
            worker_pid: h?.worker_pid,
          };
        }),
      gpu_peak_after_504: gpuSlice.reduce(
        (m, g) => Math.max(m, g.memory_used_mb || 0),
        0
      ),
      gpu_compute_apps_after_504: gpuSlice
        .filter((g) => g.ts_ms > center && g.ts_ms < center + 60000)
        .slice(-5)
        .map((g) => g.compute_apps),
      process_python_count_max: procSlice.reduce(
        (m, p) => Math.max(m, p.python_count || 0),
        0
      ),
      requests_in_window: reqSlice,
      window_files: {
        health: path.join(outDir, `window-${ev.req_id}-health.json`),
        gpu: path.join(outDir, `window-${ev.req_id}-gpu.json`),
        process: path.join(outDir, `window-${ev.req_id}-process.json`),
        requests: path.join(outDir, `window-${ev.req_id}-requests.json`),
      },
    });

    fs.writeFileSync(
      path.join(outDir, `window-${ev.req_id}-health.json`),
      JSON.stringify(healthSlice, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, `window-${ev.req_id}-gpu.json`),
      JSON.stringify(gpuSlice, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, `window-${ev.req_id}-process.json`),
      JSON.stringify(procSlice, null, 2)
    );
    fs.writeFileSync(
      path.join(outDir, `window-${ev.req_id}-requests.json`),
      JSON.stringify(reqSlice, null, 2)
    );
  }

  const first504 = requests.find((r) => r.is_504);
  if (first504) {
    analysis.first_503_after_504 = requests.find(
      (r) => r.is_503 && r.ts_ms > first504.ts_ms
    );
  }

  const lastHealth = health[health.length - 1];
  analysis.final_health = lastHealth || null;

  const reqs503 = requests.filter((r) => r.kind === 'request_end' && r.is_503);
  if (reqs503.length && !analysis.first_504) {
    const healthAll = readJsonl(path.join(outDir, 'health-timeline.jsonl'));
    analysis.storm_503_analysis = reqs503.map((r) => {
      const h = healthAll.find((x) => Math.abs(x.ts_ms - r.ts_ms) < 1500);
      return {
        req_id: r.req_id,
        case_id: r.case_id,
        scenario: r.scenario,
        ts_ms: r.ts_ms,
        latency_ms: r.latency_ms,
        queue_depth: h?.queue_depth,
        pending_results: h?.pending_results,
        worker_state: h?.worker_state,
        worker_pid: h?.worker_pid,
        worker_restarts: h?.worker_restarts,
      };
    });
    const qd = analysis.storm_503_analysis.map((x) => x.queue_depth).filter((x) => x != null);
    analysis.queue_depth_on_503 = {
      min: qd.length ? Math.min(...qd) : null,
      max: qd.length ? Math.max(...qd) : null,
      samples: qd,
    };
  }

  return analysis;
}

async function main() {
  const { scenarios, repeat, mode, useExisting, managedStack } = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const meta = { run_id: RUN_ID, project_root: PROJECT_ROOT };
  const healthPath = path.join(OUT_DIR, 'health-timeline.jsonl');
  const gpuPath = path.join(OUT_DIR, 'gpu-timeline.jsonl');
  const processPath = path.join(OUT_DIR, 'process-timeline.jsonl');
  const runPath = path.join(OUT_DIR, 'repro-run.jsonl');

  const healthCol = new HealthSnapshotCollector(healthPath, 500);
  const gpuCol = new GpuSnapshotCollector(gpuPath, 1000);
  const procCol = new ProcessSnapshotCollector(processPath, 1000);

  const runWriter = {
    stream: fs.createWriteStream(runPath, { flags: 'a' }),
    write(o) {
      this.stream.write(JSON.stringify(o) + '\n');
    },
  };

  console.log('[storm-repro] OUT_DIR', OUT_DIR);
  console.log('[storm-repro] scenarios', scenarios, 'repeat', repeat, 'mode', mode);

  healthCol.start(meta);
  gpuCol.start(meta);
  procCol.start(meta);

  if (managedStack) {
    console.log('[storm-repro] starting managed electron stack...');
    await restartElectronStack();
  } else if (useExisting) {
    const nodeOk = await waitTestServer(30000);
    if (!nodeOk) {
      console.error('[storm-repro] :5020 not ready — start electron node or use --managed-stack');
      process.exit(1);
    }
    const asr = await waitAsrReady(120000);
    if (!asr.ready) {
      console.error('[storm-repro] ASR not ready', asr.last);
      process.exit(1);
    }
    console.log('[storm-repro] existing stack OK, ASR warmup', asr.elapsedMs, 'ms');
  }

  const manifest = loadManifest();
  const sequences = buildScenarioSequences(scenarios, repeat);
  const allRequests = [];
  const events504 = [];

  for (const seq of sequences) {
    console.log('[storm-repro] scenario', seq.label);
    if (seq.warmupCases?.length) {
      console.log('[storm-repro] warmup', seq.warmupCases.join(' → '));
      let wIdx = 0;
      for (const caseId of seq.warmupCases) {
        wIdx += 1;
        const c = caseById(manifest, caseId);
        const wav = caseWavPath(c);
        const row = await runOneRequest(runWriter, {
          caseId,
          wavPath: wav,
          mode,
          scenario: seq.id,
          round: 0,
          index: wIdx,
        });
        allRequests.push(row);
        if (row.is_504) {
          events504.push(row);
          console.log('[storm-repro] *** 504 captured (warmup)', caseId, row.latency_ms, 'ms');
        }
        if (row.is_503) {
          console.log('[storm-repro] *** 503 captured (warmup)', caseId, row.latency_ms, 'ms');
        }
        await sleep(100);
      }
    }
    if (seq.slowThenOverlap) {
      const scen = seq.id;
      const slowC = caseById(manifest, seq.slowCase);
      const slowWav = caseWavPath(slowC);
      const slowReqId = `${scen}-slow-${seq.slowCase}-${Date.now()}`;
      const slowStart = Date.now();
      runWriter.write({
        kind: 'request_start',
        req_id: slowReqId,
        ts_ms: slowStart,
        timestamp: new Date().toISOString(),
        case_id: seq.slowCase,
        scenario: scen,
        slow_anchor: true,
      });
      const slowFn =
        mode === 'pipeline'
          ? () => postPipeline(slowWav, seq.slowCase, { sessionId: slowReqId, timeoutMs: 120000 })
          : () =>
              postUtterance(slowWav, {
                jobId: slowReqId,
                traceId: slowReqId,
                timeoutMs: 120000,
              });
      const slowPromise = slowFn().then((result) => ({
        kind: 'request_end',
        req_id: slowReqId,
        ts_ms: Date.now(),
        timestamp: new Date().toISOString(),
        case_id: seq.slowCase,
        scenario: scen,
        slow_anchor: true,
        ok: result.ok,
        status: result.status,
        latency_ms: result.latencyMs,
        error: result.error || result.detail,
        is_504: result.status === 504,
        is_503: result.status === 503,
      }));
      await sleep(seq.delayMs || 500);
      const burstRows = await runOverlapBurst(runWriter, {
        caseIds: seq.burstCaseIds,
        mode,
        scenario: scen,
        round: 1,
        concurrency: seq.concurrency,
      });
      const slowRow = await slowPromise;
      const rows = [slowRow, ...burstRows];
      for (const row of rows) {
        allRequests.push(row);
        runWriter.write(row);
        if (row.is_504) {
          events504.push(row);
          console.log('[storm-repro] *** 504 captured', row.case_id, row.latency_ms, 'ms');
        }
        if (row.is_503) {
          console.log('[storm-repro] *** 503 captured', row.case_id, row.latency_ms, 'ms');
        }
      }
      await sleep(2000);
      continue;
    }
    if (seq.overlap) {
      const rows = await runOverlapBurst(runWriter, {
        caseIds: seq.caseIds,
        mode,
        scenario: seq.id,
        round: 1,
        concurrency: seq.concurrency,
      });
      for (const row of rows) {
        allRequests.push(row);
        runWriter.write(row);
        if (row.is_504) {
          events504.push(row);
          console.log('[storm-repro] *** 504 captured', row.case_id, row.latency_ms, 'ms');
        }
        if (row.is_503) {
          console.log('[storm-repro] *** 503 captured', row.case_id, row.latency_ms, 'ms');
        }
      }
      await sleep(2000);
      continue;
    }
    console.log('[storm-repro] cases', seq.cases.join(' → '));
    for (let round = 0; round < 1; round++) {
      let idx = 0;
      for (const caseId of seq.cases) {
        idx += 1;
        const c = caseById(manifest, caseId);
        const wav = caseWavPath(c);
        const row = await runOneRequest(runWriter, {
          caseId,
          wavPath: wav,
          mode,
          scenario: seq.id,
          round: round + 1,
          index: idx,
        });
        allRequests.push(row);
        if (row.is_504) {
          events504.push(row);
          console.log('[storm-repro] *** 504 captured', caseId, row.latency_ms, 'ms');
          await sleep(500);
        }
        if (row.is_503) {
          console.log('[storm-repro] *** 503 captured', caseId, row.latency_ms, 'ms');
        }
        await sleep(200);
      }
    }
  }

  await sleep(3000);
  await healthCol.stop();
  await gpuCol.stop();
  await procCol.stop();
  runWriter.stream.end();

  const analysis = analyzeResults(OUT_DIR, allRequests, events504);
  const summary = {
    run_id: RUN_ID,
    out_dir: OUT_DIR,
    timestamp: new Date().toISOString(),
    scenarios,
    repeat,
    mode,
    reproduction_success:
      analysis.count_504 >= 1 &&
      analysis.count_503 >= 1 &&
      analysis.first_503_after_504 != null,
    ...analysis,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'storm-repro-summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log('[storm-repro] summary', JSON.stringify({
    reproduction_success: summary.reproduction_success,
    count_504: summary.count_504,
    count_503: summary.count_503,
    out_dir: OUT_DIR,
  }));

  return summary;
}

main().catch((e) => {
  console.error('[storm-repro] FATAL', e);
  process.exit(1);
});
