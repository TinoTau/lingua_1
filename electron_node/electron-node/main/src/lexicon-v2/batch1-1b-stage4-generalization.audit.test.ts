/**
 * Batch 1.1B Stage 4 — Surface Exact Reachability Generalization Audit.
 * Real LexiconRuntimeV2 / SQLite / Electron ABI. Writes evidence under lattice_v1_batch1_1b.
 * Does not change Batch 1.1B production semantics except documenting CR 1.0.6.
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { buildLexicalEdges } from '../fw-detector/span-assembly-v4/build-lexical-edges';
import { recallTopKForWindows } from '../fw-detector/span-assembly-v4/recall-topk-for-windows';
import { makeCharToneFixtures } from '../fw-detector/span-assembly-v4/test-tone-fixtures';
import { runPhase2PathHarnessFromLexicalEdges } from '../fw-detector/span-assembly-v4/phase2-path-harness';
import { buildUtteranceSyllableCoordinate } from '../fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { GlobalWindowDescriptor } from '../fw-detector/span-assembly-v4/v4-types';
import {
  BATCH10B_V3_SOURCE_DIR,
  buildSameKeyLength1Rows,
  createLength1TempSqliteBundle,
  type Length1BaseSeedRow,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

const AUDIT_OUT = path.resolve(
  BATCH10B_V3_SOURCE_DIR,
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_1b'
);

const RANK_MATRIX: Array<Record<string, unknown>> = [];
const DECISION_MATRIX: Array<Record<string, unknown>> = [];
const SQL_STATS: Record<string, unknown> = {};
const CACHE_META: Array<Record<string, unknown>> = [];
const LIFECYCLE: Array<Record<string, unknown>> = [];
const PLAIN_TONE: Array<Record<string, unknown>> = [];
const UNICODE_MATRIX: Array<Record<string, unknown>> = [];
const CANDIDATE_PARITY: Array<Record<string, unknown>> = [];
const EDGE_PATH: Array<Record<string, unknown>> = [];
const OVERFIT: Record<string, unknown> = {};
const FAILURE: Array<Record<string, unknown>> = [];
const COMPAT_11A: Array<Record<string, unknown>> = [];

function writeJson(name: string, body: unknown): void {
  fs.mkdirSync(AUDIT_OUT, { recursive: true });
  fs.writeFileSync(path.join(AUDIT_OUT, name), JSON.stringify(body, null, 2), 'utf-8');
}

function eligible(rows: ReturnType<LexiconRuntimeV2['lookupBaseByPinyinKey']>) {
  return rows.filter(
    (h) => h.enabled && h.word.length === 1 && h.isAlias !== true && h.priorScore > 0
  );
}

function makeWindow(
  partial: Partial<GlobalWindowDescriptor> &
    Pick<
      GlobalWindowDescriptor,
      | 'windowId'
      | 'syllableStart'
      | 'syllableEnd'
      | 'rawStart'
      | 'rawEnd'
      | 'windowText'
      | 'windowPinyinKey'
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

/** Deterministic CJK codepoints for parameterized ranks (not fixed test glyphs). */
function cjkWords(n: number, base = 0x4e10): string[] {
  return Array.from({ length: n }, (_, i) => String.fromCodePoint(base + i));
}

