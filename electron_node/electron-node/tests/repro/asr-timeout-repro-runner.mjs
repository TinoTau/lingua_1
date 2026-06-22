#!/usr/bin/env node
/**
 * ASR timeout minimal repro — experiments 1–6.
 * Does NOT modify ASR service logic.
 *
 * 默认不自动启动/重启节点端或 python — 请先手动启动一次：
 *   .\scripts\start_electron_node.ps1
 * 然后：
 *   node tests/repro/asr-timeout-repro-runner.mjs
 *
 * 仅在需要「实验前冷启动」时使用：
 *   --restart-before=exp2,exp3   每个 listed 实验前重启 electron+ASR（managed-stack）
 *   --restart-before=exp1,exp5   实验前仅重启 standalone faster-whisper-vad（直连 /utterance）
 *
 * Usage:
 *   node tests/repro/asr-timeout-repro-runner.mjs [--experiments 1,2,3,4,5]
 *   node tests/repro/asr-timeout-repro-runner.mjs --use-existing-stack   # 显式声明（已是默认）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  PROJECT_ROOT,
  DIALOG_DIR,
  loadManifest,
  caseWavPath,
  wavMeta,
  restartAsrService,
  restartElectronStack,
  waitAsrReady,
  waitTestServer,
  postUtterance,
  postPipeline,
  fetchHealth,
  healthSnapshot,
  recordHealthPhase,
  sleep,
  killPort,
  NODE_PORT,
} from './lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPRO_DIR = __dirname;
const RESULT_PATH = path.join(REPRO_DIR, 'asr-timeout-repro-result.json');
const TIMELINE_PATH = path.join(REPRO_DIR, 'asr-timeout-repro-health-timeline.jsonl');

function parseArgs() {
  const args = process.argv.slice(2);
  let experiments = '1,2,3,4,5';
  let skipSetup = false;
  let managedStack = false;
  let useExistingStack = true; // 默认：不自动 spawn electron/python
  let restartBefore = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--experiments' && args[i + 1]) {
      experiments = args[i + 1];
      i += 1;
    } else if (args[i] === '--skip-setup') {
      skipSetup = true;
    } else if (args[i] === '--managed-stack') {
      managedStack = true;
      useExistingStack = false;
    } else if (args[i] === '--use-existing-stack') {
      useExistingStack = true;
    } else if (args[i] === '--restart-before' && args[i + 1]) {
      useExistingStack = false;
      for (const id of args[i + 1].split(',')) {
        restartBefore.add(id.trim());
      }
      i += 1;
    }
  }
  return {
    expIds: experiments.split(',').map((s) => parseInt(s.trim(), 10)),
    skipSetup,
    managedStack,
    useExistingStack,
    restartBefore,
  };
}

function caseById(manifest, id) {
  const c = manifest.find((x) => x.id === id);
  if (!c) throw new Error(`case not found: ${id}`);
  return c;
}

async function runCaseUtterance(stream, caseId, wavPath, meta = {}) {
  const before = await recordHealthPhase(stream, {
    caseId,
    phase: 'before',
    ...meta,
  });
  const result = await postUtterance(wavPath, {
    jobId: `repro-${caseId}-${Date.now()}`,
    traceId: `repro-${caseId}`,
  });
  const after = await recordHealthPhase(stream, {
    caseId,
    phase: 'after',
    ...meta,
  });
  return {
    caseId,
    mode: 'utterance',
    ...result,
    healthBefore: before,
    healthAfter: after,
  };
}

async function runCasePipeline(stream, caseId, wavPath, meta = {}) {
  const before = await recordHealthPhase(stream, {
    caseId,
    phase: 'before',
    ...meta,
  });
  const result = await postPipeline(wavPath, caseId, {});
  const after = await recordHealthPhase(stream, {
    caseId,
    phase: 'after',
    ...meta,
  });
  return {
    caseId,
    mode: 'pipeline',
    ...result,
    healthBefore: before,
    healthAfter: after,
  };
}

async function ensureStackForPipeline(opts = {}, expKey = '') {
  const needRestart =
    opts.restartBefore?.has(expKey) ||
    (opts.managedStack && !opts.useExistingStack);
  if (!needRestart) {
    console.log(`  [stack] 复用现有 electron + ASR（${expKey || 'pipeline'}）`);
    if (!(await waitTestServer(30000))) {
      throw new Error('test server :5020 未就绪 — 请先运行 start_electron_node.ps1');
    }
    const asr = await waitAsrReady(60000);
    if (!asr.ready) {
      throw new Error(`ASR 未就绪: ${JSON.stringify(asr.last)}`);
    }
    return;
  }
  console.log(`  [stack] 冷启动 electron + ASR（${expKey}）`);
  await restartElectronStack();
}

async function ensureStandaloneAsr(opts = {}, expKey = '') {
  const needRestart =
    opts.restartBefore?.has(expKey) ||
    (opts.restartBefore?.has('exp1') && expKey === 'exp1') ||
    (opts.restartBefore?.has('exp5') && expKey === 'exp5');
  if (!needRestart) {
    console.log(`  [stack] 复用现有 ASR :6007（${expKey} utterance）`);
    const asr = await waitAsrReady(60000);
    if (!asr.ready) {
      throw new Error(`ASR 未就绪: ${JSON.stringify(asr.last)}`);
    }
    return;
  }
  console.log(`  [stack] 冷启动 standalone faster-whisper-vad（${expKey}）`);
  await restartAsrService();
}
async function experiment1(stream, manifest, opts = {}) {
  console.log('\n=== Experiment 1: cold d051 utterance x10 ===');
  await ensureStandaloneAsr(opts, 'exp1');
  const c = caseById(manifest, 'd051');
  const wav = caseWavPath(c);
  const runs = [];
  for (let i = 1; i <= 10; i++) {
    console.log(`  [exp1] run ${i}/10 d051 utterance`);
    const row = await runCaseUtterance(stream, 'd051', wav, {
      experiment: 'exp1',
      runIndex: i,
    });
    runs.push(row);
    console.log(
      `    status=${row.status} ok=${row.ok} latency=${row.latencyMs}ms`
    );
    await sleep(500);
  }
  const pass = runs.filter((r) => r.ok && r.status === 200).length;
  return {
    name: 'exp1_cold_d051_utterance_x10',
    pass,
    total: 10,
    passRate: pass / 10,
    runs,
    verdict:
      pass === 10
        ? 'exclude_d051_audio_as_primary_cause'
        : pass === 0
          ? 'd051_audio_or_transcribe_suspect'
          : 'intermittent',
  };
}

async function experiment2(stream, manifest, opts = {}) {
  console.log('\n=== Experiment 2: pipeline d001-d051 ===');
  await ensureStackForPipeline(opts, 'exp2');
  if (!(await waitTestServer(60000))) {
    throw new Error('test server :5020 not ready for exp2');
  }
  const ids = [];
  for (let n = 1; n <= 51; n++) {
    ids.push(`d${String(n).padStart(3, '0')}`);
  }
  const runs = [];
  for (const id of ids) {
    const c = caseById(manifest, id);
    const wav = caseWavPath(c);
    console.log(`  [exp2] ${id} pipeline`);
    const row = await runCasePipeline(stream, id, wav, { experiment: 'exp2' });
    runs.push(row);
    console.log(
      `    status=${row.status} ok=${row.ok} latency=${row.latencyMs}ms err=${row.error || ''}`
    );
    if (!row.ok) break;
  }
  const d051 = runs.find((r) => r.caseId === 'd051');
  const before051 = runs.filter((r) => r.ok).length;
  return {
    name: 'exp2_pipeline_d001_d051',
    casesRun: runs.length,
    passBeforeD051: before051,
    d051: d051 || null,
    runs,
    verdict:
      before051 === 50 && d051 && !d051.ok && d051.status === 504
        ? 'supports_long_run_accumulation'
        : d051?.ok
          ? 'd051_pass_hot_not_reproduced'
          : 'inconclusive',
  };
}

async function experiment3(stream, manifest, opts = {}) {
  console.log('\n=== Experiment 3: pipeline d045-d055 ===');
  await ensureStackForPipeline(opts, 'exp3');
  if (!(await waitTestServer(60000))) {
    throw new Error('test server :5020 not ready for exp3');
  }
  const ids = [];
  for (let n = 45; n <= 55; n++) {
    ids.push(`d${String(n).padStart(3, '0')}`);
  }
  const runs = [];
  for (const id of ids) {
    const c = caseById(manifest, id);
    const wav = caseWavPath(c);
    console.log(`  [exp3] ${id} pipeline`);
    const row = await runCasePipeline(stream, id, wav, { experiment: 'exp3' });
    runs.push(row);
    console.log(
      `    status=${row.status} ok=${row.ok} latency=${row.latencyMs}ms`
    );
  }
  const d051 = runs.find((r) => r.caseId === 'd051');
  return {
    name: 'exp3_pipeline_d045_d055',
    runs,
    d051,
    verdict: d051?.ok
      ? 'd051_pass_in_short_sequence'
      : d051 && !d051.ok
        ? 'd051_fail_in_short_sequence'
        : 'inconclusive',
  };
}

async function experiment4(stream, manifest, opts = {}) {
  console.log('\n=== Experiment 4: skip d051, pipeline d052-d060 ===');
  await ensureStackForPipeline(opts, 'exp4');
  if (!(await waitTestServer(60000))) {
    throw new Error('test server :5020 not ready for exp4');
  }
  const ids = [];
  for (let n = 52; n <= 60; n++) {
    ids.push(`d${String(n).padStart(3, '0')}`);
  }
  const runs = [];
  for (const id of ids) {
    const c = caseById(manifest, id);
    const wav = caseWavPath(c);
    console.log(`  [exp4] ${id} pipeline`);
    const row = await runCasePipeline(stream, id, wav, { experiment: 'exp4' });
    runs.push(row);
    console.log(
      `    status=${row.status} ok=${row.ok} latency=${row.latencyMs}ms`
    );
  }
  const pass = runs.filter((r) => r.ok).length;
  return {
    name: 'exp4_skip_d051_d052_d060',
    pass,
    total: runs.length,
    runs,
    verdict:
      pass === runs.length
        ? 'd052_plus_pass_without_d051_hang_predecessor'
        : 'd052_plus_also_fail',
  };
}

async function experiment5(stream, manifest, opts = {}) {
  console.log('\n=== Experiment 5: direct /utterance cold + hot ===');
  const c = caseById(manifest, 'd051');
  const wav = caseWavPath(c);

  console.log('  [exp5a] cold restart + d051 x10 utterance');
  await ensureStandaloneAsr(opts, 'exp5');
  const coldRuns = [];
  for (let i = 1; i <= 10; i++) {
    const row = await runCaseUtterance(stream, 'd051', wav, {
      experiment: 'exp5_cold',
      runIndex: i,
    });
    coldRuns.push(row);
    console.log(`    cold ${i}: status=${row.status} latency=${row.latencyMs}ms`);
    await sleep(300);
  }

  console.log('  [exp5b] hot: pipeline d001-d050 then utterance d051');
  await ensureStackForPipeline(opts, 'exp5');
  if (!(await waitTestServer(60000))) {
    throw new Error('test server not ready for exp5 hot');
  }
  for (let n = 1; n <= 50; n++) {
    const id = `d${String(n).padStart(3, '0')}`;
    const ci = caseById(manifest, id);
    const w = caseWavPath(ci);
    const row = await runCasePipeline(stream, id, w, {
      experiment: 'exp5_warmup',
      warmupIndex: n,
    });
    if (n % 10 === 0) {
      console.log(`    warmup ${n}/50 ok=${row.ok} latency=${row.latencyMs}ms`);
    }
    if (!row.ok) {
      return {
        name: 'exp5_direct_utterance',
        coldRuns,
        hotAbortedAt: id,
        hotAborted: row,
        verdict: 'warmup_failed_before_d051',
      };
    }
  }
  const hotRow = await runCaseUtterance(stream, 'd051', wav, {
    experiment: 'exp5_hot',
    runIndex: 1,
  });
  console.log(
    `    hot d051: status=${hotRow.status} latency=${hotRow.latencyMs}ms`
  );

  const coldPass = coldRuns.filter((r) => r.ok).length;
  return {
    name: 'exp5_direct_utterance',
    coldRuns,
    coldPassRate: coldPass / 10,
    hotD051: hotRow,
    verdict:
      coldPass === 10 && !hotRow.ok
        ? 'hot_only_fail_direct_asr'
        : coldPass === 10 && hotRow.ok
          ? 'cannot_reproduce_on_direct_asr'
          : coldPass < 10
            ? 'd051_fails_cold_direct_asr'
            : 'mixed',
  };
}

async function setupEnvironment() {
  console.log('[setup] 仅检查服务就绪（不自动 spawn 节点端/python）');
  console.log('[setup] 若未启动，请先运行: .\\scripts\\start_electron_node.ps1');

  const nodeUp = await waitTestServer(30000);
  const asrReady = await waitAsrReady(60000);
  if (!nodeUp) {
    console.warn('[setup] WARN: :5020 未就绪 — pipeline 实验将失败');
  } else {
    console.log('[setup] test server :5020 OK');
  }
  if (!asrReady.ready) {
    console.warn('[setup] WARN: :6007 ASR 未就绪');
  } else {
    console.log('[setup] ASR :6007 OK', asrReady.health);
  }

  return { asrReady, nodeUp };
}

async function main() {
  const { expIds, skipSetup, managedStack, useExistingStack, restartBefore } =
    parseArgs();
  const manifest = loadManifest();
  const startedAt = new Date().toISOString();

  fs.writeFileSync(TIMELINE_PATH, '', 'utf8');
  const timelineStream = fs.createWriteStream(TIMELINE_PATH, { flags: 'a' });

  const audioMeta = {};
  for (const id of ['d049', 'd050', 'd051', 'd052', 'd053', 'd054', 'd055']) {
    const c = caseById(manifest, id);
    audioMeta[id] = { scenario: c.scenario, ...wavMeta(caseWavPath(c)) };
  }

  let setup = { skipped: skipSetup };
  if (!skipSetup) {
    setup = await setupEnvironment();
  } else {
    const ready = await waitAsrReady(60000);
    setup = { skipSetup: true, asr: ready };
  }

  const baseline = await fetchHealth().catch(() => null);
  const results = {
    timestamp: startedAt,
    finishedAt: null,
    projectRoot: PROJECT_ROOT,
    dialogDir: DIALOG_DIR,
    audioMeta,
    setup,
    baselineHealth: baseline ? healthSnapshot(baseline) : null,
    experiments: {},
  };

  const runOpts = { managedStack, useExistingStack, restartBefore };

  if (expIds.includes(1)) {
    results.experiments.exp1 = await experiment1(timelineStream, manifest, runOpts);
  }
  if (expIds.includes(2)) {
    results.experiments.exp2 = await experiment2(timelineStream, manifest, runOpts);
  }
  if (expIds.includes(3)) {
    results.experiments.exp3 = await experiment3(timelineStream, manifest, runOpts);
  }
  if (expIds.includes(4)) {
    results.experiments.exp4 = await experiment4(timelineStream, manifest, runOpts);
  }
  if (expIds.includes(5)) {
    results.experiments.exp5 = await experiment5(timelineStream, manifest, runOpts);
  }

  results.finishedAt = new Date().toISOString();
  timelineStream.end();
  fs.writeFileSync(RESULT_PATH, JSON.stringify(results, null, 2), 'utf8');
  console.log('\n[done] wrote', RESULT_PATH);
  console.log('[done] wrote', TIMELINE_PATH);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
