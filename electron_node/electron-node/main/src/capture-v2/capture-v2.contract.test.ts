/**
 * Capture V2 contract tests T1–T40 (observability only).
 */
import {
  FROZEN_EVIDENCE_CAPTURE_V2_ENV,
  isFrozenEvidenceCaptureV2Enabled,
  FLOAT_TIME_ABS_TOLERANCE_SEC,
  KENLM_SCORE_ABS_TOLERANCE,
  floatTimeEqual,
  kenlmScoreEqual,
  snapshotCopy,
  canonicalizeUnorderedIdentities,
  canonicalHash,
  beginCaptureV2Case,
  runWithCaptureV2Case,
  captureV2Boundary,
  markCaptureV2Incomplete,
  finalizeCaptureV2Case,
  __debugCaptureV2Store,
  validateCaptureV2Completeness,
  CAPTURE_V2_MANDATORY_BOUNDARIES,
  listMandatoryBoundaries,
} from './index';

const ORIG = process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];

afterEach(() => {
  if (ORIG === undefined) delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
  else process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = ORIG;
});

describe('Capture V2 gate', () => {
  it('T1 gate default OFF', () => {
    delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
    expect(isFrozenEvidenceCaptureV2Enabled()).toBe(false);
  });
  it('T2 gate explicit ON', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    expect(isFrozenEvidenceCaptureV2Enabled()).toBe(true);
  });
});

describe('Capture V2 collector', () => {
  it('T4 collector no-op OFF', () => {
    delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
    beginCaptureV2Case('x');
    captureV2Boundary('B18', { finalPostprocessText: 'a', finalHash: 'b' });
    expect(finalizeCaptureV2Case()).toBeNull();
    expect(__debugCaptureV2Store()).toBeNull();
  });

  it('T3/T37 collector case isolation', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    runWithCaptureV2Case('c1', () => {
      captureV2Boundary('B18', { finalPostprocessText: 'one', finalHash: 'h1' });
      expect((__debugCaptureV2Store()?.boundaries.B18?.payload as { finalPostprocessText: string }).finalPostprocessText).toBe('one');
    });
    runWithCaptureV2Case('c2', () => {
      expect(__debugCaptureV2Store()?.boundaries.B18).toBeUndefined();
      captureV2Boundary('B18', { finalPostprocessText: 'two', finalHash: 'h2' });
      expect((__debugCaptureV2Store()?.boundaries.B18?.payload as { finalPostprocessText: string }).finalPostprocessText).toBe('two');
    });
  });
});

