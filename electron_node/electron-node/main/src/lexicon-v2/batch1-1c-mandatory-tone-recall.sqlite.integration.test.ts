/**
 * Batch 1.1C — Mandatory Tone Recall Fail Closed (real LexiconRuntimeV2 / SQLite).
 * Asserts Plain SQL zero-call on all non-ready / underfill branches.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import {
  batch10bStandardBaseRows,
  buildSameKeyLength1Rows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

function boot(
  rows = batch10bStandardBaseRows(),
  prefix = 'b11c-'
): LexiconRuntimeV2 {
  const bundle = createLength1TempSqliteBundle({ baseRows: rows, prefix });
  (globalThis as { __b11cBundle?: Length1TempBundle }).__b11cBundle = bundle;
  return bundle.loadRuntime();
}

function plainSpies(rt: LexiconRuntimeV2) {
  return {
    plain: jest.spyOn(rt, 'lookupBaseByPinyinKey'),
    plainExact: jest.spyOn(rt, 'lookupBaseByExactSurfaceAndPinyin'),
  };
}

describe('Batch 1.1C Mandatory Tone Recall Fail Closed', () => {
  afterEach(() => {
    const b = (globalThis as { __b11cBundle?: Length1TempBundle }).__b11cBundle;
    b?.cleanup();
    delete (globalThis as { __b11cBundle?: Length1TempBundle }).__b11cBundle;
  });

  it('length1 ready → Tone Candidate', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.hotword.word).toBe('点');
    expect(result.hits[0]!.toneLookupStage).toBe('tone_exact');
    expect(result.toneRecallReadiness?.state).toBe('ready');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 no_pattern → Empty; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('no_pattern');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 invalid_pattern → Empty; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [9],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('invalid_pattern');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 caller_disabled → Empty; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
      toneCallerEnabled: false,
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('caller_disabled');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 runtime_unsupported → Empty; Plain SQL = 0', () => {
    const rt = boot();
    rt.supportsToneFirstRecall = () => false;
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('runtime_unsupported');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 tone ambiguity empty + tone exact hit', () => {
    const words = Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0x6200 + i));
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'tn',
      tonePinyinKey: 'tn3',
      words,
      idPrefix: 'b11c_tone',
    });
    const surface = words[9]!;
    const rt = boot(rows, 'b11c-tone-');
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['tn'],
      windowText: surface,
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.hotword.word).toBe(surface);
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length1 tone ambiguity empty + tone exact empty → Empty; Plain SQL = 0', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'xx',
      tonePinyinKey: 'xx1',
      words: Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0x4e00 + i)),
      idPrefix: 'b11c_miss',
    });
    const rt = boot(rows, 'b11c-miss-');
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['xx'],
      windowText: '缺',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    });
    expect(result.hits).toHaveLength(0);
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length2–5 underfill returns Tone-only; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['jia', 'yi'],
      windowText: '甲乙',
      termLength: 2,
      topK: 5,
      perSpanLimit: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3, 3],
    });
    expect(result.hits.some((h) => h.hotword.word === '甲乙')).toBe(true);
    expect(result.hits.every((h) => h.toneLookupStage === 'tone_exact')).toBe(true);
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length2–5 no_pattern → Empty; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['jia', 'yi'],
      windowText: '甲乙',
      termLength: 2,
      topK: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('no_pattern');
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });

  it('length2–5 empty Tone SQL → Empty; Plain SQL = 0', () => {
    const rt = boot();
    const spies = plainSpies(rt);
    const result = recallSpanTopKV2(rt, {
      syllables: ['jia', 'yi'],
      windowText: '甲乙',
      termLength: 2,
      topK: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      // Wrong tones → tone SQL miss → Empty (no Plain fill)
      acousticTonePattern: [1, 1],
    });
    expect(result.hits).toHaveLength(0);
    expect(spies.plain).not.toHaveBeenCalled();
    expect(spies.plainExact).not.toHaveBeenCalled();
    spies.plain.mockRestore();
    spies.plainExact.mockRestore();
    rt.close();
  });
});
