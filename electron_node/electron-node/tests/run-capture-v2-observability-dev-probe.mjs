/**
 * DEVELOPMENT_PROBE runner — NOT CANDIDATE_CAPTURE_V2.
 * Delegates to Capture V2 contract jest suite (includes T40 5-scenario probe).
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const r = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['jest', '--testPathPattern=capture-v2.contract', '--no-coverage'],
  { cwd: root, encoding: 'utf8', shell: true }
);
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
if (r.status !== 0) process.exit(r.status || 1);
console.log(
  JSON.stringify({
    probe_kind: 'DEVELOPMENT_PROBE',
    NOT_CANDIDATE_CAPTURE_V2: true,
    OFFICIAL_DIALOG200_CAPTURE_V2_EXECUTED: false,
    jest_status: 0,
    note: 'Synthetic 5-scenario instrumentation probe via jest T40; no Dialog200 baseline artifact written.',
  })
);