describe('Capture V2 serializer', () => {
  it('T5 deterministic hash', () => {
    const a = canonicalHash({ z: 1, a: [2, 3] });
    const b = canonicalHash({ a: [2, 3], z: 1 });
    expect(a).toBe(b);
  });

  it('T6 does not mutate arrays', () => {
    const arr = [1, { x: 2 }];
    const copy = snapshotCopy(arr) as unknown[];
    (copy[1] as { x: number }).x = 99;
    expect((arr[1] as { x: number }).x).toBe(2);
  });

  it('T7 does not mutate Map', () => {
    const m = new Map([['a', 1]]);
    snapshotCopy(m);
    expect(m.get('a')).toBe(1);
    expect(m.size).toBe(1);
  });

  it('T8 does not mutate Set', () => {
    const s = new Set([1, 2]);
    snapshotCopy(s);
    expect(s.has(1)).toBe(true);
    expect(s.size).toBe(2);
  });

  it('T9 unordered set canonicalization stable', () => {
    const a = canonicalizeUnorderedIdentities([{ id: 'b' }, { id: 'a' }], (x) =>
      String((x as { id: string }).id)
    );
    const b = canonicalizeUnorderedIdentities([{ id: 'a' }, { id: 'b' }], (x) =>
      String((x as { id: string }).id)
    );
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('T10 ordered list order preserved', () => {
    const copy = snapshotCopy(['z', 'a']) as string[];
    expect(copy).toEqual(['z', 'a']);
  });
});

describe('Capture V2 float policy', () => {
  it('T11 FLOAT_TIME = 0.001', () => {
    expect(FLOAT_TIME_ABS_TOLERANCE_SEC).toBe(0.001);
    expect(floatTimeEqual(1.0, 1.0005)).toBe(true);
    expect(floatTimeEqual(1.0, 1.002)).toBe(false);
  });
  it('T12 KenLM tolerance = 1e-6', () => {
    expect(KENLM_SCORE_ABS_TOLERANCE).toBe(1e-6);
    expect(kenlmScoreEqual(1, 1 + 5e-7)).toBe(true);
    expect(kenlmScoreEqual(1, 1 + 2e-6)).toBe(false);
  });
});

describe('Capture V2 boundaries structural', () => {
  function b4Injection(opts?: {
    slices?: Array<{ start: number; end: number; confidence: number; tonePosterior: Record<string, number> }>;
    windows?: unknown[];
    status?: string;
  }) {
    const slices = opts?.slices;
    const hasSlices = Array.isArray(slices) ? slices.length > 0 : false;
    return {
      acousticToneSlices: slices ?? [],
      slice_role: 'INJECTION_STATE' as const,
      tone_execution_status:
        opts?.status ??
        (hasSlices ? 'TONE_EXECUTED_AND_SLICES_CAPTURED' : 'TONE_LEGITIMATELY_NOT_APPLICABLE'),
      slice_count: (slices ?? []).length,
      windows: opts?.windows ?? [],
      authoritative_truncated: false,
    };
  }

  function fillMinimalComplete() {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('t');
    captureV2Boundary('B1', {
      rawAsrText: '請',
      repairText: '请',
      scriptNormalized: true,
      segments: [{ words: [{ word: '請', start: 0, end: 0.1 }] }],
    });
    captureV2Boundary('B2', {
      segmentTimeOffsetsSec: [0],
      asrSegmentNodeBatchIndices: [0],
      segmentCharOffsets: [0],
    });
    captureV2Boundary('B3', { spans: [], count: 0, canonicalHash: canonicalHash([]) });
    captureV2Boundary('B4', b4Injection());
    captureV2Boundary('B5', { field_name: 'finespans', paths: [] });
    captureV2Boundary('B6', {
      globalWindowGeneratedCount: 0,
      logicalWindowRecallCount: 0,
      blockedWindowCount: 0,
      logicalRecallWindows: [],
    });
    captureV2Boundary('B7', { queries: [] });
    captureV2Boundary('B8', { executions: [] });
    captureV2Boundary('B9', { occurrence_list: [], unique_identity_set: [] });
    captureV2Boundary('B10', { inputHash: 'x', windows: [] });
    captureV2Boundary('B11', { selected_actions: [], after_model2_candidate_set: [] });
    captureV2Boundary('B12', { edges: [] });
    captureV2Boundary('B13', {
      completePathCountBeforePrune: 0,
      sortedPathIdentityHash: 'h',
    });
    captureV2Boundary('B14', { retained_path_ids: [] });
    captureV2Boundary('B15', { paths: [] });
    captureV2Boundary('B16', { pool: [] });
    captureV2Boundary('B17', { by_path: {} });
    captureV2Boundary('B18', { finalPostprocessText: 'ok', finalHash: 'h' });
  }

  it('T13–T30 minimal payloads finalize COMPLETE', () => {
    fillMinimalComplete();
    const art = finalizeCaptureV2Case();
    expect(art).not.toBeNull();
    expect(art!.completeness).toBe('COMPLETE');
    expect(listMandatoryBoundaries().length).toBe(18);
    expect(CAPTURE_V2_MANDATORY_BOUNDARIES).toContain('B5');
  });

  it('T17 B5 requires finespans field_name', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('t');
    captureV2Boundary('B5', { field_name: 'fine_spans', paths: [] });
    const v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.status).toBe('CAPTURE_INCOMPLETE');
    expect(v.details.some((d) => d.includes('finespans'))).toBe(true);
  });

  it('T31 missing mandatory → CAPTURE_INCOMPLETE', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('t');
    markCaptureV2Incomplete('test_missing', 'B3');
    const art = finalizeCaptureV2Case();
    expect(art!.completeness).toBe('CAPTURE_INCOMPLETE');
  });

  it('T32 truncation marker fails completeness', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('t');
    captureV2Boundary('B9', {
      occurrence_list: [],
      unique_identity_set: [],
      authoritative_truncated: true,
    });
    const v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.details.some((d) => d.includes('authoritative_truncation'))).toBe(true);
  });

  it('Tone T1 gate OFF → no slice capture', () => {
    delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
    beginCaptureV2Case('off');
    captureV2Boundary('B4', b4Injection({
      slices: [{ start: 0, end: 0.1, confidence: 1, tonePosterior: { t1: 1, t2: 0, t3: 0, t4: 0, t5: 0 } }],
    }));
    expect(finalizeCaptureV2Case()).toBeNull();
  });

  it('Tone T2/T12 gate ON captures slices + B4 merge preserves INJECTION_STATE', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('on');
    const slice = {
      start: 0.1,
      end: 0.2,
      confidence: 0.9,
      tonePosterior: { t1: 0.9, t2: 0.1, t3: 0, t4: 0, t5: 0 },
    };
    captureV2Boundary('B4', b4Injection({ slices: [slice] }));
    captureV2Boundary('B4', {
      windows: [{ windowId: 'w1', toneNorm: '1', acousticTonePattern: [1] }],
      slice_role: 'INJECTION_STATE',
      tone_execution_status: 'TONE_EXECUTED_AND_SLICES_CAPTURED',
    });
    const p = __debugCaptureV2Store()!.boundaries.B4!.payload as Record<string, unknown>;
    expect(p.slice_role).toBe('INJECTION_STATE');
    expect(Array.isArray(p.acousticToneSlices) && (p.acousticToneSlices as unknown[]).length).toBe(1);
    expect(Array.isArray(p.windows) && (p.windows as unknown[]).length).toBe(1);
  });

  it('Tone T3–T5 immutable snapshot isolation', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('immut');
    const prod = {
      start: 0,
      end: 0.1,
      confidence: 1,
      tonePosterior: { t1: 1, t2: 0, t3: 0, t4: 0, t5: 0 },
    };
    captureV2Boundary('B4', b4Injection({ slices: [prod] }));
    prod.tonePosterior.t1 = 0;
    prod.start = 99;
    const captured = (
      __debugCaptureV2Store()!.boundaries.B4!.payload as {
        acousticToneSlices: Array<{ start: number; tonePosterior: { t1: number } }>;
      }
    ).acousticToneSlices[0];
    expect(captured.start).toBe(0);
    expect(captured.tonePosterior.t1).toBe(1);
    captured.tonePosterior.t1 = 0.5;
    const again = (
      __debugCaptureV2Store()!.boundaries.B4!.payload as {
        acousticToneSlices: Array<{ tonePosterior: { t1: number } }>;
      }
    ).acousticToneSlices[0];
    // store holds previous snapshot object — re-read same reference; verify Production unaffected
    expect(prod.tonePosterior.t1).toBe(0);
    expect(again.tonePosterior.t1).toBe(0.5);
  });

  it('Tone T13/T14 missing/empty required slices → CAPTURE_INCOMPLETE', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('miss');
    captureV2Boundary('B4', {
      windows: [{ windowId: 'w', acousticTonePattern: [1], toneNorm: '1' }],
    });
    let v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.status).toBe('CAPTURE_INCOMPLETE');
    expect(v.details.some((d) => d.includes('TONE_REQUIRED_BUT_SLICES_MISSING'))).toBe(true);

    beginCaptureV2Case('empty_pass');
    captureV2Boundary('B4', {
      acousticToneSlices: [],
      windows: [],
      // no explicit status → incomplete
    });
    v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.status).toBe('CAPTURE_INCOMPLETE');
    expect(v.details.some((d) => d.includes('empty_slices_without_explicit_tone_status'))).toBe(true);
  });

  it('Tone T15 legitimate no-Tone classified COMPLETE', () => {
    fillMinimalComplete();
    const v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.status).toBe('COMPLETE');
    const b4 = __debugCaptureV2Store()!.boundaries.B4!.payload as Record<string, unknown>;
    expect(b4.tone_execution_status).toBe('TONE_LEGITIMATELY_NOT_APPLICABLE');
    expect(Array.isArray(b4.acousticToneSlices) && (b4.acousticToneSlices as unknown[]).length).toBe(0);
  });

  it('Tone T24 schema declares slice_role INJECTION_STATE', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('role');
    captureV2Boundary('B4', {
      ...b4Injection(),
      slice_role: 'COMPARISON_ONLY',
    });
    const v = validateCaptureV2Completeness({
      boundaries: __debugCaptureV2Store()!.boundaries,
      incomplete_marks: [],
    });
    expect(v.details.some((d) => d.includes('slice_role_must_be_INJECTION_STATE'))).toBe(true);
  });
});

