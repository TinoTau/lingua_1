#!/usr/bin/env node
/**
 * Standalone validator for DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1 artifacts.
 * Delegates to capture runner --validate-only.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, 'run-dialog200-frozen-acoustic-evidence-capture-v1.mjs');
const r = spawnSync(process.execPath, [runner, '--validate-only', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});
process.exit(r.status ?? 1);
