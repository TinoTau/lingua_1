/**
 * Batch 1.1B — Surface Exact Reachability (real LexiconRuntimeV2 / SQLite).
 * Ambiguity LIMIT=8 unchanged; independent exact lookup only when no Candidate.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import {
  BATCH10B_V3_SOURCE_DIR,
  batch10bLimit8Rows,
  batch10bStandardBaseRows,
  buildSameKeyLength1Rows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

const AUDIT_OUT = path.resolve(
  BATCH10B_V3_SOURCE_DIR,
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_1b'
);

function recall1(
  rt: LexiconRuntimeV2,
  syllables: string[],
  windowText: string,
  /** Batch 1.1C: default tone=1. Pass false for no_pattern Fail Closed. */
  tone: number | false = 1
) {
  return recallSpanTopKV2(rt, {
    syllables,
    windowText,
    termLength: 1,
    topK: 1,
    profile: defaultGeneralProfile(),
    domainIds: [],
    ...(tone === false ? {} : { acousticTonePattern: [tone] }),
  }).hits;
}

describe('Batch 1.1B surface exact reachability (SQLite)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  function boot(
    baseRows: ReturnType<typeof batch10bStandardBaseRows>,
    prefix: string
  ): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({ baseRows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('rank1: surface in ambiguity page still hits (no overwrite regression)', () => {
    const words = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'rk',
      tonePinyinKey: 'rk1',
      words,
      idPrefix: 'b11b_rank',
    });
    const rt = boot(rows, 'b11b-rank1-');
    const hits = recall1(rt, ['rk'], '甲', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('甲');
    expect(hits[0]!.recallCandidateKind).toBe('exact_base');
  });

  it('rank8: surface at LIMIT boundary still hits via ambiguity page', () => {
    const words = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'rk',
      tonePinyinKey: 'rk1',
      words,
      idPrefix: 'b11b_rank',
    });
    const rt = boot(rows, 'b11b-rank8-');
    const page = rt.lookupBaseByPinyinKey('rk', 1, 8);
    expect(page.map((h) => h.word)).toContain('辛');
    expect(page.map((h) => h.word)).not.toContain('壬');
    const hits = recall1(rt, ['rk'], '辛', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('辛');
  });

  it('rank9: surface outside ambiguity page reachable via exact lookup', () => {
    const limRows = batch10bLimit8Rows();
    const rt = boot(limRows, 'b11b-rank9-');
    const page = rt.lookupBaseByPinyinAndToneKey('lim', 'lim1', 1, 8);
    expect(page.some((h) => h.word === '玖')).toBe(false);
    const exact = rt.lookupBaseByExactSurfacePinyinAndTone('lim', 'lim1', '玖', 1);
    expect(exact).toHaveLength(1);
    expect(exact[0]!.word).toBe('玖');
    const hits = recall1(rt, ['lim'], '玖', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('玖');
    expect(hits[0]!.recallCandidateKind).toBe('exact_base');
    expect(hits[0]!.toneLookupStage).toBe('tone_exact');

    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'surface_rank9_after.json'),
      JSON.stringify(
        {
          ambiguityPageHas玖: false,
          exactRows: exact.length,
          finalWord: hits[0]!.hotword.word,
          reachable: true,
        },
        null,
        2
      ),
      'utf-8'
    );
  });

  it('rank20: deep surface still reachable (exact, not enlarged LIMIT)', () => {
    const words = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'dp',
      tonePinyinKey: 'dp1',
      words,
      idPrefix: 'b11b_deep',
    });
    const surface = words[19]!;
    const rt = boot(rows, 'b11b-rank20-');
    const page = rt.lookupBaseByPinyinKey('dp', 1, 8);
    expect(page.some((h) => h.word === surface)).toBe(false);
    expect(rt.lookupBaseByExactSurfaceAndPinyin('dp', surface, 1)).toHaveLength(1);
    const hits = recall1(rt, ['dp'], surface, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe(surface);
  });

  it('absent: no row → empty', () => {
    // Ambiguity must not true-unique-accept an unrelated char (1.1A non-truncated unique).
    // Seed only an alias under this key so eligible=0; exact for 无 misses.
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ab',
      tonePinyinKey: 'ab1',
      words: ['有'],
      aliasIndices: [0],
      idPrefix: 'b11b_abs',
    });
    const rt = boot(rows, 'b11b-absent-');
    expect(rt.lookupBaseByExactSurfaceAndPinyin('ab', '无', 1)).toHaveLength(0);
    expect(recall1(rt, ['ab'], '无')).toHaveLength(0);
  });

  it('alias: exact row filtered by eligibility → empty', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'al',
      tonePinyinKey: 'al1',
      words: ['主', '别'],
      aliasIndices: [1],
      idPrefix: 'b11b_alias',
    });
    // Force ambiguity empty for surface 别: make 主 also alias so page has no eligible unique for 别
    rows[0]!.isAlias = true;
    const rt = boot(rows, 'b11b-alias-');
    const exact = rt.lookupBaseByExactSurfaceAndPinyin('al', '别', 1);
    expect(exact).toHaveLength(1);
    expect(exact[0]!.isAlias).toBe(true);
    expect(recall1(rt, ['al'], '别')).toHaveLength(0);
  });

  it('disabled: exact SQL excludes enabled=0 → empty', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ds',
      tonePinyinKey: 'ds1',
      words: ['开', '关'],
      disabledIndices: [1],
      idPrefix: 'b11b_dis',
    });
    rows[0]!.isAlias = true; // ambiguity has no eligible for 关
    const rt = boot(rows, 'b11b-disabled-');
    expect(rt.lookupBaseByExactSurfaceAndPinyin('ds', '关', 1)).toHaveLength(0);
    expect(recall1(rt, ['ds'], '关')).toHaveLength(0);
  });

  it('duplicate: PRIMARY KEY (pinyin_key, word) prevents true duplicate rows', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'du',
      tonePinyinKey: 'du1',
      words: ['独'],
      idPrefix: 'b11b_dup',
    });
    const rt = boot(rows, 'b11b-dup-');
    const db = new Database(bundle!.sqlitePath);
    const tableSql = (
      db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='base_lexicon'`).get() as {
        sql: string;
      }
    ).sql;
    expect(tableSql).toMatch(/PRIMARY KEY\s*\(\s*pinyin_key\s*,\s*word\s*\)/i);
    let insertFailed = false;
    try {
      db.prepare(
        `INSERT INTO base_lexicon (
          id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
          repair_target, enabled, aliases, source, canonical_word, is_alias
        ) VALUES (?, 'du', 'du1', '独', '独', 0.5, 0, 1, NULL, 'dup_probe', '独', 0)`
      ).run('b11b_dup_clash');
    } catch {
      insertFailed = true;
    }
    db.close();
    expect(insertFailed).toBe(true);
    // Defensive LIMIT 2 still returns at most 1 under current schema
    expect(rt.lookupBaseByExactSurfaceAndPinyin('du', '独', 1).length).toBeLessThanOrEqual(1);
  });

  it('no tone pattern → Empty; Plain SQL zero (Mandatory Tone Recall / 1.1C)', () => {
    const words = Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0x5e00 + i));
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'pl',
      tonePinyinKey: 'pl2',
      words,
      idPrefix: 'b11b_plain',
    });
    const surface = words[10]!;
    const rt = boot(rows, 'b11b-plain-');
    const spyPlain = jest.spyOn(rt, 'lookupBaseByPinyinKey');
    const spyPlainExact = jest.spyOn(rt, 'lookupBaseByExactSurfaceAndPinyin');
    const hits = recall1(rt, ['pl'], surface, false);
    expect(hits).toHaveLength(0);
    expect(spyPlain).not.toHaveBeenCalled();
    expect(spyPlainExact).not.toHaveBeenCalled();
    spyPlain.mockRestore();
    spyPlainExact.mockRestore();
  });

  it('tone: exact surface uses tone composite path', () => {
    const words = Array.from({ length: 12 }, (_, i) => String.fromCodePoint(0x6200 + i));
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'tn',
      tonePinyinKey: 'tn3',
      words,
      idPrefix: 'b11b_tone',
    });
    const surface = words[9]!;
    const rt = boot(rows, 'b11b-tone-');
    expect(
      rt.lookupBaseByPinyinAndToneKey('tn', 'tn3', 1, 8).some((h) => h.word === surface)
    ).toBe(false);
    expect(rt.lookupBaseByExactSurfacePinyinAndTone('tn', 'tn3', surface, 1)).toHaveLength(1);
    const hits = recall1(rt, ['tn'], surface, 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe(surface);
    expect(hits[0]!.toneLookupStage).toBe('tone_exact');
  });

  it('priority: ambiguity Candidate is not overwritten by exact', () => {
    // Non-truncated unique eligible → ambiguity returns 主 even if window asks 客 (absent).
    // Exact for 客 misses; chosen already set so no overwrite path needed.
    // Stronger: eligible>=2 with surface in page → ambiguity surface exact wins; exact not required.
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'pr',
      tonePinyinKey: 'pr1',
      words: ['主', '客'],
      idPrefix: 'b11b_prio',
    });
    const rt = boot(rows, 'b11b-prio-');
    const hits = recall1(rt, ['pr'], '主', 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('主');
    // Ambiguity already legal; exact must not replace with another identity
    const exactOther = rt.lookupBaseByExactSurfaceAndPinyin('pr', '客', 1);
    expect(exactOther).toHaveLength(1);
    expect(hits[0]!.hotword.word).not.toBe('客');
  });

  it('Runtime exact LIMIT is fixed at 2 (rows only; no open sqlLimit)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'lm',
      tonePinyinKey: 'lm1',
      words: ['限'],
      idPrefix: 'b11b_lim2',
    });
    const rt = boot(rows, 'b11b-lim2-');
    const fn = rt.lookupBaseByExactSurfaceAndPinyin.bind(rt);
    expect(fn.length).toBeLessThanOrEqual(3); // pinyin, word, termLength — no sqlLimit arg
    expect(rt.lookupBaseByExactSurfaceAndPinyin('lm', '限', 1)).toHaveLength(1);
  });

  it('1.1A compat: truncated residual singleton without matching identity still empty', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'fu',
      tonePinyinKey: 'fu2',
      words: ['符', '扶', '芙', '幅', '辐', '福', '蝠', '服', '付'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'b11b_compat_fu',
    });
    const rt = boot(rows, 'b11b-compat-fu-');
    expect(recall1(rt, ['fu'], '▢', 2)).toHaveLength(0);
  });

  it('1.1B: truncated residual surface identity accepted via exact (not inferred uniqueness)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'bi',
      tonePinyinKey: 'bi3',
      words: ['笔', '比', '彼', '鄙', '匕', '妣', '吡', '俾', '髀'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'b11b_resid',
    });
    const rt = boot(rows, 'b11b-resid-');
    const page = rt.lookupBaseByPinyinKey('bi', 1, 8);
    expect(page.length).toBe(8);
    expect(page.filter((h) => !h.isAlias && h.priorScore > 0).map((h) => h.word)).toEqual(['俾']);
    const hits = recall1(rt, ['bi'], '俾', 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('俾');
  });
});