describe('Capture V2 parity / identity stubs', () => {
  function b4InjectionEmpty() {
    return {
      acousticToneSlices: [],
      slice_role: 'INJECTION_STATE' as const,
      tone_execution_status: 'TONE_LEGITIMATELY_NOT_APPLICABLE',
      slice_count: 0,
      windows: [],
      authoritative_truncated: false,
    };
  }

  it('T33/T34 JobResult core not required for collector', () => {
    // Collector is side-channel; Production decisions must not read it.
    expect(typeof captureV2Boundary).toBe('function');
    delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
    expect(isFrozenEvidenceCaptureV2Enabled()).toBe(false);
  });

  it('T35/T36 OFF means no capture artifact', () => {
    delete process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV];
    beginCaptureV2Case('p');
    captureV2Boundary('B18', { finalPostprocessText: 'x', finalHash: 'y' });
    expect(finalizeCaptureV2Case()).toBeNull();
  });

  it('T38 NO_PROFILE: B10 allows null windows without fake P/D', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    beginCaptureV2Case('np');
    captureV2Boundary('B10', {
      windows: null,
      inputHash: canonicalHash(null),
      model2_summary: { invoked: false, note: 'NO_PROFILE_or_unavailable' },
    });
    expect(__debugCaptureV2Store()?.boundaries.B10).toBeDefined();
  });

  it('T39 identity guards via captureV2Identity', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    runWithCaptureV2Case('id', () => {
      const { captureV2Identity } = require('./index') as typeof import('./index');
      captureV2Identity({ lexicon_sha: 'abc', schema_version: '2.0.0' });
      expect(__debugCaptureV2Store()?.identity.lexicon_sha).toBe('abc');
    });
  });

  it('T40 small development probe — 5 synthetic scenarios COMPLETE (NOT official Capture)', () => {
    process.env[FROZEN_EVIDENCE_CAPTURE_V2_ENV] = '1';
    const scenarios = ['single_batch', 'multi_batch', 'script_norm', 'multipath', 'kenlm_model3'];
    for (const id of scenarios) {
      beginCaptureV2Case(`probe_${id}`);
      // reuse fill via quick inline
      captureV2Boundary('B1', {
        rawAsrText: id === 'script_norm' ? '請問' : '你好',
        repairText: id === 'script_norm' ? '请问' : '你好',
        scriptNormalized: id === 'script_norm',
        segments: [],
      });
      captureV2Boundary('B2', {
        segmentTimeOffsetsSec: id === 'multi_batch' ? [0, 1.2] : [0],
        asrSegmentNodeBatchIndices: id === 'multi_batch' ? [0, 1] : [0],
        segmentCharOffsets: id === 'multi_batch' ? [0, 6] : [0],
      });
      captureV2Boundary('B3', { spans: [], count: 0, canonicalHash: canonicalHash([]) });
      captureV2Boundary('B4', b4InjectionEmpty());
      captureV2Boundary('B5', { field_name: 'finespans', paths: [] });
      captureV2Boundary('B6', {
        globalWindowGeneratedCount: 0,
        logicalWindowRecallCount: 0,
        blockedWindowCount: 0,
        logicalRecallWindows: [],
      });
      captureV2Boundary('B7', { queries: [] });
      captureV2Boundary('B8', { executions: [] });
      captureV2Boundary('B9', { occurrence_list: [], unique_identity_set: [] });
      captureV2Boundary('B10', { inputHash: 'x', windows: [] });
      captureV2Boundary('B11', { selected_actions: [], after_model2_candidate_set: [] });
      captureV2Boundary('B12', { edges: [] });
      captureV2Boundary('B13', {
        completePathCountBeforePrune: 0,
        sortedPathIdentityHash: 'h',
      });
      captureV2Boundary('B14', { retained_path_ids: [] });
      captureV2Boundary('B15', { paths: [] });
      captureV2Boundary('B16', { pool: [] });
      captureV2Boundary('B17', { by_path: {} });
      captureV2Boundary('B18', { finalPostprocessText: id, finalHash: canonicalHash(id) });
      const art = finalizeCaptureV2Case();
      expect(art!.completeness).toBe('COMPLETE');
      expect(art!.boundaries.B5!.payload).toMatchObject({ field_name: 'finespans' });
      expect(art!.boundaries.B4!.payload).toMatchObject({ slice_role: 'INJECTION_STATE' });
    }
  });
});
