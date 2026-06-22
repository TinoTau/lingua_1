#!/usr/bin/env node
/**
 * Full round: cleanup ports → start electron → storm repro → dialog_200 batch → reports.
 * Test-only orchestrator; does not modify production code.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { killPort, restartElectronStack, PROJECT_ROOT } from './lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeDir = path.resolve(__dirname, '../..');
const logPath = path.join(__dirname, 'full-storm-dialog200-run.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + '\n');
}

function runNode(scriptRel, args = [], opts = {}) {
  const script = path.join(electronNodeDir, scriptRel);
  log(`RUN node ${scriptRel} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: electronNodeDir,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 0,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.stdout) fs.appendFileSync(logPath, r.stdout);
  if (r.stderr) fs.appendFileSync(logPath, r.stderr);
  if (r.status !== 0 && !opts.allowFail) {
    log(`FAIL exit=${r.status} ${scriptRel}`);
    if (!opts.continueOnFail) throw new Error(`failed: ${scriptRel}`);
  }
  return r;
}

async function main() {
  fs.writeFileSync(logPath, '');
  log('=== FULL STORM + DIALOG200 TEST START ===');

  log('Step 1: kill ports 6007, 5020');
  killPort(6007);
  killPort(5020);
  await new Promise((r) => setTimeout(r, 3000));

  log('Step 2: start electron stack');
  process.env.PROJECT_ROOT = PROJECT_ROOT;
  await restartElectronStack();

  log('Step 3: storm repro F,E,D');
  const stormRun = runNode('tests/repro/504-503-storm-repro-runner.mjs', [
    '--use-existing-stack',
    '--scenarios',
    'F,E,D',
    '--repeat',
    '1',
    '--mode',
    'utterance',
  ], { timeoutMs: 25 * 60 * 1000, allowFail: true, continueOnFail: true });

  const stormOutMatch = (stormRun.stdout || '').match(/storm-repro-[^\s"']+/);
  let summaryPath = null;
  if (stormOutMatch) {
    const dir = path.join(__dirname, stormOutMatch[0]);
    summaryPath = path.join(dir, 'storm-repro-summary.json');
  } else {
    const dirs = fs
      .readdirSync(__dirname)
      .filter((d) => d.startsWith('storm-repro-'))
      .map((d) => ({ d, t: fs.statSync(path.join(__dirname, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (dirs[0]) summaryPath = path.join(__dirname, dirs[0].d, 'storm-repro-summary.json');
  }
  if (summaryPath && fs.existsSync(summaryPath)) {
    fs.copyFileSync(summaryPath, path.join(__dirname, 'storm-repro-latest-summary.json'));
    runNode('tests/repro/write-storm-repro-report.mjs', [summaryPath], { allowFail: true });
  }

  log('Step 4: dialog_200 timed batch (15 min)');
  runNode('tests/run-dialog200-timed-batch.mjs', [
    '--max-minutes',
    '15',
    '--out',
    'storm-dialog200-batch-result.json',
    path.join(PROJECT_ROOT, 'test wav', 'dialog_200'),
  ], { timeoutMs: 16 * 60 * 1000, allowFail: true, continueOnFail: true });

  const batchPath = path.join(electronNodeDir, 'tests', 'storm-dialog200-batch-result.json');
  if (fs.existsSync(batchPath)) {
    log('Step 5: analyze quality/perf');
    runNode('tests/repro/analyze-storm-dialog200.mjs', [
      batchPath,
      path.join(electronNodeDir, 'tests', 'storm-dialog200-quality-perf.json'),
    ], { allowFail: true });
  }

  log('Step 6: write dev + test reports');
  const latestSummary = path.join(__dirname, 'storm-repro-latest-summary.json');
  runNode('tests/repro/write-storm-dev-test-reports.mjs', [
    fs.existsSync(latestSummary) ? latestSummary : summaryPath || latestSummary,
    path.join(electronNodeDir, 'tests', 'storm-dialog200-quality-perf.json'),
  ], { allowFail: true });

  log('=== FULL_TEST_DONE ===');
}

main().catch((e) => {
  log(`FATAL ${e.message}`);
  console.error(e);
  process.exit(1);
});
