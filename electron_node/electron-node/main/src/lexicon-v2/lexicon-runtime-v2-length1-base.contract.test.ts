/**
 * Batch 1.0C — Runtime Contract: base exact/tone length=1 open; other tiers stay min=2.
 * Real temp SQLite + LexiconRuntimeV2 (no fake runtime).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { buildFuzzyPinyinVariants } from './fuzzy-pinyin-key-builder';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import {
  batch10bDomainGuardRows,
  batch10bStandardBaseRows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

describe('Runtime Contract Test: base length-1 gate (Batch 1.0C)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  function boot(withDomainGuard = false): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({
      baseRows: batch10bStandardBaseRows(),
      domainRows: withDomainGuard ? batch10bDomainGuardRows() : [],
      prefix: 'b0c-rt-',
    });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('base plain length=1 returns real row (点)', () => {
    const rt = boot();
    const hits = rt.lookupBaseByPinyinKey('dian', 1, 8);
    expect(hits.some((h) => h.word === '点' && h.enabled)).toBe(true);
  });

  it('base tone length=1 returns real row (dian3→点)', () => {
    const rt = boot();
    const hits = rt.lookupBaseByPinyinAndToneKey('dian', 'dian3', 1, 8);
    expect(hits.some((h) => h.word === '点')).toBe(true);
  });

  it('deformation: different chars / tones / priors still return length=1 base', () => {
    const rt = boot();
    expect(rt.lookupBaseByPinyinKey('wo', 1).some((h) => h.word === '我')).toBe(true);
    expect(rt.lookupBaseByPinyinAndToneKey('na', 'na2', 1).some((h) => h.word === '拿')).toBe(true);
    expect(rt.lookupBaseByPinyinAndToneKey('na', 'na3', 1).some((h) => h.word === '哪')).toBe(true);
    expect(rt.lookupBaseByPinyinKey('ma', 1).some((h) => h.word === '吗')).toBe(true);
  });

  it('base length=2 regression unchanged (甲乙)', () => {
    const rt = boot();
    const hits = rt.lookupBaseByPinyinKey('jia|yi', 2);
    expect(hits.some((h) => h.word === '甲乙')).toBe(true);
  });

  it('does not broaden domain tier to length1', () => {
    const rt = boot(true);
    expect(rt.lookupDomainByPinyinKey('coffee', 'dian', 1)).toEqual([]);
    expect(rt.lookupDomainsByPinyinKeyMulti(['coffee'], 'dian', 1)).toEqual([]);
    expect(rt.lookupDomainByPinyinAndToneKey('coffee', 'dian', 'dian3', 1)).toEqual([]);
  });

  it('does not enable idiom length1', () => {
    const rt = boot();
    expect(rt.lookupIdiomByPinyinKey('dian', 1)).toEqual([]);
    expect(rt.lookupIdiomByPinyinAndToneKey('dian', 'dian3', 1)).toEqual([]);
  });

  it('does not enable fuzzy length1 (builder unreachable)', () => {
    expect(buildFuzzyPinyinVariants(['dian'])).toEqual([]);
    expect(buildFuzzyPinyinVariants(['wo'])).toEqual([]);
  });

  it('disabled length=1 base row not returned by Runtime SQL', () => {
    const rt = boot();
    expect(rt.lookupBaseByPinyinKey('ce', 1)).toEqual([]);
  });

  it('alias row may appear in Runtime raw lookup (is_alias=1) — Recall filters separately', () => {
    const rt = boot();
    const hits = rt.lookupBaseByPinyinKey('dian', 1, 8);
    expect(hits.some((h) => h.word === '惦' && h.isAlias === true)).toBe(true);
  });
});
