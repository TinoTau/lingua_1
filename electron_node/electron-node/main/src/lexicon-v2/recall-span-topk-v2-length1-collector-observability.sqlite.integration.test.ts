/**
 * Observation-only length-1 collector diagnostics.
 * Asserts trace terminalReason matches frozen collector return. Does not add new accept paths.
 *
 * Run under Electron ABI: ELECTRON_RUN_AS_NODE=1 electron jest --runInBand --forceExit
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as quality from '../asr-repair-quality/quality-config';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import {
  batch10bStandardBaseRows,
  buildSameKeyLength1Rows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';
import { recallTopKForWindows } from '../fw-detector/span-assembly-v4/recall-topk-for-windows';
import type { GlobalWindowDescriptor } from '../fw-detector/span-assembly-v4/v4-types';
import { makeCharToneFixtures } from '../fw-detector/span-assembly-v4/test-tone-fixtures';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

function makeWindow(
  partial: Partial<GlobalWindowDescriptor> &
    Pick<
      GlobalWindowDescriptor,
      'windowId' | 'syllableStart' | 'syllableEnd' | 'rawStart' | 'rawEnd' | 'windowText' | 'windowPinyinKey'
    >
): GlobalWindowDescriptor {
  return {
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
    ...partial,
  };
}

function recall1(
  rt: LexiconRuntimeV2,
  syllables: string[],
  windowText: string,
  tone: number | false = 1
) {
  return recallSpanTopKV2(rt, {
    syllables,
    windowText,
    termLength: 1,
    topK: 1,
    profile: defaultGeneralProfile(),
    domainIds: ['coffee'],
    fuzzyRecallEnabled: true,
    ...(tone === false ? {} : { acousticTonePattern: [tone], toneCallerEnabled: true }),
  });
}

function hitSnap(r: ReturnType<typeof recallSpanTopKV2>) {
  return r.hits.map((h) => ({
    word: h.hotword.word,
    score: h.candidateScore,
    kind: h.recallCandidateKind,
    domains: h.hotword.domains ?? [],
    repairTarget: h.hotword.repairTarget === true,
  }));
}

describe('length-1 collector observability (frozen contract)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
    jest.restoreAllMocks();
  });

  function boot(
    baseRows: ReturnType<typeof batch10bStandardBaseRows> = batch10bStandardBaseRows(),
    prefix = 'obs-l1-'
  ): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({ baseRows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('surface exact single char (他 among 他她它) → ACCEPT_SURFACE_EXACT', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzt',
      tonePinyinKey: 'zzt1',
      words: ['他', '她', '它'],
      idPrefix: 'obs_ta_exact',
    });
    const rt = boot(rows, 'obs-ta-exact-');
    const r = recall1(rt, ['zzt'], '他', 1);
    expect(hitSnap(r)).toEqual([
      expect.objectContaining({ word: '他', kind: 'exact_base', domains: [], repairTarget: false }),
    ]);
    expect(r.length1Collector?.terminalReason).toBe('ACCEPT_SURFACE_EXACT');
    expect(r.length1Collector?.chosenSource).toBe('page_surface_exact');
    expect(r.length1Collector?.eligibleHitCount).toBe(3);
  });

  it('one unique tone-exact hit (synthetic key) → ACCEPT_UNIQUE_TONE_EXACT', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzu',
      tonePinyinKey: 'zzu3',
      words: ['点'],
      idPrefix: 'obs_uniq',
    });
    const rt = boot(rows, 'obs-uniq-');
    const r = recall1(rt, ['zzu'], '点', 3);
    expect(hitSnap(r)).toEqual([expect.objectContaining({ word: '点' })]);
    expect(r.length1Collector?.terminalReason).toBe('ACCEPT_UNIQUE_TONE_EXACT');
    expect(r.length1Collector?.uniqueToneExact).toBe(true);
    expect(r.length1Collector?.chosenSource).toBe('unique_tone_exact');
    expect(r.length1Collector?.eligibleHitCount).toBe(1);
  });

  it('multiple tone-exact hits without surface match → MULTIPLE_TONE_EXACT_CANDIDATES', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzt',
      tonePinyinKey: 'zzt1',
      words: ['他', '她', '它'],
      idPrefix: 'obs_ta_multi',
    });
    const rt = boot(rows, 'obs-ta-multi-');
    const r = recall1(rt, ['zzt'], '塌', 1);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.terminalReason).toBe('MULTIPLE_TONE_EXACT_CANDIDATES');
    expect(r.length1Collector?.eligibleHitCount).toBe(3);
  });

  it('no tone pattern → NO_TONE_PATTERN and no SQL', () => {
    const rt = boot();
    const r = recall1(rt, ['dian'], '点', false);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.terminalReason).toBe('NO_TONE_PATTERN');
    expect(r.length1Collector?.queryExecuted).toBe(false);
  });

  it('tone caller disabled → TONE_READINESS_NOT_READY and no SQL', () => {
    const rt = boot();
    const r = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
      toneCallerEnabled: false,
    });
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.terminalReason).toBe('TONE_READINESS_NOT_READY');
    expect(r.length1Collector?.toneRecallReadiness).toBe('caller_disabled');
    expect(r.length1Collector?.queryExecuted).toBe(false);
  });

  it('SQL zero hit', () => {
    const rt = boot();
    const r = recall1(rt, ['zzzz'], '字', 1);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.terminalReason).toBe('SQL_NO_HIT');
    expect(r.length1Collector?.sqlHitCount).toBe(0);
  });

  it('traditional raw / simplified canonical is recorded; unique still accepts frozen unique-tone path', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzu',
      tonePinyinKey: 'zzu3',
      words: ['点'],
      idPrefix: 'obs_trad_uniq',
    });
    const rt = boot(rows, 'obs-trad-uniq-');
    const r = recall1(rt, ['zzu'], '點', 3);
    expect(r.length1Collector?.windowText).toBe('點');
    expect(r.length1Collector?.windowTextCanonical).toBe('点');
    // Frozen unique-tone does not require surface===windowText.
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.hotword.word).toBe('点');
    expect(r.length1Collector?.terminalReason).toBe('ACCEPT_UNIQUE_TONE_EXACT');
  });

  it('traditional raw among multiple tone-exact → NORMALIZATION_SURFACE_MISMATCH (not unique)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzq',
      tonePinyinKey: 'zzq3',
      words: ['点', '店', '电'],
      idPrefix: 'obs_trad_multi',
    });
    const rt = boot(rows, 'obs-trad-multi-');
    const r = recall1(rt, ['zzq'], '點', 3);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.windowTextCanonical).toBe('点');
    expect(r.length1Collector?.terminalReason).toBe('NORMALIZATION_SURFACE_MISMATCH');
  });

  it('score below threshold → MIN_SCORE_REJECT and empty hits', () => {
    const baseCfg = quality.getAsrRepairQualityConfig();
    const spy = jest
      .spyOn(quality, 'getAsrRepairQualityConfig')
      .mockReturnValue({ ...baseCfg, minCandidateScore: 999 });
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzu',
      tonePinyinKey: 'zzu3',
      words: ['点'],
      idPrefix: 'obs_score',
    });
    const rt = boot(rows, 'obs-score-');
    const r = recall1(rt, ['zzu'], '点', 3);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.terminalReason).toBe('MIN_SCORE_REJECT');
    expect(r.length1Collector?.minCandidateScore).toBe(999);
    spy.mockRestore();
  });

  it('LIMIT truncation residual singleton → LIMIT_TRUNCATION_REJECT', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzl',
      tonePinyinKey: 'zzl2',
      words: ['符', '扶', '芙', '幅', '辐', '福', '蝠', '服', '付'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'obs_lim',
    });
    const rt = boot(rows, 'obs-lim-');
    const r = recall1(rt, ['zzl'], '伏', 2);
    expect(r.hits).toHaveLength(0);
    expect(r.length1Collector?.truncated).toBe(true);
    expect(r.length1Collector?.eligibleHitCount).toBe(1);
    expect(r.length1Collector?.terminalReason).toBe('LIMIT_TRUNCATION_REJECT');
  });

  it('valid exact accept and domain/fuzzy not used (base-only cap=1)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzw',
      tonePinyinKey: 'zzw3',
      words: ['我'],
      idPrefix: 'obs_wo',
    });
    const rt = boot(rows, 'obs-wo-');
    const r = recall1(rt, ['zzw'], '我', 3);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.hotword.word).toBe('我');
    expect(r.hits[0]!.hotword.domains ?? []).toEqual([]);
    expect(r.length1Collector?.terminalReason).toBe('ACCEPT_UNIQUE_TONE_EXACT');
  });

  it('fallback after reject: window bind yields 0 candidates; collector reason is explicit', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzt',
      tonePinyinKey: 'zzt1',
      words: ['他', '她', '它'],
      idPrefix: 'obs_ta',
    });
    const rt = boot(rows, 'obs-ta-fb-');
    const fix = makeCharToneFixtures('塌', [1]);
    const recall = recallTopKForWindows({
      rawText: '塌',
      globalSyllables: ['zzt'],
      windows: [
        makeWindow({
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          windowText: '塌',
          windowPinyinKey: 'zzt',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      minPrior: 0.5,
      fuzzyRecallEnabled: true,
      toneTimestampOnlyEnabled: true,
      acousticSlices: fix.acousticSlices,
      wordTimeSpans: fix.wordTimeSpans,
    });
    expect(recall.candidates).toHaveLength(0);
    expect(recall.length1Windows).toHaveLength(1);
    expect(recall.length1Windows[0]!.terminalReason).toBe('MULTIPLE_TONE_EXACT_CANDIDATES');
    expect(recall.length1Windows[0]!.boundCandidateCount).toBe(0);
  });

  it('TRACE_ON vs TRACE_OFF: collector hits/order identical', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'zzt',
      tonePinyinKey: 'zzt1',
      words: ['他', '她', '它'],
      idPrefix: 'obs_trace_eq',
    });
    const rt = boot(rows, 'obs-trace-eq-');
    const prev = process.env.MODEL2_DIALOG200_TRACE;
    try {
      delete process.env.MODEL2_DIALOG200_TRACE;
      const off = hitSnap(recall1(rt, ['zzt'], '他', 1));
      process.env.MODEL2_DIALOG200_TRACE = '1';
      const on = hitSnap(recall1(rt, ['zzt'], '他', 1));
      expect(on).toEqual(off);
    } finally {
      if (prev === undefined) delete process.env.MODEL2_DIALOG200_TRACE;
      else process.env.MODEL2_DIALOG200_TRACE = prev;
    }
  });
});
