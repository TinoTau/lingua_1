#!/usr/bin/env node
/**
 * Replay V2 focused unit tests (T1–T28 harness layer).
 * Live Production recompute proofs also asserted during capability probe.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ACCEPTED_CANDIDATE_JSONL,
  ACCEPTED_CANDIDATE_RUN_ID,
  ACCEPTED_CANDIDATE_SHA256,
  FLOAT_TIME_ABS_TOLERANCE_SEC,
  KENLM_SCORE_ABS_TOLERANCE,
  FORBIDDEN_INJECTION_KEYS,
  loadAcceptedCandidate,
  loadIdentityManifest,
  validateInjectionState,
  buildReplayInjectBody,
  assertInjectionAllowlist,
  compareBoundary,
  compareCaptureReplayV2,
  semanticEqual,
  sha256File,
  CAPABILITY_PROBE_CASES,
} from './lib/dialog200-frozen-evidence-replay-v2-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
let passed = 0;
function t(name, fn) {
  fn();
  passed += 1;
  console.log(`[ok] ${name}`);
}

console.log('[replay-v2-focus] start');

t('T1 correct Candidate SHA/run accepted', () => {
  const loaded = loadAcceptedCandidate();
  assert.strictEqual(loaded.ok, true, loaded.reason);
  assert.strictEqual(loaded.run_id, ACCEPTED_CANDIDATE_RUN_ID);
  assert.strictEqual(loaded.sha256.toLowerCase(), ACCEPTED_CANDIDATE_SHA256.toLowerCase());
});

t('T2 wrong Candidate SHA rejected', () => {
  const bad = loadAcceptedCandidate({ expectedSha: '0'.repeat(64) });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.reason, 'CANDIDATE_SHA_MISMATCH');
});

t('T3 wrong run_id rejected', () => {
  const bad = loadAcceptedCandidate({ expectedRunId: 'dialog200_capture_v2_WRONG' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.reason === 'CANDIDATE_RUN_ID_MISMATCH' || bad.reason === 'CANDIDATE_SHA_MISMATCH');
});

t('T4 200 unique Candidate records load', () => {
  const loaded = loadAcceptedCandidate();
  assert.strictEqual(loaded.count, 200);
  assert.strictEqual(loaded.byId.size, 200);
});

const loaded = loadAcceptedCandidate();
assert.ok(loaded.ok);
const sample = loaded.byId.get('d002');
assert.ok(sample);

t('T5 I1–I9 validation', () => {
  const v = validateInjectionState(sample);
  assert.strictEqual(v.ok, true, JSON.stringify(v.issues));
});

t('T6 missing mandatory injection state rejected', () => {
  const bad = JSON.parse(JSON.stringify(sample));
  delete bad.capture_artifact.boundaries.B4.payload.acousticToneSlices;
  const v = validateInjectionState(bad);
  assert.strictEqual(v.ok, false);
  assert.ok(v.issues.some((i) => i.includes('I4')));
});

t('T7 injection allowlist rejects downstream fields', () => {
  const built = buildReplayInjectBody(sample);
  assert.strictEqual(built.ok, true);
  const polluted = { ...built.body, model2: { x: 1 } };
  const a = assertInjectionAllowlist(polluted);
  assert.strictEqual(a.ok, false);
  for (const k of FORBIDDEN_INJECTION_KEYS.slice(0, 5)) {
    assert.ok(!Object.prototype.hasOwnProperty.call(built.body, k));
  }
  assert.strictEqual(built.injection_meta.reference_text_used, false);
  assert.strictEqual(built.injection_meta.alignment_reconstructed, false);
});

t('T8 no V1 fallback path in V2 contract', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'lib', 'dialog200-frozen-evidence-replay-v2-contract.mjs'),
    'utf8'
  );
  assert.ok(!src.includes('DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1'));
  assert.ok(!src.includes('frozen-replay-alignment-state'));
  assert.ok(!src.includes('decidePromotion'));
  const runner = fs.readFileSync(
    path.join(__dirname, 'run-dialog200-frozen-evidence-replay-v2.mjs'),
    'utf8'
  );
  assert.ok(!runner.includes('DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1'));
  assert.ok(!runner.includes('run-dialog200-frozen-evidence-replay-v1'));
});

t('T19 time tolerance semantics', () => {
  assert.strictEqual(FLOAT_TIME_ABS_TOLERANCE_SEC, 0.001);
  const eq = semanticEqual({ start: 1.0 }, { start: 1.0005 }, 'x');
  assert.strictEqual(eq.equal, true);
  const ne = semanticEqual({ start: 1.0 }, { start: 1.01 }, 'x');
  assert.strictEqual(ne.equal, false);
});

t('T20 KenLM tolerance semantics', () => {
  assert.strictEqual(KENLM_SCORE_ABS_TOLERANCE, 1e-6);
  const eq = semanticEqual({ score: 1.0 }, { score: 1.0 + 5e-7 }, 'x');
  assert.strictEqual(eq.equal, true);
});

t('T21 NOT_EVALUABLE for raw posteriors', () => {
  const eq = semanticEqual(
    { tonePosterior: { t1: 0.9 } },
    { tonePosterior: { t1: 0.1 } },
    'B4'
  );
  assert.strictEqual(eq.equal, true);
  assert.ok(eq.hints.some((h) => h.includes('NOT_EVALUABLE')));
});

t('T22 B9 SET/MULTISET semantics', () => {
  const r = compareBoundary(
    'B9',
    {
      unique_identity_set: ['a', 'b'],
      multiset_multiplicities: { a: 2, b: 1 },
    },
    {
      unique_identity_set: ['b', 'a'],
      multiset_multiplicities: { a: 1, b: 1 },
    }
  );
  assert.strictEqual(r.status, 'PASS');
  assert.strictEqual(r.multiset_equal, false);
});

t('T23 B14 ordered retained path semantics', () => {
  const pass = compareBoundary(
    'B14',
    { retained_path_ids: ['p1', 'p2'], boundary_keys: ['k1', 'k2'], pathCapEvents: [] },
    { retained_path_ids: ['p1', 'p2'], boundary_keys: ['k1', 'k2'], pathCapEvents: [] }
  );
  assert.strictEqual(pass.status, 'PASS');
  const fail = compareBoundary(
    'B14',
    { retained_path_ids: ['p1', 'p2'], boundary_keys: ['k1', 'k2'], pathCapEvents: [] },
    { retained_path_ids: ['p2', 'p1'], boundary_keys: ['k2', 'k1'], pathCapEvents: [] }
  );
  assert.strictEqual(fail.status, 'FAIL');
});

t('T24/T25 first-divergence selection', () => {
  const cap = sample.capture_artifact;
  const rep = JSON.parse(JSON.stringify(cap));
  // Force B5 fail, B18 fail — first must be B5
  if (rep.boundaries.B5?.payload) {
    rep.boundaries.B5.payload = { ...(rep.boundaries.B5.payload || {}), __force: 'diff' };
  } else {
    rep.boundaries.B5 = { payload: { forced: true } };
  }
  if (rep.boundaries.B18?.payload) {
    rep.boundaries.B18.payload.finalPostprocessText = 'DIFFERENT';
    rep.boundaries.B18.payload.finalHash = 'x';
  }
  const cmp = compareCaptureReplayV2(sample, rep);
  assert.ok(cmp.first_divergence);
  assert.strictEqual(cmp.first_divergence.FIRST_DIVERGENCE_BOUNDARY, 'B5');
  assert.strictEqual(cmp.first_divergence.DOWNSTREAM_NOT_INTERPRETED_AS_ROOT_CAUSE, 'YES');
  assert.ok(cmp.downstream_diagnostic_diffs.includes('B18'));
});

t('T26 reference text cannot affect inject body', () => {
  const built = buildReplayInjectBody(sample);
  assert.ok(!('reference_corpus_identity_only' in built.body));
  assert.ok(!('expectedText' in built.body));
  assert.strictEqual(built.injection_meta.reference_text_used, false);
});

t('T27 Candidate artifact remains unchanged (sha check)', () => {
  const a = sha256File(ACCEPTED_CANDIDATE_JSONL);
  const b = sha256File(ACCEPTED_CANDIDATE_JSONL);
  assert.strictEqual(a, b);
  assert.strictEqual(a.toLowerCase(), ACCEPTED_CANDIDATE_SHA256.toLowerCase());
});

t('T28 Production algorithm source unchanged (no FW rewrite in V2)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'lib', 'dialog200-frozen-evidence-replay-v2-contract.mjs'),
    'utf8'
  );
  assert.ok(!src.includes('function buildWordTimeSpans'));
  assert.ok(!src.includes('function mapToneEvidenceForRecall'));
  assert.ok(!src.includes('enumerateCompleteSegmentationPaths'));
  const id = loadIdentityManifest();
  assert.strictEqual(id.ok, true);
});

t('capability probe case set present in Candidate', () => {
  for (const id of CAPABILITY_PROBE_CASES) {
    assert.ok(loaded.byId.has(id), `missing ${id}`);
    assert.strictEqual(validateInjectionState(loaded.byId.get(id)).ok, true);
  }
});

// T9–T18 are live Production proofs — marked as deferred to capability probe execution.
console.log('[replay-v2-focus] T9–T18 deferred to live capability probe (Production recompute)');
console.log(`[replay-v2-focus] ALL static tests PASS count=${passed}`);
globalThis.__REPLAY_V2_UNIT_TESTS = { total: passed + 10, passed, deferred_live: 10 };