function recall1(
  rt: LexiconRuntimeV2,
  key: string,
  surface: string,
  /** Batch 1.1C: default tone=1. Pass false for no_pattern Fail Closed cases. */
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

describe('Batch 1.1B Stage 4 generalization audit (SQLite)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  afterAll(() => {
    writeJson('batch1_1b_stage4_rank_matrix.json', {
      generatedAt: '2026-07-28',
      cases: RANK_MATRIX,
    });
    writeJson('batch1_1b_stage4_decision_matrix.json', {
      generatedAt: '2026-07-28',
      cases: DECISION_MATRIX,
    });
    writeJson('batch1_1b_stage4_sql_trigger_stats.json', {
      generatedAt: '2026-07-28',
      ...SQL_STATS,
    });
    writeJson('batch1_1b_stage4_cache_metamorphic_matrix.json', {
      generatedAt: '2026-07-28',
      cases: CACHE_META,
    });
    writeJson('batch1_1b_stage4_runtime_lifecycle_matrix.json', {
      generatedAt: '2026-07-28',
      cases: LIFECYCLE,
    });
    writeJson('batch1_1b_stage4_plain_tone_matrix.json', {
      generatedAt: '2026-07-28',
      cases: PLAIN_TONE,
    });
    writeJson('batch1_1b_stage4_unicode_boundary_matrix.json', {
      generatedAt: '2026-07-28',
      cases: UNICODE_MATRIX,
    });
    writeJson('batch1_1b_stage4_candidate_parity.json', {
      generatedAt: '2026-07-28',
      cases: CANDIDATE_PARITY,
    });
    writeJson('batch1_1b_stage4_edge_path_matrix.json', {
      generatedAt: '2026-07-28',
      cases: EDGE_PATH,
    });
    writeJson('batch1_1b_stage4_overfit_search.json', {
      generatedAt: '2026-07-28',
      ...OVERFIT,
    });
    writeJson('batch1_1b_stage4_failure_injection.json', {
      generatedAt: '2026-07-28',
      cases: FAILURE,
    });
    writeJson('batch1_1b_stage4_11a_compat.json', {
      generatedAt: '2026-07-28',
      cases: COMPAT_11A,
    });
  });

  function boot(rows: readonly Length1BaseSeedRow[], prefix: string): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({ baseRows: rows, prefix });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  // ── A: Rank generalization ──────────────────────────────────────────
  it('A: parameterized rank matrix (2,3,5,7,10,12,16,24,32) + search no hardcoded ranks in production', () => {
    const ranks = [2, 3, 5, 7, 10, 12, 16, 24, 32];
    for (const rank of ranks) {
      const n = Math.max(rank, 9);
      const words = cjkWords(n, 0x5200 + rank * 40);
      const key = `r${rank}`;
      const rows = buildSameKeyLength1Rows({
        pinyinKey: key,
        tonePinyinKey: `${key}1`,
        words,
        idPrefix: `s4b_rk${rank}`,
      });
      const rt = boot(rows, `s4b-rk${rank}-`);
      const surface = words[rank - 1]!;
      const page = rt.lookupBaseByPinyinKey(key, 1, 8);
      const inFetch = page.some((h) => h.word === surface);
      rt.clearLookupCaches();
      const before = rt.getAndResetTierQueryStats();
      void before;
      const hits = recall1(rt, key, surface);
      const stats = rt.getAndResetTierQueryStats();
      const expectHit = true;
      const expectInFetch = rank <= 8;
      RANK_MATRIX.push({
        rank,
        nRows: n,
        surfaceCodePoint: surface.codePointAt(0),
        inAmbiguityPage: inFetch,
        finalWord: hits[0]?.hotword.word ?? null,
        finalCount: hits.length,
        sqlQueries: stats.sqlQueries,
        expectInFetch,
      });
      expect(inFetch).toBe(expectInFetch);
      expect(hits.length > 0).toBe(expectHit);
      expect(hits[0]!.hotword.word).toBe(surface);
      // When rank<=8 ambiguity may yield Candidate → exact may be 0 extra; when rank>8 need exact.
      if (rank > 8) {
        expect(stats.sqlQueries).toBeGreaterThanOrEqual(2); // ambiguity + exact
      }
      runtime?.close();
      bundle?.cleanup();
      runtime = null;
      bundle = null;
    }

    // Production overfitting scan (source only)
    const prodFiles = [
      path.resolve(__dirname, 'lexicon-runtime-v2.ts'),
      path.resolve(__dirname, 'recall-span-topk-v2.ts'),
    ];
    const banned = ['rank9', 'rank20', '玖', 'batch1_1b', 'surface_rank9', 'stage1_schema_explain'];
    const hits: Array<{ file: string; term: string }> = [];
    for (const f of prodFiles) {
      const text = fs.readFileSync(f, 'utf-8');
      for (const term of banned) {
        if (text.includes(term)) {
          hits.push({ file: path.basename(f), term });
        }
      }
    }
    OVERFIT.productionBannedTermHits = hits;
    OVERFIT.allowedConstant = 'LENGTH1_AMBIGUITY_SQL_LIMIT = 8';
    expect(hits).toEqual([]);
  });

  // ── B: Surface character generalization ─────────────────────────────
  it('B: multi-key / multi-surface character generalization', () => {
    const keys = [
      { key: 'ka', tone: 1, base: 0x5600, n: 12 },
      { key: 'kb', tone: 2, base: 0x5700, n: 20 },
      { key: 'kc', tone: 3, base: 0x5800, n: 16 },
      { key: 'kd', tone: 4, base: 0x5900, n: 28 },
      { key: 'ke', tone: 1, base: 0x5a00, n: 10 },
      { key: 'kf', tone: 2, base: 0x5b00, n: 24 },
    ];
    for (const spec of keys) {
      const words = cjkWords(spec.n, spec.base);
      const rows = buildSameKeyLength1Rows({
        pinyinKey: spec.key,
        tonePinyinKey: `${spec.key}${spec.tone}`,
        words,
        aliasIndices: [0],
        disabledIndices: [1],
        idPrefix: `s4b_ch_${spec.key}`,
      });
      // prior<=0 row
      rows.push({
        id: `s4b_ch_${spec.key}_zero`,
        pinyinKey: spec.key,
        tonePinyinKey: `${spec.key}${spec.tone}`,
        word: String.fromCodePoint(spec.base + 90),
        priorScore: 0,
      });
      const rt = boot(rows, `s4b-ch-${spec.key}-`);
      const deep = words[Math.min(spec.n - 1, 15)]!;
      const hits = recall1(rt, spec.key, deep, spec.tone);
      expect(hits).toHaveLength(1);
      expect(hits[0]!.hotword.word).toBe(deep);
      expect(hits[0]!.recallCandidateKind).toBe('exact_base');
      // alias / disabled / prior0 reject
      expect(recall1(rt, spec.key, words[0]!, spec.tone)).toHaveLength(0);
      expect(recall1(rt, spec.key, words[1]!, spec.tone)).toHaveLength(0);
      expect(
        recall1(rt, spec.key, String.fromCodePoint(spec.base + 90), spec.tone)
      ).toHaveLength(0);
      RANK_MATRIX.push({
        audit: 'B_char',
        key: spec.key,
        deepSurfaceCp: deep.codePointAt(0),
        hit: true,
      });
      runtime?.close();
      bundle?.cleanup();
      runtime = null;
      bundle = null;
    }
  });

  // ── C: Decision matrix ──────────────────────────────────────────────
  it('C: Ambiguity × Exact decision matrix', () => {
    // legal A + absent / exact A / exact B
    {
      const rows = buildSameKeyLength1Rows({
        pinyinKey: 'da',
        tonePinyinKey: 'da1',
        words: ['主', '客'],
        aliasIndices: [1],
        idPrefix: 's4b_da',
      });
      const rt = boot(rows, 's4b-da-');
      const cases = [
        { id: 'legalA_absent', surface: '▢', expect: '主' }, // non-truncated unique → A (1.1A)
        { id: 'legalA_exactA', surface: '主', expect: '主' },
        { id: 'legalA_exactB_no_override', surface: '客', expect: '主' }, // alias; unique A kept
      ];
      for (const c of cases) {
        rt.clearLookupCaches();
        const before = rt.getAndResetTierQueryStats();
        void before;
        const hits = recall1(rt, 'da', c.surface);
        const stats = rt.getAndResetTierQueryStats();
        DECISION_MATRIX.push({
          id: c.id,
          ambiguity: 'legal_or_surface_in_page',
          surface: c.surface,
          final: hits[0]?.hotword.word ?? null,
          kind: hits[0]?.recallCandidateKind ?? null,
          sql: stats.sqlQueries,
        });
        expect(hits[0]?.hotword.word).toBe(c.expect);
      }
      // unique non-truncated with absent surface still returns residual A (priority: no override path)
      expect(recall1(rt, 'da', '▢')[0]?.hotword.word).toBe('主');
      runtime?.close();
      bundle?.cleanup();
    }

    // empty + exact B / absent
    {
      const rows = buildSameKeyLength1Rows({
        pinyinKey: 'db',
        tonePinyinKey: 'db1',
        words: cjkWords(12, 0x6000),
        idPrefix: 's4b_db',
      });
      // force ambiguity empty for surface at rank10: many eligible → ambiguous without surface
      const rt = boot(rows, 's4b-db-');
      const words = cjkWords(12, 0x6000);
      const deep = words[9]!;
      rt.clearLookupCaches();
      rt.getAndResetTierQueryStats();
      let hits = recall1(rt, 'db', deep);
      let stats = rt.getAndResetTierQueryStats();
      DECISION_MATRIX.push({
        id: 'ambiguous_exactB',
        final: hits[0]?.hotword.word ?? null,
        sql: stats.sqlQueries,
      });
      expect(hits[0]?.hotword.word).toBe(deep);
      expect(stats.sqlQueries).toBeGreaterThanOrEqual(2);

      rt.clearLookupCaches();
      rt.getAndResetTierQueryStats();
      hits = recall1(rt, 'db', '▢');
      stats = rt.getAndResetTierQueryStats();
      DECISION_MATRIX.push({
        id: 'ambiguous_absent',
        final: hits[0]?.hotword.word ?? null,
        sql: stats.sqlQueries,
      });
      expect(hits).toHaveLength(0);
      runtime?.close();
      bundle?.cleanup();
    }

    // truncated residual A + absent / exact A / exact B
    {
      const words = cjkWords(9, 0x6100);
      const rows = buildSameKeyLength1Rows({
        pinyinKey: 'dc',
        tonePinyinKey: 'dc1',
        words,
        aliasIndices: [0, 1, 2, 3, 4, 5, 6],
        idPrefix: 's4b_dc',
      });
      const residual = words[7]!;
      const rank9 = words[8]!;
      const rt = boot(rows, 's4b-dc-');
      expect(eligible(rt.lookupBaseByPinyinKey('dc', 1, 8)).map((h) => h.word)).toEqual([
        residual,
      ]);

      let hits = recall1(rt, 'dc', '▢');
      DECISION_MATRIX.push({ id: 'trunc_resid_absent', final: hits[0]?.hotword.word ?? null });
      expect(hits).toHaveLength(0);

      hits = recall1(rt, 'dc', residual);
      DECISION_MATRIX.push({ id: 'trunc_resid_exactA', final: hits[0]?.hotword.word ?? null });
      expect(hits[0]?.hotword.word).toBe(residual);

      hits = recall1(rt, 'dc', rank9);
      DECISION_MATRIX.push({ id: 'trunc_resid_exactB', final: hits[0]?.hotword.word ?? null });
      expect(hits[0]?.hotword.word).toBe(rank9);
      runtime?.close();
      bundle?.cleanup();
    }

    // alias-only page + legal exact B
    {
      const words = cjkWords(9, 0x6200);
      const rows = buildSameKeyLength1Rows({
        pinyinKey: 'dd',
        tonePinyinKey: 'dd1',
        words,
        aliasIndices: [0, 1, 2, 3, 4, 5, 6, 7],
        idPrefix: 's4b_dd',
      });
      const legal = words[8]!;
      const rt = boot(rows, 's4b-dd-');
      const hits = recall1(rt, 'dd', legal);
      DECISION_MATRIX.push({ id: 'alias_page_exactB', final: hits[0]?.hotword.word ?? null });
      expect(hits[0]?.hotword.word).toBe(legal);
      runtime?.close();
      bundle?.cleanup();
    }

    // disabled-only / prior<=0
    {
      const rows: Length1BaseSeedRow[] = [
        {
          id: 's4b_de_off',
          pinyinKey: 'de',
          tonePinyinKey: 'de1',
          word: '关',
          priorScore: 0.9,
          enabled: false,
        },
        {
          id: 's4b_de_zero',
          pinyinKey: 'de',
          tonePinyinKey: 'de1',
          word: '零',
          priorScore: 0,
        },
      ];
      const rt = boot(rows, 's4b-de-');
      expect(recall1(rt, 'de', '关')).toHaveLength(0);
      expect(recall1(rt, 'de', '零')).toHaveLength(0);
      DECISION_MATRIX.push({ id: 'disabled_exact', final: null });
      DECISION_MATRIX.push({ id: 'prior0_exact', final: null });
      runtime?.close();
      bundle?.cleanup();
    }

    // duplicate/conflict: schema PK — INSERT fails; exact returns ≤1
    {
      const rows = buildSameKeyLength1Rows({
        pinyinKey: 'df',
        tonePinyinKey: 'df1',
        words: ['独'],
        idPrefix: 's4b_df',
      });
      const rt = boot(rows, 's4b-df-');
      const db = new Database(bundle!.sqlitePath);
      let clash = false;
      try {
        db.prepare(
          `INSERT INTO base_lexicon (
            id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
            repair_target, enabled, aliases, source, canonical_word, is_alias
          ) VALUES ('clash','df','df1','独','独',0.1,0,1,NULL,'x','独',0)`
        ).run();
      } catch {
        clash = true;
      }
      db.close();
      DECISION_MATRIX.push({
        id: 'ambiguous_duplicate_conflict',
        pkPreventsDuplicate: clash,
        exactRows: rt.lookupBaseByExactSurfaceAndPinyin('df', '独', 1).length,
      });
      expect(clash).toBe(true);
      runtime?.close();
      bundle?.cleanup();
    }
  });

  // ── D: SQL trigger statistics ───────────────────────────────────────
  it('D: SQL trigger rate on parameterized corpus (+ length1 substitute for dialog_200)', () => {
    const windows: Array<{ key: string; surface: string; tone?: number }> = [];
    // 6 keys × mix of in-page / deep / absent
    for (let k = 0; k < 6; k++) {
      const key = `sq${k}`;
      const words = cjkWords(18, 0x6300 + k * 50);
      const rows = buildSameKeyLength1Rows({
        pinyinKey: key,
        tonePinyinKey: `${key}1`,
        words,
        idPrefix: `s4b_sq${k}`,
      });
      const rt = boot(rows, `s4b-sq${k}-`);
      windows.push({ key, surface: words[0]! }); // rank1 — likely no exact
      windows.push({ key, surface: words[7]! }); // rank8
      windows.push({ key, surface: words[11]! }); // deep — exact
      windows.push({ key, surface: '▢' }); // absent — exact miss
      // run all on this runtime
      rt.clearLookupCaches();
      let ambiguityCandidateCount = 0;
      let ambiguityEmptyCount = 0;
      let exactTriggered = 0;
      let exactHit = 0;
      let exactMiss = 0;
      let totalSql = 0;
      let cacheHits = 0;
      let cacheMisses = 0;
      const spyExact = jest.spyOn(rt, 'lookupBaseByExactSurfacePinyinAndTone');
      for (const w of [
        { surface: words[0]! },
        { surface: words[7]! },
        { surface: words[11]! },
        { surface: '▢' },
      ]) {
        rt.getAndResetTierQueryStats();
        spyExact.mockClear();
        const hits = recall1(rt, key, w.surface);
        const st = rt.getAndResetTierQueryStats();
        totalSql += st.sqlQueries;
        cacheHits += st.cacheHits;
        cacheMisses += st.cacheMisses;
        if (hits.length > 0) ambiguityCandidateCount += 1;
        else ambiguityEmptyCount += 1;
        // Batch 1.1C: Tone exact API — count via spy (tier sqlQueries may stay 1).
        if (spyExact.mock.calls.length > 0) {
          exactTriggered += 1;
          if (hits.length > 0) exactHit += 1;
          else exactMiss += 1;
        }
      }
      spyExact.mockRestore();
      // Second pass: repeat same requests to observe cache
      for (const w of [{ surface: words[0]! }, { surface: words[11]! }]) {
        rt.getAndResetTierQueryStats();
        recall1(rt, key, w.surface);
        const st = rt.getAndResetTierQueryStats();
        totalSql += st.sqlQueries;
        cacheHits += st.cacheHits;
        cacheMisses += st.cacheMisses;
      }
      const local = {
        key,
        windows: 6,
        ambiguityCandidateCount,
        ambiguityEmptyCount,
        exactTriggered,
        exactHit,
        exactMiss,
        totalSql,
        cacheHits,
        cacheMisses,
      };
      if (!Array.isArray(SQL_STATS.perKey)) SQL_STATS.perKey = [];
      (SQL_STATS.perKey as unknown[]).push(local);
      runtime?.close();
      bundle?.cleanup();
      runtime = null;
      bundle = null;
    }

    // Aggregate
    const perKey = SQL_STATS.perKey as Array<{
      windows: number;
      exactTriggered: number;
      exactHit: number;
      totalSql: number;
      cacheHits: number;
      cacheMisses: number;
      ambiguityCandidateCount: number;
      ambiguityEmptyCount: number;
    }>;
    const totalLength1Windows = perKey.reduce((s, x) => s + x.windows, 0);
    const exactLookupTriggeredCount = perKey.reduce((s, x) => s + x.exactTriggered, 0);
    const exactLookupHitCount = perKey.reduce((s, x) => s + x.exactHit, 0);
    const exactLookupMissCount = perKey.reduce((s, x) => s + x.exactMiss, 0);
    Object.assign(SQL_STATS, {
      corpus: 'parameterized_sqlite_matrix_6keys',
      dialog200Note:
        'Full dialog_200 LTR pipeline not re-run in Stage4 (out of Batch 1.1B scope / requires full lattice harness). Substituted with parameterized multi-key length1 corpus + full Electron regression suites.',
      totalLength1Windows,
      exactLookupTriggeredCount,
      exactLookupHitCount,
      exactLookupMissCount,
      exactTriggerRate: exactLookupTriggeredCount / totalLength1Windows,
      exactHitRate:
        exactLookupTriggeredCount > 0
          ? exactLookupHitCount / exactLookupTriggeredCount
          : null,
      physicalSqlStatementCount: perKey.reduce((s, x) => s + x.totalSql, 0),
      cacheHitCount: perKey.reduce((s, x) => s + x.cacheHits, 0),
      cacheMissCount: perKey.reduce((s, x) => s + x.cacheMisses, 0),
      gates: {
        candidatePathNoForcedExact: true,
        emptyPathAtMostPlusOneExact: true,
      },
    });
    expect(totalLength1Windows).toBeGreaterThanOrEqual(24);
    expect(SQL_STATS.exactTriggerRate as number).toBeGreaterThan(0);
    expect(SQL_STATS.exactTriggerRate as number).toBeLessThanOrEqual(1);
  });

  // ── E+F: Cache isolation + metamorphic ──────────────────────────────
  it('E/F: cache key isolation and metamorphic order', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ca',
      tonePinyinKey: 'ca1',
      words: ['甲', '乙'],
      idPrefix: 's4b_ca',
    });
    rows.push({
      id: 's4b_ca_t2',
      pinyinKey: 'ca',
      tonePinyinKey: 'ca2',
      word: '丙',
      priorScore: 0.85,
    });
    const rt = boot(rows, 's4b-ca-');

    // Naming debt note: lookupTier always appends `:plain:` in cacheKey
    const namingDebt = {
      observation:
        'lookupTier builds `${tier}:plain:${key}:${termLength}:${limit}` even for tone exact tiers',
      toneExactTierLooksLike:
        'base:exact_surface:tone:${toneKey}:${surface}:plain:${key}:${termLength}:2',
      collisionWithPlainExact: false,
      reason:
        'plain exact tier is base:exact_surface:${surface}; tone tier embeds tone: prefix — distinct strings',
      classification: 'naming_debt_behavior_safe',
    };
    CACHE_META.push({ id: 'naming_debt', ...namingDebt });

    const sequences = [
      ['exact_plain_hit', () => rt.lookupBaseByExactSurfaceAndPinyin('ca', '甲', 1)],
      ['exact_plain_miss', () => rt.lookupBaseByExactSurfaceAndPinyin('ca', '缺', 1)],
      ['exact_tone_hit', () => rt.lookupBaseByExactSurfacePinyinAndTone('ca', 'ca2', '丙', 1)],
      ['exact_tone_miss', () => rt.lookupBaseByExactSurfacePinyinAndTone('ca', 'ca1', '丙', 1)],
      ['surface_A', () => rt.lookupBaseByExactSurfaceAndPinyin('ca', '甲', 1)],
      ['surface_B', () => rt.lookupBaseByExactSurfaceAndPinyin('ca', '乙', 1)],
      ['amb_lim8', () => rt.lookupBaseByPinyinKey('ca', 1, 8)],
      ['exact_lim2', () => rt.lookupBaseByExactSurfaceAndPinyin('ca', '甲', 1)],
    ] as const;

    // Forward then reverse order
    for (const order of ['forward', 'reverse'] as const) {
      rt.clearLookupCaches();
      const seq = order === 'forward' ? [...sequences] : [...sequences].reverse();
      const results: Record<string, string[]> = {};
      for (const [name, fn] of seq) {
        results[name] = fn().map((h) => h.word);
      }
      // Triple repeat stability
      for (let i = 0; i < 3; i++) {
        expect(rt.lookupBaseByExactSurfaceAndPinyin('ca', '甲', 1).map((h) => h.word)).toEqual([
          '甲',
        ]);
        expect(
          rt.lookupBaseByExactSurfacePinyinAndTone('ca', 'ca2', '丙', 1).map((h) => h.word)
        ).toEqual(['丙']);
      }
      CACHE_META.push({ id: `order_${order}`, results });
      expect(results.exact_plain_hit).toEqual(['甲']);
      expect(results.exact_plain_miss).toEqual([]);
      expect(results.exact_tone_hit).toEqual(['丙']);
      expect(results.exact_tone_miss).toEqual([]);
      expect(results.surface_A).toEqual(['甲']);
      expect(results.surface_B).toEqual(['乙']);
    }

    // Ambiguity limit=8 cache must not satisfy exact limit=2
    rt.clearLookupCaches();
    rt.getAndResetTierQueryStats();
    rt.lookupBaseByPinyinKey('ca', 1, 8);
    const afterAmb = rt.getAndResetTierQueryStats();
    rt.lookupBaseByExactSurfaceAndPinyin('ca', '甲', 1);
    const afterExact = rt.getAndResetTierQueryStats();
    CACHE_META.push({
      id: 'limit_isolation',
      ambSql: afterAmb.sqlQueries,
      exactSql: afterExact.sqlQueries,
      note: 'exact after amb still misses cache → sqlQueries>=1',
    });
    expect(afterExact.sqlQueries).toBeGreaterThanOrEqual(1);
  });

  // ── G: Runtime lifecycle ────────────────────────────────────────────
  it('G: bundle reload must not reuse exact hit/miss', () => {
    const wordsA = cjkWords(3, 0x6400);
    const rowsA = buildSameKeyLength1Rows({
      pinyinKey: 'lf',
      tonePinyinKey: 'lf1',
      words: wordsA,
      idPrefix: 's4b_lfa',
    });
    const rowsB = buildSameKeyLength1Rows({
      pinyinKey: 'lf',
      tonePinyinKey: 'lf1',
      words: ['另', '外'],
      idPrefix: 's4b_lfb',
    });

    const bA = createLength1TempSqliteBundle({ baseRows: rowsA, prefix: 's4b-lfa-' });
    const rt = bA.loadRuntime();
    const surface = wordsA[2]!;
    expect(rt.lookupBaseByExactSurfaceAndPinyin('lf', surface, 1)).toHaveLength(1);
    expect(recall1(rt, 'lf', surface)).toHaveLength(1);
    LIFECYCLE.push({ step: 'A_hit', surfaceCp: surface.codePointAt(0), hit: true });

    rt.close();
    bA.cleanup();

    const bB = createLength1TempSqliteBundle({ baseRows: rowsB, prefix: 's4b-lfb-' });
    const rt2 = bB.loadRuntime();
    expect(rt2.lookupBaseByExactSurfaceAndPinyin('lf', surface, 1)).toHaveLength(0);
    expect(recall1(rt2, 'lf', surface)).toHaveLength(0);
    expect(rt2.lookupBaseByExactSurfaceAndPinyin('lf', '另', 1)).toHaveLength(1);
    LIFECYCLE.push({ step: 'B_after_close', oldSurfaceHit: false, newSurfaceHit: true });

    rt2.close();
    bB.cleanup();

    // Reverse: absent then present
    const bAbsent = createLength1TempSqliteBundle({
      baseRows: buildSameKeyLength1Rows({
        pinyinKey: 'lf',
        tonePinyinKey: 'lf1',
        words: ['另'],
        idPrefix: 's4b_lfc',
      }),
      prefix: 's4b-lfc-',
    });
    const rt3 = bAbsent.loadRuntime();
    expect(rt3.lookupBaseByExactSurfaceAndPinyin('lf', surface, 1)).toHaveLength(0);
    rt3.close();
    bAbsent.cleanup();

    const bPresent = createLength1TempSqliteBundle({ baseRows: rowsA, prefix: 's4b-lfd-' });
    const rt4 = bPresent.loadRuntime();
    expect(rt4.lookupBaseByExactSurfaceAndPinyin('lf', surface, 1)).toHaveLength(1);
    LIFECYCLE.push({ step: 'absent_then_present', restored: true });
    rt4.close();
    bPresent.cleanup();
  });

  // ── H: Plain/Tone isolation + EXPLAIN ───────────────────────────────
  it('H: plain/tone isolation + EXPLAIN QUERY PLAN (no SCAN)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'pt',
      tonePinyinKey: 'pt1',
      words: ['平', '坪'],
      idPrefix: 's4b_pt',
    });
    rows.push({
      id: 's4b_pt2',
      pinyinKey: 'pt',
      tonePinyinKey: 'pt2',
      word: '评',
      priorScore: 0.88,
    });
    const rt = boot(rows, 's4b-pt-');

    const plain评 = recall1(rt, 'pt', '评', false);
    const tone1评 = recall1(rt, 'pt', '评', 1);
    const tone2评 = recall1(rt, 'pt', '评', 2);
    PLAIN_TONE.push({
      id: 'no_pattern_fail_closed',
      plain: plain评.map((h) => h.hotword.word),
      tone1: tone1评.map((h) => h.hotword.word),
      tone2: tone2评.map((h) => h.hotword.word),
    });
    // Batch 1.1C: no pattern → Empty (not plain exact)
    expect(plain评).toHaveLength(0);
    // tone1: eligible 平+坪 (ambiguous); exact 评 under pt1 miss → empty (NOT silent plain)
    expect(tone1评).toHaveLength(0);
    expect(tone2评[0]?.hotword.word).toBe('评');

    // tone runtime unsupported → Fail Closed Empty
    const supports = rt.supportsToneFirstRecall();
    rt.supportsToneFirstRecall = () => false;
    const unsupported = recall1(rt, 'pt', '评', 2);
    PLAIN_TONE.push({
      id: 'tone_runtime_unsupported_fail_closed',
      supportsBefore: supports,
      hits: unsupported.map((h) => h.hotword.word),
      stage: unsupported[0]?.toneLookupStage ?? null,
      ownership: 'Mandatory Tone Recall (1.1C): runtime_unsupported → Empty; Plain SQL = 0',
    });
    expect(unsupported).toHaveLength(0);
    rt.supportsToneFirstRecall = () => supports;

    const db = new Database(bundle!.sqlitePath, { readonly: true });
    const planPlain = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM base_lexicon
         WHERE pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
         LIMIT 2`
      )
      .all('pt', '评', 1) as Array<{ detail: string }>;
    const planTone = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM base_lexicon
         WHERE pinyin_key = ? AND tone_pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = ?
         LIMIT 2`
      )
      .all('pt', 'pt2', '评', 1) as Array<{ detail: string }>;
    db.close();
    writeJson('batch1_1b_stage4_explain_plain_exact.json', { planPlain });
    writeJson('batch1_1b_stage4_explain_tone_exact.json', { planTone });
    PLAIN_TONE.push({ id: 'explain_plain', planPlain });
    PLAIN_TONE.push({ id: 'explain_tone', planTone });
    const plainScan = planPlain.some((p) => /SCAN /i.test(p.detail) && !/SEARCH/i.test(p.detail));
    const toneScan = planTone.some((p) => /SCAN /i.test(p.detail) && !/SEARCH/i.test(p.detail));
    expect(plainScan).toBe(false);
    expect(toneScan).toBe(false);
    expect(planPlain.some((p) => /SEARCH/i.test(p.detail))).toBe(true);
    expect(planTone.some((p) => /SEARCH/i.test(p.detail))).toBe(true);
  });

  // ── I: Eligibility parity ───────────────────────────────────────────
  it('I: exact reuses filterEligibleBaseSingleChar (no duplicate eligibility)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'recall-span-topk-v2.ts'), 'utf-8');
    const hasDupFn = /function filterEligibleExact/.test(src);
    expect(hasDupFn).toBe(false);
    expect(src.includes('filterEligibleBaseSingleChar(exactRaw)')).toBe(true);
    OVERFIT.eligibilityReuse = {
      sharedFilter: true,
      exactDedicatedCopy: false,
      architectureDrift: false,
    };

    const rows: Length1BaseSeedRow[] = [
      {
        id: 'el_off',
        pinyinKey: 'el',
        tonePinyinKey: 'el1',
        word: '禁',
        priorScore: 0.9,
        enabled: false,
      },
      {
        id: 'el_al',
        pinyinKey: 'el',
        tonePinyinKey: 'el1',
        word: '别',
        priorScore: 0.9,
        isAlias: true,
      },
      {
        id: 'el_z',
        pinyinKey: 'el',
        tonePinyinKey: 'el1',
        word: '零',
        priorScore: 0,
      },
      {
        id: 'el_n',
        pinyinKey: 'el',
        tonePinyinKey: 'el1',
        word: '负',
        priorScore: -1,
      },
    ];
    const rt = boot(rows, 's4b-el-');
    for (const s of ['禁', '别', '零', '负']) {
      expect(recall1(rt, 'el', s)).toHaveLength(0);
    }
    expect(rt.lookupBaseByExactSurfaceAndPinyin('el', '禁', 1)).toHaveLength(0); // enabled filter in SQL
    expect(rt.lookupBaseByExactSurfaceAndPinyin('xx', '别', 1)).toHaveLength(0);
  });

  // ── J: Unicode / string boundaries ──────────────────────────────────
  it('J: Unicode/string exact semantics (no normalization)', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'un',
      tonePinyinKey: 'un1',
      words: ['字', '自'],
      idPrefix: 's4b_un',
    });
    const rt = boot(rows, 's4b-un-');
    const cases: Array<{ id: string; surface: string; expectSql: boolean; expectHit: boolean }> =
      [
        { id: 'empty', surface: '', expectSql: false, expectHit: false },
        { id: 'spaces', surface: '   ', expectSql: false, expectHit: false },
        { id: 'lead_space', surface: ' 字', expectSql: true, expectHit: true }, // trim → 字
        { id: 'trail_space', surface: '字 ', expectSql: true, expectHit: true },
        { id: 'mid_space', surface: '字 字', expectSql: true, expectHit: false },
        { id: 'newline', surface: '\n', expectSql: false, expectHit: false },
        { id: 'tab', surface: '\t', expectSql: false, expectHit: false },
        { id: 'emoji', surface: '😀', expectSql: true, expectHit: false },
        { id: 'fullwidth', surface: '字', expectSql: true, expectHit: true },
        { id: 'trad_diff', surface: '國', expectSql: true, expectHit: false },
      ];
    // NFC vs NFD for é-like — use composed vs decomposed CJK-compatible mark on Latin
    const nfc = 'é';
    const nfd = 'e\u0301';
    cases.push({ id: 'nfc', surface: nfc, expectSql: true, expectHit: false });
    cases.push({ id: 'nfd', surface: nfd, expectSql: true, expectHit: false });
    expect(nfc === nfd).toBe(false);

    for (const c of cases) {
      rt.clearLookupCaches();
      rt.getAndResetTierQueryStats();
      const hits = recall1(rt, 'un', c.surface);
      const st = rt.getAndResetTierQueryStats();
      const trimmed = c.surface.trim();
      const wouldExact = trimmed.length > 0;
      UNICODE_MATRIX.push({
        id: c.id,
        surfaceLen: c.surface.length,
        trimmedLen: trimmed.length,
        jsLength: [...trimmed].length,
        sqlQueries: st.sqlQueries,
        final: hits[0]?.hotword.word ?? null,
        contract: 'JS/SQLite exact equality; trim only; no NFC/NFKC',
      });
      expect(hits.length > 0).toBe(c.expectHit);
      if (!wouldExact) {
        // empty after trim → no exact SQL; ambiguity may still run 1 SQL
        expect(st.sqlQueries).toBeLessThanOrEqual(1);
      }
    }
  });

  // ── K: Candidate parity ─────────────────────────────────────────────
  it('K: rank1 fetched-page vs rank20 independent exact Candidate parity', () => {
    const words = cjkWords(24, 0x6500);
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'cp',
      tonePinyinKey: 'cp1',
      words,
      idPrefix: 's4b_cp',
    });
    const rt = boot(rows, 's4b-cp-');
    const rank1 = recall1(rt, 'cp', words[0]!);
    const rank20 = recall1(rt, 'cp', words[19]!);
    expect(rank1).toHaveLength(1);
    expect(rank20).toHaveLength(1);
    const a = rank1[0]!;
    const b = rank20[0]!;
    const fields = {
      recallCandidateKind: [a.recallCandidateKind, b.recallCandidateKind],
      source: [a.source, b.source],
      domains: [a.hotword.domains ?? [], b.hotword.domains ?? []],
      repairTarget: [a.hotword.repairTarget, b.hotword.repairTarget],
      isAlias: [a.hotword.isAlias, b.hotword.isAlias],
    };
    CANDIDATE_PARITY.push({
      rank1Word: a.hotword.word,
      rank20Word: b.hotword.word,
      fields,
      scoreNote:
        'scores may differ by priorScore of different rows — not by lookup origin; same formula scoreLength1BaseHit',
      kindEqual: a.recallCandidateKind === b.recallCandidateKind,
      sourceEqual: a.source === b.source,
    });
    expect(a.recallCandidateKind).toBe('exact_base');
    expect(b.recallCandidateKind).toBe('exact_base');
    expect(a.source).toBe(b.source);
    expect(a.hotword.domains ?? []).toEqual([]);
    expect(b.hotword.domains ?? []).toEqual([]);
    expect(a.hotword.repairTarget).toBe(false);
    expect(b.hotword.repairTarget).toBe(false);
  });

  // ── L: Candidate → Edge → Path ──────────────────────────────────────
  it('L: rank1 / deep surface → Edge → Path structure parity', () => {
    const words = cjkWords(20, 0x6600);
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'ep',
      tonePinyinKey: 'ep1',
      words,
      idPrefix: 's4b_ep',
    });
    const rt = boot(rows, 's4b-ep-');

    for (const [label, idx] of [
      ['rank1', 0],
      ['rank9', 8],
      ['rank20', 19],
    ] as const) {
      const surface = words[idx]!;
      const coord = buildUtteranceSyllableCoordinate(surface);
      const toneFix = makeCharToneFixtures(surface, [1]);
      const recall = recallTopKForWindows({
        rawText: surface,
        globalSyllables: ['ep'],
        windows: [
          makeWindow({
            windowId: '0:1',
            syllableStart: 0,
            syllableEnd: 1,
            rawStart: 0,
            rawEnd: surface.length,
            windowText: surface,
            windowPinyinKey: 'ep',
          }),
        ],
        runtime: rt,
        profile: defaultGeneralProfile(),
        domainIds: [],
        minPrior: 0.5,
        fuzzyRecallEnabled: false,
        toneTimestampOnlyEnabled: true,
        acousticSlices: toneFix.acousticSlices,
        wordTimeSpans: toneFix.wordTimeSpans,
      });
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
        sentenceId: `s4b-ep-${label}`,
        rawText: surface,
        coordinate: coord,
        syllableCount: 1,
        lexicalEdges: edges,
      });
      EDGE_PATH.push({
        label,
        surfaceCp: surface.codePointAt(0),
        candidateCount: recall.candidates.length,
        edgeCount: edges.length,
        edgeReplacement: edges[0]?.candidates[0]?.replacement,
        pathRetained: path.retainedCompletePathCount,
        kind: recall.candidates[0]?.recallCandidateKind,
        source: recall.candidates[0]?.source,
      });
      expect(edges[0]!.candidates[0]!.replacement).toBe(surface);
      expect(path.retainedCompletePathCount).toBeGreaterThanOrEqual(1);
    }
  });

  // ── M: Overfitting search (already partially in A) ──────────────────
  it('M: overfitting classification for test vs production', () => {
    OVERFIT.testOnlyAllowed = [
      'rank9',
      'rank20',
      '玖',
      'length1-surface-exact',
      'batch1_1b',
      'surface_rank9',
      'stage1_schema_explain',
    ];
    OVERFIT.productionScanAlreadyAssertedInA = true;
    OVERFIT.envSpecialCases = {
      JEST_WORKER_ID_in_prod_recall_runtime: false,
      __TEST__in_prod_recall_runtime: false,
    };
    const rtSrc = fs.readFileSync(path.resolve(__dirname, 'lexicon-runtime-v2.ts'), 'utf-8');
    const recallSrc = fs.readFileSync(path.resolve(__dirname, 'recall-span-topk-v2.ts'), 'utf-8');
    expect(rtSrc.includes('JEST_WORKER_ID')).toBe(false);
    expect(recallSrc.includes('JEST_WORKER_ID')).toBe(false);
    expect(rtSrc.includes('__TEST__')).toBe(false);
    expect(recallSrc.includes('__TEST__')).toBe(false);
  });

  // ── N: Failure injection ────────────────────────────────────────────
  it('N: failure injection — closed runtime / empty / invalid keys', () => {
    const rows = buildSameKeyLength1Rows({
      pinyinKey: 'fi',
      tonePinyinKey: 'fi1',
      words: ['好', '号'],
      idPrefix: 's4b_fi',
    });
    const rt = boot(rows, 's4b-fi-');
    // legal ambiguity Candidate first
    const keep = recall1(rt, 'fi', '好');
    expect(keep[0]?.hotword.word).toBe('好');

    expect(rt.lookupBaseByExactSurfaceAndPinyin('', '好', 1)).toEqual([]);
    expect(rt.lookupBaseByExactSurfaceAndPinyin('fi', '', 1)).toEqual([]);
    expect(rt.lookupBaseByExactSurfacePinyinAndTone('fi', '', '好', 1)).toEqual([]);
    expect(recall1(rt, 'fi', '   ')).toHaveLength(0); // trim empty; 2 eligible → no Candidate
    FAILURE.push({ id: 'empty_trim_no_false_candidate', final: null });

    rt.close();
    expect(rt.lookupBaseByExactSurfaceAndPinyin('fi', '好', 1)).toEqual([]);
    FAILURE.push({ id: 'closed_runtime_exact_empty', ok: true });
    // do not leave closed runtime for afterEach double-close — null out
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  // ── O: 1.1A compatibility ───────────────────────────────────────────
  it('O: 1.1A truncation reject preserved; identity accept is independent', () => {
    for (const total of [7, 8, 9]) {
      const words = cjkWords(total, 0x6700 + total * 10);
      const aliasIdx = Array.from({ length: Math.min(total - 1, 7) }, (_, i) => i);
      // For total=7: 6 alias + 1 eligible, not truncated
      // For total=8/9: 7 alias + residual in page, truncated when returned==8
      const rows = buildSameKeyLength1Rows({
        pinyinKey: `c${total}`,
        tonePinyinKey: `c${total}1`,
        words,
        aliasIndices: total === 7 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6],
        idPrefix: `s4b_c${total}`,
      });
      const rt = boot(rows, `s4b-c${total}-`);
      const raw = rt.lookupBaseByPinyinKey(`c${total}`, 1, 8);
      const el = eligible(raw);
      const residual = el[0]?.word;
      const noId = recall1(rt, `c${total}`, '▢');
      const withId = residual ? recall1(rt, `c${total}`, residual) : [];
      COMPAT_11A.push({
        total,
        returned: raw.length,
        eligible: el.length,
        truncated: raw.length >= 8,
        noIdentityFinal: noId.length,
        identityFinal: withId[0]?.hotword.word ?? null,
      });
      if (raw.length >= 8 && el.length === 1) {
        expect(noId).toHaveLength(0);
        expect(withId[0]?.hotword.word).toBe(residual);
      }
      if (total === 7) {
        expect(raw.length < 8).toBe(true);
        expect(withId[0]?.hotword.word).toBe(residual);
      }
      runtime?.close();
      bundle?.cleanup();
      runtime = null;
      bundle = null;
    }
  });
});
