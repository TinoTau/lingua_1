/**
 * Batch 1.1B Pre-Development Audit — record-only surface reachability baselines.
 * Does not change production code.
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

const BASELINES: Array<Record<string, unknown>> = [];

describe('Batch 1.1B pre-dev surface reachability baselines (record-only)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  afterAll(() => {
    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'surface_reachability_current_baselines.json'),
      JSON.stringify({ generatedAt: '2026-07-28', cases: BASELINES }, null, 2),
      'utf-8'
    );
  });

  function boot(rows: ReturnType<typeof buildSameKeyLength1Rows>, prefix: string) {
    bundle = createLength1TempSqliteBundle({ baseRows: rows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  function recallSurface(
    rt: LexiconRuntimeV2,
    key: string,
    surface: string,
    /** Batch 1.1C: default tone=1. Pass false for no_pattern Fail Closed. */
    tone: number | false = 1
  ) {
    return recallSpanTopKV2(rt, {
      syllables: [key],
      windowText: surface,
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      ...(tone === false ? {} : { acousticTonePattern: [tone] }),
    }).hits;
  }

  it('B1–B5 rank matrix under prior-ordered LIMIT=8 (no aliases)', () => {
    const words = [
      '甲',
      '乙',
      '丙',
      '丁',
      '戊',
      '己',
      '庚',
      '辛',
      '壬',
      '癸',
      '子',
      '丑',
      '寅',
      '卯',
      '辰',
      '巳',
      '午',
      '未',
      '申',
      '酉',
    ];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'sf',
      tonePinyinKey: 'sf1',
      words,
      aliasIndices: [],
      idPrefix: 'b11b_sf',
    });
    const rt = boot(rows, 'b11b-sf-');
    const raw = rt.lookupBaseByPinyinKey('sf', 1, 8);
    expect(raw.map((h) => h.word)).toEqual(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛']);

    // Post-1.1B: rank9+/deep surfaces reachable via independent exact (CR 1.0.6).
    const specs = [
      { id: 'B1_rank1', surface: '甲', expectInFetch: true, expectHit: true },
      { id: 'B2_rank8', surface: '辛', expectInFetch: true, expectHit: true },
      { id: 'B3_rank9', surface: '壬', expectInFetch: false, expectHit: true },
      { id: 'B4_rank20', surface: '酉', expectInFetch: false, expectHit: true },
      { id: 'B5_absent', surface: '▢', expectInFetch: false, expectHit: false },
    ] as const;

    for (const c of specs) {
      const inFetch = raw.some((h) => h.word === c.surface);
      const hits = recallSurface(rt, 'sf', c.surface, 1);
      BASELINES.push({
        id: c.id,
        surface: c.surface,
        runtimeReturnedCount: raw.length,
        surfaceInFetchedSet: inFetch,
        finalCandidateCount: hits.length,
        finalWord: hits[0]?.hotword.word ?? null,
        note: 'Updated expectations after Batch 1.1B Stage 3 (CR 1.0.6)',
      });
      expect(inFetch).toBe(c.expectInFetch);
      expect(hits.length > 0).toBe(c.expectHit);
    }
  });

  it('B6 alias / B7 disabled / B8 mismatch / B9 duplicate', () => {
    // B6: alias-only surface — ambiguity empty; exact row filtered by eligibility
    let rows = buildSameKeyLength1Rows({
      pinyinKey: 'al',
      tonePinyinKey: 'al1',
      words: ['别'],
      aliasIndices: [0],
      idPrefix: 'b11b_al',
    });
    let rt = boot(rows, 'b11b-al-');
    let hits = recallSurface(rt, 'al', '别', 1);
    BASELINES.push({
      id: 'B6_alias',
      surface: '别',
      finalCandidateCount: hits.length,
      note: 'alias-only: exact row exists but eligibility rejects; no legal Candidate',
    });
    expect(hits).toHaveLength(0);

    runtime?.close();
    bundle?.cleanup();
    // B7: disabled-only surface (no other eligible) → empty
    rows = [
      {
        id: 'b11b_ds_off',
        pinyinKey: 'ds',
        tonePinyinKey: 'ds1',
        word: '禁',
        priorScore: 0.95,
        enabled: false,
      },
    ];
    rt = boot(rows, 'b11b-ds-');
    hits = recallSurface(rt, 'ds', '禁', 1);
    BASELINES.push({
      id: 'B7_disabled',
      surface: '禁',
      finalCandidateCount: hits.length,
      note: 'disabled excluded by SQL enabled=1; no legal Candidate',
    });
    expect(hits).toHaveLength(0);

    hits = recallSurface(rt, 'xx', '可');
    BASELINES.push({
      id: 'B8_pinyin_mismatch',
      surface: '可',
      queryPinyin: 'xx',
      finalCandidateCount: hits.length,
    });
    expect(hits).toHaveLength(0);

    runtime?.close();
    bundle?.cleanup();
    const dup = [
      {
        id: 'b11b_dup_a',
        pinyinKey: 'dp',
        tonePinyinKey: 'dp1',
        word: '同',
        priorScore: 0.9,
      },
      {
        id: 'b11b_dup_b',
        pinyinKey: 'dp',
        tonePinyinKey: 'dp1',
        word: '同',
        priorScore: 0.8,
      },
    ];
    rt = boot(dup, 'b11b-dup-');
    const rawDup = rt.lookupBaseByPinyinKey('dp', 1, 8);
    hits = recallSurface(rt, 'dp', '同');
    BASELINES.push({
      id: 'B9_duplicate_surface',
      runtimeReturnedCount: rawDup.length,
      surfaceMatchCount: rawDup.filter((h) => h.word === '同').length,
      finalCandidateCount: hits.length,
      note: 'PRIMARY KEY (pinyin_key, word) + INSERT OR REPLACE → at most one row; true duplicate impossible',
    });
    expect(rawDup.filter((h) => h.word === '同').length).toBeLessThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('B10 plain/tone + EXPLAIN QUERY PLAN', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'pt',
      tonePinyinKey: 'pt1',
      words: ['平'],
      idPrefix: 'b11b_pt',
    });
    rows.push({
      id: 'b11b_pt_tone2',
      pinyinKey: 'pt',
      tonePinyinKey: 'pt2',
      word: '评',
      priorScore: 0.9,
    });
    const rt = boot(rows, 'b11b-pt-');
    const plain = recallSurface(rt, 'pt', '评', false);
    const tone = recallSurface(rt, 'pt', '评', 1);
    BASELINES.push({
      id: 'B10_no_pattern_vs_tone_miss',
      plainFinal: plain.map((h) => h.hotword.word),
      toneFinal: tone.map((h) => h.hotword.word),
      toneStage: tone[0]?.toneLookupStage ?? null,
      note: '1.1C: no pattern → Empty; tone=pt1 only 平 — surface 评 unreachable on tone path',
    });
    expect(plain).toHaveLength(0);
    // tone1 unique 平 may accept via non-truncated uniqueness (window 评 ignored); not 评 via Plain
    expect(tone.map((h) => h.hotword.word)).toEqual(['平']);

    const db = new Database(bundle!.sqlitePath, { readonly: true });
    const planAmbiguity = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, word FROM base_lexicon
         WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
         ORDER BY prior_score DESC LIMIT ?`
      )
      .all('pt', 1, 8);
    const planSurface = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id, word FROM base_lexicon
         WHERE pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = 1 AND is_alias = 0
         LIMIT 2`
      )
      .all('pt', '评');
    db.close();
    fs.mkdirSync(AUDIT_OUT, { recursive: true });
    fs.writeFileSync(
      path.join(AUDIT_OUT, 'explain_query_plan_surface_vs_ambiguity.json'),
      JSON.stringify(
        {
          ambiguityPlan: planAmbiguity,
          hypotheticalExactSurfacePlan: planSurface,
          note: 'Observational only; Architecture forbids new indexes/temp tables in 1.1B',
        },
        null,
        2
      ),
      'utf-8'
    );
    expect(planAmbiguity.length).toBeGreaterThan(0);
    expect(planSurface.length).toBeGreaterThan(0);
  });
});
