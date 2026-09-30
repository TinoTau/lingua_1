#!/usr/bin/env node
/**
 * MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT — causal A/B wrapper.
 *
 * @deprecated Superseded by run-dialog200-acceptance-harness-correction.mjs
 * (MODEL3_ACCEPTANCE_CAUSAL_FORK=1). The two-run KEEP_ALL design is invalid
 * for causal parity — see Lingua_Model3_V2_Acceptance_Harness_Correction_Report_2026_08_31.md
 *
 * BASELINE: S3 identity loaded + MODEL3_HARNESS_KEEP_ALL=1 (actionable RETRY off)
 * S3:       S3 identity loaded + actionable RETRY on
 *
 * Does not promote production default. Does not train / retune.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { killPort } from './repro/lib/asr-repro-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const ELECTRON = path.join(REPO, 'electron_node', 'electron-node');
const RUNNER = path.join(__dirname, 'run-dialog200-model3-acceptance.mjs');
const IDENTITY = 'MODEL3_V2_S3_RANDOM_INIT_V1';

function run(label, envExtra, outTag) {
  console.log(`\n========== ${label} out-tag=${outTag} ==========\n`);
  killPort(6007);
  killPort(5020);
  const env = {
    ...process.env,
    PROJECT_ROOT: REPO,
    TONE_P10_VAD_CPU: '1',
    MODEL3_CHECKPOINT_IDENTITY: IDENTITY,
    ...envExtra,
  };
  // Ensure KEEP_ALL is explicitly off for S3 mode
  if (!('MODEL3_HARNESS_KEEP_ALL' in envExtra)) {
    delete env.MODEL3_HARNESS_KEEP_ALL;
  }
  const r = spawnSync(
    process.execPath,
    [RUNNER, '--checkpoint-identity', IDENTITY, '--out-tag', outTag, '--max-minutes', '240'],
    {
      cwd: ELECTRON,
      env,
      stdio: 'inherit',
      shell: false,
    }
  );
  if (r.status !== 0) {
    console.error(`[ab] ${label} failed status=${r.status}`);
    process.exit(r.status || 1);
  }
}

function main() {
  // Rebuild main so registry + harness KEEP_ALL are in dist/
  console.log('[ab] build:main…');
  const b = spawnSync('npm', ['run', 'build:main'], {
    cwd: ELECTRON,
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });
  if (b.status !== 0) {
    console.error('[ab] build:main failed');
    process.exit(1);
  }

  run('BASELINE_KEEP_ALL', { MODEL3_HARNESS_KEEP_ALL: '1' }, 'baseline');
  run('S3_ACTIONABLE', {}, 's3');

  console.log('[ab] analyzing…');
  const py = spawnSync(
    'python',
    [path.join(REPO, 'training/model3_dataset/scripts/analyze_s3_mainline_acceptance.py')],
    { cwd: REPO, env: { ...process.env, PYTHONPATH: REPO }, stdio: 'inherit', shell: false }
  );
  process.exit(py.status || 0);
}

main();
