#!/usr/bin/env node
/**
 * Phase 5 acceptance: health → validate → build → gate → benchmark → optional dialog_200.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(electronNodeRoot, '../..');
const ladder = process.env.PHASE5_LADDER ?? '2k';

const seedByLadder = {
  '2k': 'data/lexicon/10k/lexicon_10k_canonical_merged.jsonl',
  '5k': 'data/lexicon/5k/lexicon_5k_canonical_merged.jsonl',
};
const seedRel = seedByLadder[ladder] ?? seedByLadder['2k'];

function run(label, cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: electronNodeRoot, encoding: 'utf-8', ...opts });
  if (result.status !== 0) {
    console.error(`[phase5-acceptance] FAIL ${label}`);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  console.log(`[phase5-acceptance] PASS ${label}`);
}

function getPort() {
  const cfgPath = path.join(
    process.env.APPDATA || '',
    'lingua-electron-node',
    'electron-node-config.json'
  );
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.testServer?.port) return cfg.testServer.port;
    } catch {
      /* ignore */
    }
  }
  return 5020;
}

async function healthCheck(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const skipHealth = process.argv.includes('--skip-health');
  const runE2e = process.argv.includes('--e2e');

  if (ladder === '5k') {
    run('prepare-5k', process.execPath, [path.join(__dirname, 'prepare-5k-seed.mjs')]);
  }

  if (!skipHealth) {
    const port = getPort();
    const ok = await healthCheck(port);
    if (!ok) {
      console.warn(`[phase5-acceptance] WARN health http://127.0.0.1:${port}/health not OK (use --skip-health)`);
      if (runE2e) {
        console.error('[phase5-acceptance] FAIL e2e requires healthy test server');
        process.exit(1);
      }
    } else {
      console.log(`[phase5-acceptance] PASS health :${port}`);
    }
  }

  if (!fs.existsSync(path.join(electronNodeRoot, seedRel))) {
    console.error(`[phase5-acceptance] missing seed: ${seedRel}`);
    process.exit(1);
  }

  run('validate', process.execPath, [
    path.join(__dirname, 'validate-lexicon-seed.mjs'),
    '--input',
    seedRel,
    '--strict',
  ]);
  run('build', process.execPath, [path.join(__dirname, 'build-for-electron.mjs'), '--input', seedRel]);

  const gateScript =
    ladder === '5k'
      ? path.join(__dirname, 'check-phase5-manifest-gate.mjs')
      : path.join(__dirname, 'run-10k-pilot-acceptance.mjs');
  if (ladder === '5k' && fs.existsSync(gateScript)) {
    run('gate', process.execPath, [gateScript, '--ladder', ladder]);
  } else if (ladder === '2k') {
    run('gate-2k', process.execPath, [path.join(__dirname, 'run-10k-pilot-acceptance.mjs')]);
  }

  run('benchmark', process.execPath, [
    path.join(__dirname, 'run-phase5-benchmark-suite.mjs'),
    '--ladder',
    ladder,
  ]);

  if (runE2e) {
    run('dialog200', process.execPath, [path.join(electronNodeRoot, 'tests/run-dialog-200-batch.js')]);
    run('benchmark-post-e2e', process.execPath, [
      path.join(__dirname, 'run-phase5-benchmark-suite.mjs'),
      '--ladder',
      ladder,
    ]);
  }

  console.log(JSON.stringify({ ok: true, ladder, seed: seedRel }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
