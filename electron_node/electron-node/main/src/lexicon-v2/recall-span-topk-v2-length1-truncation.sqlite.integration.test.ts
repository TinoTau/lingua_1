/**
 * Batch 1.1A — truncation-aware uniqueness (real LexiconRuntimeV2 / SQLite).
 * Does NOT implement surface rank9 probe (Batch 1.1B).
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
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_1a'
);
const BEFORE_BASELINE = path.resolve(
  BATCH10B_V3_SOURCE_DIR,
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json'
);

function eligibleFromRuntime(rows: ReturnType<LexiconRuntimeV2['lookupBaseByPinyinKey']>) {
  return rows.filter(
    (h) => h.enabled && h.word.length === 1 && h.isAlias !== true && h.priorScore > 0
  );
}

describe('Batch 1.1A truncation-aware uniqueness (SQLite)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  function bootRows(
    baseRows: ReturnType<typeof batch10bStandardBaseRows>,
    prefix: string
  ): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({ baseRows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('preserves repair-before LIMIT=8 false-unique baseline artifact', () => {
    expect(fs.existsSync(BEFORE_BASELINE)).toBe(true);
    const before = JSON.parse(fs.readFileSync(BEFORE_BASELINE, 'utf-8')) as {
      observedFalseUnique: boolean;
      finalCandidateCount: number;
      databaseCandidateCount: number;
      runtimeReturnedCount: number;
      visibleEligibleCount: number;
    };
    expect(before.databaseCandidateCount).toBe(9);
    expect(before.runtimeReturnedCount).toBe(8);
    expect(before.visibleEligibleCount).toBe(1);
    expect(before.finalCandidateCount).toBe(1);
    expect(before.observedFalseUnique).toBe(true);
  });

  it('false unique: truncated residual singleton rejected (tone path / 1.1A)', () => {
    // Metamorphic key/chars (not only 捌/玖): 9 rows, first 7 alias → residual 1 in top8.
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'fu',
      tonePinyinKey: 'fu2',
      words: ['符', '扶', '芙', '幅', '辐', '福', '蝠', '服', '付'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'b11a_plain_fu',
    });
    const rt = bootRows(rows, 'b11a-plain-fu-');
    const db = new Database(bundle!.sqlitePath, { readonly: true });
    const dbCount = (
      db.prepare(`SELECT COUNT(*) AS c FROM base_lexicon WHERE pinyin_key = 'fu'`).get() as {
        c: number;
      }
    ).c;
    db.close();
    const raw = rt.lookupBaseByPinyinAndToneKey('fu', 'fu2', 1, 8);
    const eligible = eligibleFromRuntime(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['fu'],
      windowText: '伏',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [2],
    }).hits;

    expect(dbCount).toBeGreaterThan(8);
    expect(raw.length).toBe(8);
    expect(eligible.length).toBe(1);
    expect(hits).toHaveLength(0);

    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'length1_plain_false_unique_after.json'),
      JSON.stringify(
        {
          pinyinKey: 'fu',
          databaseCandidateCount: dbCount,
          runtimeReturnedCount: raw.length,
          visibleEligibleCount: eligible.length,
          finalCandidateCount: hits.length,
          observedFalseUnique: false,
          falseUniqueRejected: true,
        },
        null,
        2
      ),
      'utf-8'
    );
  });

  it('Tone false unique: truncated residual singleton rejected', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'shi',
      tonePinyinKey: 'shi4',
      words: ['是', '事', '市', '式', '试', '室', '视', '士', '世'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'b11a_tone_shi',
    });
    const rt = bootRows(rows, 'b11a-tone-shi-');
    const raw = rt.lookupBaseByPinyinAndToneKey('shi', 'shi4', 1, 8);
    const eligible = eligibleFromRuntime(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['shi'],
      windowText: '适',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [4],
    }).hits;
    expect(raw.length).toBe(8);
    expect(eligible.length).toBe(1);
    expect(hits).toHaveLength(0);

    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'length1_tone_false_unique_after.json'),
      JSON.stringify(
        {
          tonePinyinKey: 'shi4',
          runtimeReturnedCount: raw.length,
          visibleEligibleCount: eligible.length,
          finalCandidateCount: hits.length,
          falseUniqueRejected: true,
        },
        null,
        2
      ),
      'utf-8'
    );
  });

  it('legacy lim/lim1 false-unique seed now rejected; rank9 page still truncated', () => {
    const limRows = batch10bLimit8Rows();
    const rt = bootRows(limRows, 'b11a-lim8-');
    const db = new Database(bundle!.sqlitePath, { readonly: true });
    const dbCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM base_lexicon WHERE pinyin_key = 'lim' AND tone_pinyin_key = 'lim1'`
        )
        .get() as { c: number }
    ).c;
    db.close();
    const sqlReturned = rt.lookupBaseByPinyinAndToneKey('lim', 'lim1', 1, 8);
    const eligible = eligibleFromRuntime(sqlReturned);
    // Surface 零 absent → truncation reject + exact miss (1.1A remains).
    // Rank9 玖 reachability is Batch 1.1B coverage (not this suite's windowText).
    const recallHits = recallSpanTopKV2(rt, {
      syllables: ['lim'],
      windowText: '零',
      termLength: 1,
      topK: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    const surfaceExactAtPosition9InAmbiguityPage = sqlReturned.some((h) => h.word === '玖');
    const after = {
      databaseCandidateCount: dbCount,
      runtimeReturnedCount: sqlReturned.length,
      visibleEligibleCount: eligible.length,
      finalCandidateCount: recallHits.length,
      surfaceExactAtPosition9InAmbiguityPage,
      observedFalseUnique: false,
      falseUniqueRejected: recallHits.length === 0 && eligible.length === 1 && sqlReturned.length === 8,
      notes:
        'Batch 1.1A: truncation rejects residual singleton when surface absent. Rank9 identity is Batch 1.1B.',
      finalWords: recallHits.map((h) => h.hotword.word),
      eligibleWords: eligible.map((h) => h.word),
      runtimeWords: sqlReturned.map((h) => h.word),
      repairBeforeBaselinePath: BEFORE_BASELINE,
    };
    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'length1_limit8_real_sqlite_baseline_after.json'),
      JSON.stringify(after, null, 2),
      'utf-8'
    );
    expect(after.databaseCandidateCount).toBe(9);
    expect(after.runtimeReturnedCount).toBe(8);
    expect(after.visibleEligibleCount).toBe(1);
    expect(after.finalCandidateCount).toBe(0);
    expect(after.surfaceExactAtPosition9InAmbiguityPage).toBe(false);
    expect(after.falseUniqueRejected).toBe(true);
  });

  it('true unique: single row, returned < limit (tone path / 1.1A)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ke',
      tonePinyinKey: 'ke3',
      words: ['可'],
      idPrefix: 'b11a_true_ke',
    });
    const rt = bootRows(rows, 'b11a-true-ke-');
    const raw = rt.lookupBaseByPinyinAndToneKey('ke', 'ke3', 1, 8);
    expect(raw.length).toBe(1);
    expect(raw.length < 8).toBe(true);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['ke'],
      windowText: '可',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('可');
    expect(hits[0]!.hotword.domains ?? []).toEqual([]);
    expect(hits[0]!.hotword.repairTarget).toBe(false);
  });

  it('Tone true unique: single row under tone key', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'xu',
      tonePinyinKey: 'xu1',
      words: ['需'],
      idPrefix: 'b11a_true_xu',
    });
    const rt = bootRows(rows, 'b11a-true-xu-');
    const raw = rt.lookupBaseByPinyinAndToneKey('xu', 'xu1', 1, 8);
    expect(raw.length).toBe(1);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['xu'],
      windowText: '需',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('需');
    expect(hits[0]!.toneLookupStage).toBe('tone_exact');
  });

  it('Non-truncated with aliases/disabled → residual unique accepted', () => {
    // 3 rows total (<8): 2 alias + 1 eligible → full page visible → unique OK
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'mu',
      tonePinyinKey: 'mu4',
      words: ['木', '目', '牧'],
      aliasIndices: [0, 1],
      idPrefix: 'b11a_ntrunc_mu',
    });
    const rt = bootRows(rows, 'b11a-ntrunc-mu-');
    const raw = rt.lookupBaseByPinyinAndToneKey('mu', 'mu4', 1, 8);
    expect(raw.length).toBe(3);
    expect(raw.length < 8).toBe(true);
    const eligible = eligibleFromRuntime(raw);
    expect(eligible.length).toBe(1);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['mu'],
      windowText: '牧',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [4],
    }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('牧');
  });

  it('Truncated zero eligible → empty', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ze',
      tonePinyinKey: 'ze2',
      words: ['泽', '责', '择', '则', '仄', '咋', '萚', '啧', '赜'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6, 7],
      // 9th also alias so top8 all alias → eligible 0
      idPrefix: 'b11a_zero_ze',
    });
    // Make all 9 alias so eligible in top8 is 0
    for (const r of rows) {
      r.isAlias = true;
    }
    const rt = bootRows(rows, 'b11a-zero-ze-');
    const raw = rt.lookupBaseByPinyinAndToneKey('ze', 'ze2', 1, 8);
    expect(raw.length).toBe(8);
    expect(eligibleFromRuntime(raw)).toHaveLength(0);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['ze'],
      windowText: '泽',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [2],
    }).hits;
    expect(hits).toHaveLength(0);
  });

  it('Truncated multiple eligible → ambiguity, no Top1', () => {
    // 9 rows, none alias → top8 all eligible (>=2) → surface miss → empty (not Top1)
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'hao',
      tonePinyinKey: 'hao3',
      words: ['好', '郝', '昊', '浩', '号', '耗', '蒿', '镐', '皓'],
      aliasIndices: [],
      idPrefix: 'b11a_multi_hao',
    });
    const rt = bootRows(rows, 'b11a-multi-hao-');
    const raw = rt.lookupBaseByPinyinAndToneKey('hao', 'hao3', 1, 8);
    const eligible = eligibleFromRuntime(raw);
    expect(raw.length).toBe(8);
    expect(eligible.length).toBeGreaterThanOrEqual(2);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['hao'],
      windowText: '毫', // not in top8 / not unique surface in set
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    }).hits;
    expect(hits).toHaveLength(0);
  });

  it('Surface exact within fetched set still works when eligible>=2', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'na',
      tonePinyinKey: 'na3',
      words: ['哪', '那'],
      idPrefix: 'b11a_surf_na',
    });
    const rt = bootRows(rows, 'b11a-surf-na-');
    const raw = rt.lookupBaseByPinyinAndToneKey('na', 'na3', 1, 8);
    expect(raw.length).toBe(2);
    expect(raw.length < 8).toBe(true);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['na'],
      windowText: '哪',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    }).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('哪');
  });

  it('Metamorphic: truncation alone still rejects when surface has no exact identity', () => {
    // Eligible residual singleton in top8 is 俾; aliases fill 0..6; 髀 at rank9.
    // Window surface absent from this pinyin key → ambiguity reject + exact miss → empty.
    // (When surface === residual 俾 or rank9 髀, Batch 1.1B exact identity may accept.)
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'bi',
      tonePinyinKey: 'bi3',
      words: ['笔', '比', '彼', '鄙', '匕', '妣', '吡', '俾', '髀'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 'b11a_meta_bi',
    });
    const rt = bootRows(rows, 'b11a-meta-bi-');
    const raw = rt.lookupBaseByPinyinAndToneKey('bi', 'bi3', 1, 8);
    expect(eligibleFromRuntime(raw).map((h) => h.word)).toEqual(['俾']);
    expect(
      recallSpanTopKV2(rt, {
        syllables: ['bi'],
        windowText: '▢', // not in seeded bi rows
        termLength: 1,
        topK: 1,
        profile: defaultGeneralProfile(),
        domainIds: [],
        acousticTonePattern: [3],
      }).hits
    ).toHaveLength(0);
  });

  it('standard seeds: 我 / 点 true unique still hit', () => {
    const rt = bootRows(batch10bStandardBaseRows(), 'b11a-std-');
    expect(
      recallSpanTopKV2(rt, {
        syllables: ['wo'],
        windowText: '我',
        termLength: 1,
        topK: 1,
        profile: defaultGeneralProfile(),
        domainIds: [],
        acousticTonePattern: [3],
      }).hits[0]?.hotword.word
    ).toBe('我');
    expect(
      recallSpanTopKV2(rt, {
        syllables: ['dian'],
        windowText: '点',
        termLength: 1,
        topK: 1,
        profile: defaultGeneralProfile(),
        domainIds: [],
        acousticTonePattern: [3],
      }).hits[0]?.hotword.word
    ).toBe('点');
  });
});
