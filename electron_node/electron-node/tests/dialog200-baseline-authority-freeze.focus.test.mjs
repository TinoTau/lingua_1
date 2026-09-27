#!/usr/bin/env node
/**
 * Engine Stable V1 — baseline authority fail-closed checks.
 * No Production. No V1 fallback.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertNotRetiredBaseline,
  resolveDialog200BaselineSsot,
} from './lib/dialog200-baseline-ssot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const V2 = path.join(REPO, 'docs/user_correction/model3/DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl');
const EXPECTED_SHA = 'ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a';
const EXPECTED_RUN = 'dialog200_capture_v2_20260925100532';

function expectThrow(fn, label) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    assert.ok(String(e.message || e).length > 0, label);
  }
  assert.strictEqual(threw, true, label);
}

const live = resolveDialog200BaselineSsot();
assert.strictEqual(live.status, 'AUTHORITATIVE');
assert.strictEqual(live.runId, EXPECTED_RUN);
assert.strictEqual(live.caseCount, 200);
assert.strictEqual(live.evidenceSha256.toLowerCase(), EXPECTED_SHA);
assert.ok(live.evidencePath.replace(/\\/g, '/').endsWith('DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl'));
assert.strictEqual(live.manifest.current_baseline_replaced, true);
assert.strictEqual(live.manifest.v1_authority_retired, true);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-baseline-'));
const v2rel = 'docs/user_correction/model3/DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl';

function writeSsot(name, patch) {
  const p = path.join(tmp, name);
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        authority: 'DIALOG200_BASELINE_SSOT',
        evidence_artifact: v2rel,
        provenance_artifact: 'docs/user_correction/model3/LINGUA_DIALOG200_CAPTURE_V2_IDENTITY_MANIFEST.json',
        case_count: 200,
        run_id: EXPECTED_RUN,
        evidence_sha256: EXPECTED_SHA,
        status: 'AUTHORITATIVE',
        ...patch,
      },
      null,
      2
    )
  );
  return p;
}

expectThrow(
  () => resolveDialog200BaselineSsot(writeSsot('bad-sha.json', { evidence_sha256: '0'.repeat(64) })),
  'wrong SHA fail closed'
);
expectThrow(
  () =>
    resolveDialog200BaselineSsot(
      writeSsot('missing.json', { evidence_artifact: 'docs/user_correction/model3/DOES_NOT_EXIST.jsonl' })
    ),
  'missing artifact fail closed'
);
expectThrow(
  () => resolveDialog200BaselineSsot(writeSsot('status.json', { status: 'HISTORICAL_ONLY' })),
  'non-authoritative status fail closed'
);
expectThrow(
  () =>
    resolveDialog200BaselineSsot(
      writeSsot('v1.json', {
        evidence_artifact: 'docs/user_correction/model3/DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl',
        evidence_sha256: 'ae8d6f71ba69fbf13b5f6f8cac36459678932837732ad7747cff6517f7387f93',
      })
    ),
  'V1 cannot be selected'
);
expectThrow(
  () => assertNotRetiredBaseline('DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl'),
  'V1 basename refused'
);

const replayV1 = fs.readFileSync(
  path.join(REPO, 'electron_node/electron-node/tests/run-dialog200-frozen-evidence-replay-v1.mjs'),
  'utf8'
);
assert.ok(replayV1.includes('V1_AUTHORITY_RETIRED'));
assert.ok(!replayV1.includes('fs.writeFileSync(SSOT_OUT'));
const captureV1 = fs.readFileSync(
  path.join(REPO, 'electron_node/electron-node/tests/run-dialog200-frozen-acoustic-evidence-capture-v1.mjs'),
  'utf8'
);
assert.ok(captureV1.includes('NO_PROMOTION'));
assert.ok(!captureV1.includes('DIALOG200_BASELINE_SSOT.json') || captureV1.includes('must not'));

console.log('baseline authority freeze acceptance PASS');
