#!/usr/bin/env node
/** Run storm + dialog200 assuming node already up. */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PROJECT_ROOT } from './lib/asr-repro-utils.mjs';
import { waitTestServer, waitAsrReady } from './lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeDir = path.resolve(__dirname, '../..');
const logPath = path.join(__dirname, 'full-storm-dialog200-run.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logPath, line + '\n');
  fs.writeFileSync(path.join(__dirname, 'storm-test-progress.txt'), line + '\n', { flag: 'a' });
}

function runNode(scriptRel, args = [], timeoutMs = 0) {
  const script = path.join(electronNodeDir, scriptRel);
  log(`RUN ${scriptRel} ${args.join(' ')}`);
  return spawnSync(process.execPath, [script, ...args], {
    cwd: electronNodeDir,
    env: { ...process.env, PROJECT_ROOT },
    encoding: 'utf8',
    timeout: timeoutMs || undefined,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] === TESTS ONLY START ===\n`);
  if (!(await waitTestServer(180000))) {
    log('FATAL :5020 not ready');
    process.exit(1);
  }
  const asr = await waitAsrReady(180000);
  if (!asr.ready) {
    log('FATAL ASR not ready ' + JSON.stringify(asr.last));
    process.exit(1);
  }
  log('stack OK warmup ' + asr.elapsedMs + 'ms');

  const storm = runNode('tests/repro/504-503-storm-repro-runner.mjs', [
    '--use-existing-stack',
    '--scenarios',
    'F,E,D',
    '--repeat',
    '1',
    '--mode',
    'utterance',
  ], 25 * 60 * 1000);
  if (storm.stdout) fs.appendFileSync(logPath, storm.stdout);
  if (storm.stderr) fs.appendFileSync(logPath, storm.stderr);

  const dirs = fs
    .readdirSync(__dirname)
    .filter((d) => d.startsWith('storm-repro-'))
    .map((d) => ({ d, t: fs.statSync(path.join(__dirname, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (dirs[0]) {
    const sp = path.join(__dirname, dirs[0].d, 'storm-repro-summary.json');
    fs.copyFileSync(sp, path.join(__dirname, 'storm-repro-latest-summary.json'));
    runNode('tests/repro/write-storm-repro-report.mjs', [sp]);
  }

  const batch = runNode('tests/run-dialog200-timed-batch.mjs', [
    '--max-minutes',
    '15',
    '--out',
    'storm-repro-pipeline-batch-result.json',
    path.join(PROJECT_ROOT, 'test wav', 'dialog_200'),
  ], 16 * 60 * 1000);
  if (batch.stdout) fs.appendFileSync(logPath, batch.stdout);
  if (batch.stderr) fs.appendFileSync(logPath, batch.stderr);

  const batchPath = path.join(electronNodeDir, 'tests', 'storm-repro-pipeline-batch-result.json');
  if (fs.existsSync(batchPath)) {
    runNode('tests/repro/analyze-storm-dialog200.mjs', [
      batchPath,
      path.join(electronNodeDir, 'tests', 'storm-repro-pipeline-quality-perf.json'),
    ]);
  }
  runNode('tests/repro/write-storm-dev-test-reports.mjs', [
    path.join(__dirname, 'storm-repro-latest-summary.json'),
    path.join(electronNodeDir, 'tests', 'storm-repro-pipeline-quality-perf.json'),
  ]);

  log('=== FULL_TEST_DONE ===');
}

main().catch((e) => {
  log('FATAL ' + e.message);
  process.exit(1);
});
