/**
 * Batch 1.1A Stage 4 — Generalization Audit probe (read-only vs production logic).
 * Does not change Recall/Runtime contracts; records 7/8/9 boundary matrix.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { buildLexicalEdges } from '../fw-detector/span-assembly-v4/build-lexical-edges';
import { recallTopKForWindows } from '../fw-detector/span-assembly-v4/recall-topk-for-windows';
import { makeCharToneFixtures } from '../fw-detector/span-assembly-v4/test-tone-fixtures';
import { voteUtteranceDomainFromPool } from '../fw-detector/span-assembly-shared/utterance-domain-vote';
import { runPhase2PathHarnessFromLexicalEdges } from '../fw-detector/span-assembly-v4/phase2-path-harness';
import { buildUtteranceSyllableCoordinate } from '../fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { GlobalWindowDescriptor } from '../fw-detector/span-assembly-v4/v4-types';
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
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_1a'
);

const MATRIX: Array<Record<string, unknown>> = [];

function eligible(rows: ReturnType<LexiconRuntimeV2['lookupBaseByPinyinKey']>) {
  return rows.filter(
    (h) => h.enabled && h.word.length === 1 && h.isAlias !== true && h.priorScore > 0
  );
}

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

describe('Batch 1.1A Stage 4 generalization matrix (real SQLite)', () => {
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
      path.join(AUDIT_OUT, 'stage4_boundary_matrix.json'),
      JSON.stringify({ generatedAt: '2026-07-28', cases: MATRIX }, null, 2),
      'utf-8'
    );
  });

  function boot(rows: ReturnType<typeof buildSameKeyLength1Rows>, prefix: string) {
    bundle = createLength1TempSqliteBundle({ baseRows: rows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  function record(row: Record<string, unknown>) {
    MATRIX.push(row);
  }

  // —— Plain 7/8/9 ——
  it('P1 plain total=7 eligible=1 → accept', () => {
    const words = ['甲', '乙', '丙', '丁', '戊', '己', '庚'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ga',
      tonePinyinKey: 'ga1',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5],
      idPrefix: 's4_p1',
    });
    const rt = boot(rows, 's4-p1-');
    const raw = rt.lookupBaseByPinyinKey('ga', 1, 8);
    const el = eligible(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['ga'],
      windowText: '庚',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'P1',
      path: 'plain',
      dbTotal: 7,
      returned: raw.length,
      eligible: el.length,
      final: hits.length,
      word: hits[0]?.hotword.word ?? null,
    });
    expect(raw.length).toBe(7);
    expect(el.length).toBe(1);
    expect(hits).toHaveLength(1);
  });

  it('P2 plain total=8 eligible=1 → exact-limit reject (conservative)', () => {
    const words = ['申', '酉', '戌', '亥', '子', '丑', '寅', '卯'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'gb',
      tonePinyinKey: 'gb1',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 's4_p2',
    });
    const rt = boot(rows, 's4-p2-');
    const db = new Database(bundle!.sqlitePath, { readonly: true });
    const dbTotal = (
      db.prepare(`SELECT COUNT(*) AS c FROM base_lexicon WHERE pinyin_key='gb'`).get() as {
        c: number;
      }
    ).c;
    db.close();
    const raw = rt.lookupBaseByPinyinKey('gb', 1, 8);
    const el = eligible(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['gb'],
      windowText: '卯',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'P2',
      path: 'plain',
      dbTotal,
      returned: raw.length,
      eligible: el.length,
      final: hits.length,
      exactLimitReject: hits.length === 0,
      note: 'DB has exactly 8 rows; no 9th — still rejected under returnedCount==LIMIT',
    });
    expect(dbTotal).toBe(8);
    expect(raw.length).toBe(8);
    expect(el.length).toBe(1);
    // Post-1.1B: residual surface identity accepted via exact (not inferred uniqueness)
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('卯');
  });

  it('P3 plain total=9 eligible=1 → reject', () => {
    const words = ['辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'gc',
      tonePinyinKey: 'gc1',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 's4_p3',
    });
    const rt = boot(rows, 's4-p3-');
    const raw = rt.lookupBaseByPinyinKey('gc', 1, 8);
    const el = eligible(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['gc'],
      windowText: '亥',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'P3',
      path: 'plain',
      dbTotal: 9,
      returned: raw.length,
      eligible: el.length,
      final: hits.length,
    });
    expect(raw.length).toBe(8);
    expect(el.length).toBe(1);
    // Post-1.1B: residual surface identity accepted via exact
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('亥');
  });

  it('P4 plain total=8 eligible=0 → empty', () => {
    const words = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'gd',
      tonePinyinKey: 'gd1',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6, 7],
      idPrefix: 's4_p4',
    });
    const rt = boot(rows, 's4-p4-');
    const raw = rt.lookupBaseByPinyinKey('gd', 1, 8);
    expect(eligible(raw)).toHaveLength(0);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['gd'],
      windowText: 'A',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({ id: 'P4', path: 'plain', returned: raw.length, eligible: 0, final: hits.length });
    expect(hits).toHaveLength(0);
  });

  it('P5 plain total=8 eligible>=2 → ambiguous no Top1', () => {
    const words = ['一', '二', '三', '四', '五', '六', '七', '八'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ge',
      tonePinyinKey: 'ge1',
      words,
      aliasIndices: [],
      idPrefix: 's4_p5',
    });
    const rt = boot(rows, 's4-p5-');
    const raw = rt.lookupBaseByPinyinKey('ge', 1, 8);
    const el = eligible(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['ge'],
      windowText: '九',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'P5',
      path: 'plain',
      returned: raw.length,
      eligible: el.length,
      final: hits.length,
    });
    expect(el.length).toBeGreaterThanOrEqual(2);
    expect(hits).toHaveLength(0);
  });

  it('P6 plain total=7 eligible>=2 surface in set → accept', () => {
    const words = ['东', '冬', '董', '懂', '动', '洞', '冻'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'gf',
      tonePinyinKey: 'gf3',
      words,
      aliasIndices: [],
      idPrefix: 's4_p6',
    });
    const rt = boot(rows, 's4-p6-');
    const raw = rt.lookupBaseByPinyinKey('gf', 1, 8);
    expect(raw.length).toBe(7);
    expect(eligible(raw).length).toBeGreaterThanOrEqual(2);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['gf'],
      windowText: '懂',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    }).hits;
    record({
      id: 'P6',
      path: 'plain',
      returned: raw.length,
      eligible: eligible(raw).length,
      final: hits.length,
      word: hits[0]?.hotword.word ?? null,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('懂');
  });

  // —— Tone 7/8/9 ——
  it('T1 tone total=7 eligible=1 → accept', () => {
    const words = ['红', '虹', '洪', '宏', '鸿', '弘', '泓'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ta',
      tonePinyinKey: 'ta2',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5],
      idPrefix: 's4_t1',
    });
    const rt = boot(rows, 's4-t1-');
    const raw = rt.lookupBaseByPinyinAndToneKey('ta', 'ta2', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['ta'],
      windowText: '泓',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [2],
    }).hits;
    record({
      id: 'T1',
      path: 'tone',
      returned: raw.length,
      eligible: eligible(raw).length,
      final: hits.length,
    });
    expect(raw.length).toBe(7);
    expect(hits).toHaveLength(1);
  });

  it('T2 tone total=8 eligible=1 → exact-limit reject', () => {
    const words = ['蓝', '兰', '栏', '阑', '澜', '婪', '岚', '褴'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'tb',
      tonePinyinKey: 'tb2',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 's4_t2',
    });
    const rt = boot(rows, 's4-t2-');
    const raw = rt.lookupBaseByPinyinAndToneKey('tb', 'tb2', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['tb'],
      windowText: '褴',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [2],
    }).hits;
    record({
      id: 'T2',
      path: 'tone',
      dbTotal: 8,
      returned: raw.length,
      eligible: eligible(raw).length,
      final: hits.length,
      exactLimitReject: hits.length === 0,
    });
    expect(raw.length).toBe(8);
    expect(eligible(raw).length).toBe(1);
    // Post-1.1B: residual surface identity accepted via exact
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('褴');
  });

  it('T3 tone total=9 eligible=1 → reject', () => {
    const words = ['黄', '皇', '煌', '惶', '簧', '徨', '潢', '璜', '磺'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'tc',
      tonePinyinKey: 'tc2',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 's4_t3',
    });
    const rt = boot(rows, 's4-t3-');
    const raw = rt.lookupBaseByPinyinAndToneKey('tc', 'tc2', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['tc'],
      windowText: '璜',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [2],
    }).hits;
    record({
      id: 'T3',
      path: 'tone',
      returned: raw.length,
      eligible: eligible(raw).length,
      final: hits.length,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('璜');
  });

  it('T4 tone total=8 eligible=0 → empty', () => {
    const words = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'td',
      tonePinyinKey: 'td3',
      words,
      aliasIndices: [0, 1, 2, 3, 4, 5, 6, 7],
      idPrefix: 's4_t4',
    });
    const rt = boot(rows, 's4-t4-');
    const raw = rt.lookupBaseByPinyinAndToneKey('td', 'td3', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['td'],
      windowText: 'Q',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    }).hits;
    record({ id: 'T4', path: 'tone', returned: raw.length, eligible: 0, final: hits.length });
    expect(hits).toHaveLength(0);
  });

  it('T5 tone total=8 eligible>=2 → no Top1', () => {
    const words = ['春', '椿', '唇', '淳', '醇', '纯', '莼', '鹑'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'te',
      tonePinyinKey: 'te1',
      words,
      aliasIndices: [],
      idPrefix: 's4_t5',
    });
    const rt = boot(rows, 's4-t5-');
    const raw = rt.lookupBaseByPinyinAndToneKey('te', 'te1', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['te'],
      windowText: '蠢',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'T5',
      path: 'tone',
      eligible: eligible(raw).length,
      final: hits.length,
    });
    expect(eligible(raw).length).toBeGreaterThanOrEqual(2);
    expect(hits).toHaveLength(0);
  });

  it('T6 tone total=7 eligible>=2 + surface → accept', () => {
    const words = ['夏', '厦', '吓', '下', '虾', '匣', '峡'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'tf',
      tonePinyinKey: 'tf4',
      words,
      aliasIndices: [],
      idPrefix: 's4_t6',
    });
    const rt = boot(rows, 's4-t6-');
    const raw = rt.lookupBaseByPinyinAndToneKey('tf', 'tf4', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['tf'],
      windowText: '下',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [4],
    }).hits;
    record({
      id: 'T6',
      path: 'tone',
      returned: raw.length,
      eligible: eligible(raw).length,
      final: hits.length,
      word: hits[0]?.hotword.word ?? null,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('下');
  });

  it('eligibility metamorphic: disabled + prior<=0 + alias mix under total=7 accept', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'em',
      tonePinyinKey: 'em1',
      words: ['唯', '惟', '维', '围', '违', '韦', '伪'],
      aliasIndices: [0, 1, 2],
      disabledIndices: [3, 4],
      idPrefix: 's4_em',
    });
    // prior<=0 on one remaining alias-slot candidate — set after build
    rows[5]!.priorScore = 0;
    const rt = boot(rows, 's4-em-');
    const raw = rt.lookupBaseByPinyinKey('em', 1, 8);
    // disabled filtered in SQL; prior<=0 and alias filtered in Recall
    expect(raw.length).toBeLessThan(8);
    const el = eligible(raw);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['em'],
      windowText: '伪',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'EM1',
      path: 'plain',
      returned: raw.length,
      eligible: el.length,
      final: hits.length,
      word: hits[0]?.hotword.word ?? null,
    });
    expect(el.length).toBe(1);
    expect(hits).toHaveLength(1);
  });

  it('cache: LIMIT=1 then LIMIT=8 and reverse do not cross-pollute counts', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ck',
      tonePinyinKey: 'ck1',
      words: ['仓', '苍', '沧', '舱', '藏', '糙', '操', '曹', '草'],
      aliasIndices: [],
      idPrefix: 's4_ck',
    });
    const rt = boot(rows, 's4-ck-');
    const a1 = rt.lookupBaseByPinyinKey('ck', 1, 1);
    const a8 = rt.lookupBaseByPinyinKey('ck', 1, 8);
    expect(a1.length).toBe(1);
    expect(a8.length).toBe(8);
    rt.clearLookupCaches();
    const b8 = rt.lookupBaseByPinyinKey('ck', 1, 8);
    const b1 = rt.lookupBaseByPinyinKey('ck', 1, 1);
    expect(b8.length).toBe(8);
    expect(b1.length).toBe(1);
    const tone1 = rt.lookupBaseByPinyinAndToneKey('ck', 'ck1', 1, 1);
    const tone8 = rt.lookupBaseByPinyinAndToneKey('ck', 'ck1', 1, 8);
    expect(tone1.length).toBe(1);
    expect(tone8.length).toBe(8);
    record({
      id: 'CACHE',
      plainOrder_1_then_8: [a1.length, a8.length],
      plainOrder_8_then_1: [b8.length, b1.length],
      tone_1_and_8: [tone1.length, tone8.length],
      safe: true,
    });
  });

  it('downstream: true unique → edge/path; exact-limit reject → no edge/vote', () => {
    const trueRows = buildSameKeyLength1Rows({
      pinyinKey: 'dn',
      tonePinyinKey: 'dn1',
      words: ['单'],
      idPrefix: 's4_dn',
    });
    let rt = boot(trueRows, 's4-dn-');
    const coord = buildUtteranceSyllableCoordinate('单');
    const w = makeWindow({
      windowId: '0:1',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      windowText: '单',
      windowPinyinKey: 'dn',
    });
    const sqlBefore = rt.getAndResetTierQueryStats().sqlQueries;
    const toneFix = makeCharToneFixtures('单', [1]);
    const recall = recallTopKForWindows({
      rawText: '单',
      globalSyllables: ['dn'],
      windows: [w],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      toneTimestampOnlyEnabled: true,
      acousticSlices: toneFix.acousticSlices,
      wordTimeSpans: toneFix.wordTimeSpans,
    });
    const sqlAfter = rt.getTierQueryStats().sqlQueries;
    expect(recall.candidates).toHaveLength(1);
    const edges = buildLexicalEdges({
      recalledWindows: [
        {
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          candidates: recall.candidates,
        },
      ],
    });
    expect(edges).toHaveLength(1);
    const path = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: 's4-true',
      rawText: '单',
      coordinate: coord,
      syllableCount: 1,
      lexicalEdges: edges,
    });
    expect(path.retainedCompletePathCount).toBeGreaterThanOrEqual(1);

    runtime?.close();
    bundle?.cleanup();
    const rejectRows = buildSameKeyLength1Rows({
      pinyinKey: 'dr',
      tonePinyinKey: 'dr1',
      words: ['多', '朵', '躲', '垛', '哚', '剁', '舵', '惰'],
      aliasIndices: [0, 1, 2, 3, 4, 5, 6],
      idPrefix: 's4_dr',
    });
    rt = boot(rejectRows, 's4-dr-');
    const recall2 = recallTopKForWindows({
      rawText: '惰',
      globalSyllables: ['dr'],
      windows: [
        makeWindow({
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          windowText: '惰',
          windowPinyinKey: 'dr',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      toneTimestampOnlyEnabled: false,
    });
    expect(recall2.candidates).toHaveLength(0);
    expect(
      buildLexicalEdges({
        recalledWindows: [
          {
            windowId: '0:1',
            syllableStart: 0,
            syllableEnd: 1,
            candidates: recall2.candidates,
          },
        ],
      })
    ).toHaveLength(0);
    expect(
      Object.keys(voteUtteranceDomainFromPool([{ candidates: recall2.candidates }]).domainScores)
    ).toHaveLength(0);
    record({
      id: 'DOWNSTREAM',
      trueUniquePath: true,
      exactLimitNoEdge: true,
      voteZero: true,
      sqlQueriesNote: 'tier stats peeked; length=1 uses single base lookup (no extra probe)',
      sqlBeforeReset: sqlBefore,
      sqlAfterPeek: sqlAfter,
    });
  });

  it('rank9 surface exact reachable after Batch 1.1B', () => {
    const words = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'rk',
      tonePinyinKey: 'rk1',
      words,
      aliasIndices: [],
      idPrefix: 's4_rk',
    });
    const rt = boot(rows, 's4-rk-');
    const raw = rt.lookupBaseByPinyinKey('rk', 1, 8);
    const hits = recallSpanTopKV2(rt, {
      syllables: ['rk'],
      windowText: '玖',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;
    record({
      id: 'RANK9',
      returned: raw.length,
      surfaceInFetch: raw.some((h) => h.word === '玖'),
      final: hits.length,
      resolvedBy: 'Batch 1.1B independent exact-surface lookup',
    });
    expect(raw.some((h) => h.word === '玖')).toBe(false);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.hotword.word).toBe('玖');
  });
});
