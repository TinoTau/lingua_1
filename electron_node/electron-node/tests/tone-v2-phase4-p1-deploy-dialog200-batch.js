#!/usr/bin/env node
/**
 * @deprecated Use tone-v2-dialog200-batch.js (SSOT).
 * Thin wrapper preserving Phase 4 p1 deploy default session/output.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'tone-v2-dialog200-batch.js');
const childArgs = [
  script,
  '--session',
  'tone-v2-phase4-p1-d200-v1',
  '--out',
  'experiments/tone-v2-phase4-p1-deploy-dialog200-batch-result.json',
  '--wait-fw',
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, childArgs, { stdio: 'inherit', cwd: __dirname });
process.exit(result.status == null ? 1 : result.status);
