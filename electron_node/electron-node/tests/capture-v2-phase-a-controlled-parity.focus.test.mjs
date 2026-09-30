#!/usr/bin/env node
/**
 * Focused proofs T1–T14 (harness-control layer).
 * Live T1/T7–T11/T13–T14 also asserted during Phase A execution.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  deepCloneJson,
  hashControlledPostAsrState,
  extractAuthoritativePostAsrPin,
  buildMockInjectBody,
  auditCaptureGateOnlyConfig,
  proveControlledInput,
  CONTROLLED_POST_ASR_FIELDS,
} from './lib/capture-v2-phase-a-controlled-parity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');

function samplePin() {
  return {
    rawAsrText: '你好世界',
    segments: [
      {
        text: '你好世界',
        start: 0.1,
        end: 1.2,
        words: [
          { word: '你好', start: 0.1, end: 0.6 },
          { word: '世界', start: 0.6, end: 1.2 },
        ],
      },
    ],
    segmentTimeOffsetsSec: [0],
    asrSegmentNodeBatchIndices: [0],
    segmentCharOffsets: [0],
    acousticToneSlices: [
      {
        start: 0.1,
        end: 0.6,
        tonePosterior: { t1: 0.9, t2: 0.05, t3: 0.03, t4: 0.02, t5: 0 },
      },
    ],
  };
}

console.log('[focus] T2/T3/T4/T5 deep-clone + hash proofs');
{
  const authoritative = samplePin();
  const H0 = hashControlledPostAsrState(authoritative);
  const off = deepCloneJson(authoritative);
  const on = deepCloneJson(authoritative);
  assert.notStrictEqual(off, on, 'T3: OFF/ON must be distinct object graphs');
  assert.notStrictEqual(off, authoritative, 'T3: OFF must not share authoritative');
  assert.notStrictEqual(on, authoritative, 'T3: ON must not share authoritative');
  const proof = proveControlledInput({
    authoritative,
    authoritativeHash: H0,
    offPin: off,
    onPin: on,
    offObj: off,
    onObj: on,
  });
  assert.strictEqual(proof.CONTROLLED_INPUT_VALID, 'PASS', 'T2: equal controlled hashes');
  assert.strictEqual(proof.OFF_INPUT_EQUALS_AUTHORITATIVE, 'YES');
  assert.strictEqual(proof.ON_INPUT_EQUALS_AUTHORITATIVE, 'YES');
  assert.strictEqual(proof.AUTHORITATIVE_MUTATED, 'NO');

  // T4: mutate OFF clone must not mutate ON or authoritative
  off.rawAsrText = 'MUTATED';
  off.segments[0].start = 99;
  assert.strictEqual(on.rawAsrText, '你好世界', 'T4: ON unaffected by OFF mutation');
  assert.strictEqual(authoritative.rawAsrText, '你好世界', 'T4/T5: authoritative unaffected');
  assert.strictEqual(hashControlledPostAsrState(authoritative), H0, 'T5: authoritative hash stable');
}

console.log('[focus] T6 Capture gate only config');
{
  const audit = auditCaptureGateOnlyConfig(false, true);
  assert.strictEqual(audit.CAPTURE_GATE_ONLY, 'YES');
  assert.deepStrictEqual(audit.DIFF, ['FROZEN_EVIDENCE_CAPTURE_V2']);
  assert.strictEqual(audit.OFF_CONFIG.FROZEN_EVIDENCE_CAPTURE_V2, '0');
  assert.strictEqual(audit.ON_CONFIG.FROZEN_EVIDENCE_CAPTURE_V2, '1');
}

console.log('[focus] T12 no V1/old V2/Replay evidence load in helper');
{
  const helperSrc = fs.readFileSync(
    path.join(__dirname, 'lib', 'capture-v2-phase-a-controlled-parity.mjs'),
    'utf8'
  );
  assert.ok(!helperSrc.includes('FROZEN_EVIDENCE_CAPTURE_V1'), 'no V1 schema load');
  assert.ok(!/readFileSync\([^)]*CAPTURE_V2\.jsonl/.test(helperSrc), 'no V2 jsonl load');
  assert.ok(!helperSrc.includes('fresh_dialog200_raw_cases'), 'no historical ASR dump');
  const harnessSrc = fs.readFileSync(
    path.join(__dirname, 'run-dialog200-frozen-evidence-capture-v2.mjs'),
    'utf8'
  );
  // Phase A path must not load Replay corpus for pins
  assert.ok(
    harnessSrc.includes('CONTROLLED_POST_ASR_PIN_FORK') ||
      harnessSrc.includes('CONTROLLED LIVE post-ASR pin'),
    'controlled Phase A present'
  );
  assert.ok(
    !/extractAuthoritativePostAsrPin[\s\S]{0,200}readFileSync/.test(harnessSrc),
    'pin extract not from disk corpus'
  );
}

console.log('[focus] pin extract + anti-cheat downstream fields');
{
  const pin = samplePin();
  const data = { extra: { test_only_post_asr_pin: pin } };
  const ok = extractAuthoritativePostAsrPin(data, { caseId: 'd002' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.sliceCount, 1);
  assert.ok(CONTROLLED_POST_ASR_FIELDS.includes('acousticToneSlices'));

  const bad = extractAuthoritativePostAsrPin(
    { extra: { test_only_post_asr_pin: { ...pin, model2: { x: 1 } } } },
    { caseId: 'x' }
  );
  assert.strictEqual(bad.ok, false);
  assert.ok(String(bad.reason).includes('DOWNSTREAM'));
}

console.log('[focus] mock inject body uses live pin fields only');
{
  const { body, pinClone } = buildMockInjectBody(samplePin(), {
    sessionId: 'capture-v2-phase-a::d002::OFF::1',
    caseId: 'd002',
    arm: 'OFF',
  });
  assert.strictEqual(body.asrText, '你好世界');
  assert.ok(Array.isArray(body.acousticToneSlices));
  assert.ok(Array.isArray(body.segmentTimeOffsetsSec));
  assert.strictEqual(body.capture_v2_phase_a_controlled, true);
  assert.ok(!('model3' in body));
  assert.notStrictEqual(pinClone, body.segments);
}

console.log('[focus] T13/T14 source gates: pin export + Capture default OFF');
{
  const rb = fs.readFileSync(
    path.join(REPO, 'electron_node/electron-node/main/src/pipeline/result-builder-core.ts'),
    'utf8'
  );
  assert.ok(rb.includes("LINGUA_TEST_EXPORT_POST_ASR_PIN === '1'"), 'T13 pin export gated');
  assert.ok(rb.includes('test_only_post_asr_pin'), 'TEST_ONLY field name');
  const gate = fs.readFileSync(
    path.join(REPO, 'electron_node/electron-node/main/src/capture-v2/gate.ts'),
    'utf8'
  );
  assert.ok(
    /FROZEN_EVIDENCE_CAPTURE_V2/.test(gate),
    'T14 Capture gate still env-driven'
  );
}

console.log('[focus] ALL focused harness-control proofs PASS');
