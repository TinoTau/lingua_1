/**
 * Batch 1.0C — length=1 Recall / Runtime / SQLite integration (real LexiconRuntimeV2).
 * Run under Electron ABI: ELECTRON_RUN_AS_NODE=1 electron jest ...
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
  batch10bDomainGuardRows,
  batch10bLimit8Rows,
  batch10bStandardBaseRows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

const AUDIT_OUT = path.resolve(
  BATCH10B_V3_SOURCE_DIR,
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_0c'
);

describe('Batch 1.0C SQLite/Recall integration (length=1)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  function boot(extra?: {
    baseRows?: ReturnType<typeof batch10bStandardBaseRows>;
    withDomainGuard?: boolean;
    prefix?: string;
  }): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({
      baseRows: extra?.baseRows ?? batch10bStandardBaseRows(),
      domainRows: extra?.withDomainGuard ? batch10bDomainGuardRows() : [],
      prefix: extra?.prefix ?? 'b0c-recall-',
    });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('SQLite Integration: seeded base rows exist on disk (raw SQL)', () => {
    bundle = createLength1TempSqliteBundle({
      baseRows: batch10bStandardBaseRows(),
      prefix: 'b0c-raw-',
    });
    const db = new Database(bundle.sqlitePath, { readonly: true });
    try {
      const row = db
        .prepare(
          `SELECT word, prior_score, repair_target, enabled, is_alias, source, tone_pinyin_key
           FROM base_lexicon WHERE id = ?`
        )
        .get('b0b_repair') as {
        word: string;
        repair_target: number;
        enabled: number;
        is_alias: number;
        tone_pinyin_key: string;
      };
      expect(row.word).toBe('修');
      expect(row.repair_target).toBe(1);
      expect(row.enabled).toBe(1);
      expect(row.is_alias).toBe(0);
      expect(row.tone_pinyin_key).toBe('xiu1');
    } finally {
      db.close();
    }
  });

  it('Runtime Integration: LexiconRuntimeV2 loads temp bundle status=ok', () => {
    const rt = boot();
    expect(rt.getState().status).toBe('ok');
    expect(rt.supportsToneFirstRecall()).toBe(true);
  });

  it('Recall Integration: base length=1 yields 1 Candidate (source/domains/repairTarget)', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['wo'],
      windowText: '我',
      termLength: 1,
      topK: 2,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      acousticTonePattern: [3],
    });
    expect(result.hits).toHaveLength(1);
    const hit = result.hits[0]!;
    expect(hit.hotword.word).toBe('我');
    expect(hit.recallCandidateKind).toBe('exact_base');
    expect(hit.hotword.domains ?? []).toEqual([]);
    expect(hit.hotword.repairTarget).toBe(false);
    expect(hit.hotword.word.length).toBe(1);
  });

  it('Recall Integration: base tone length=1 yields Candidate (点)', () => {
    const rt = boot();
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
    expect(result.hits[0]!.hotword.domains ?? []).toEqual([]);
    expect(result.hits[0]!.hotword.repairTarget).toBe(false);
  });

  it('Recall Integration: alias is_alias=1 filtered; disabled yields empty', () => {
    const rt = boot();
    // dian has 点 + alias 惦 → after filter only 点 → unique
    const dian = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    });
    expect(dian.hits.map((h) => h.hotword.word)).toEqual(['点']);
    expect(dian.hits.every((h) => h.hotword.isAlias !== true)).toBe(true);

    const disabled = recallSpanTopKV2(rt, {
      syllables: ['ce'],
      windowText: '测',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
    });
    expect(disabled.hits).toHaveLength(0);
  });

  it('Recall Integration: DB repair_target=1 still forces Candidate repairTarget=false', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['xiu'],
      windowText: '修',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.hotword.word).toBe('修');
    expect(result.hits[0]!.hotword.repairTarget).toBe(false);
  });

  it('does not broaden domain tier to length1 (spy + direct)', () => {
    const rt = boot(true);
    const spyMulti = jest.spyOn(rt, 'lookupDomainsByPinyinKeyMulti');
    const spyTone = jest.spyOn(rt, 'lookupDomainsByPinyinAndToneKeyMulti');
    recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      acousticTonePattern: [3],
    });
    expect(spyMulti).not.toHaveBeenCalled();
    expect(spyTone).not.toHaveBeenCalled();
    expect(rt.lookupDomainByPinyinKey('coffee', 'dian', 1)).toEqual([]);
    spyMulti.mockRestore();
    spyTone.mockRestore();
  });

  it('does not enable fuzzy length1 / does not enable alias expansion length1', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['dian'],
      windowText: '点',
      termLength: 1,
      topK: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      fuzzyRecallEnabled: true,
      acousticTonePattern: [3],
    });
    // Length=1 branch ignores fuzzy flag; still cap=1; no fuzzy kinds.
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.recallCandidateKind).toBe('exact_base');
    expect(result.hits.every((h) => !String(h.recallCandidateKind).startsWith('fuzzy'))).toBe(
      true
    );
    // Alias expansion: alias surface 惦 never becomes a Candidate.
    expect(result.hits.every((h) => h.hotword.word !== '惦')).toBe(true);
  });

  it('Recall Integration: length=2 golden 甲乙 unchanged', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['jia', 'yi'],
      windowText: '甲乙',
      termLength: 2,
      topK: 2,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3, 3],
    });
    const hit = result.hits.find((h) => h.hotword.word === '甲乙');
    expect(hit).toBeDefined();
    expect(hit!.recallCandidateKind).toBe('exact_base');
    expect(hit!.hotword.domains ?? []).toEqual([]);
  });

  it('LIMIT=8 after 1.1A: false unique rejected; rank9 still Known Defect', () => {
    const limRows = batch10bLimit8Rows();
    bundle = createLength1TempSqliteBundle({ baseRows: limRows, prefix: 'b0c-lim8-' });
    runtime = bundle.loadRuntime();
    const db = new Database(bundle.sqlitePath, { readonly: true });
    const dbCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM base_lexicon WHERE pinyin_key = 'lim' AND tone_pinyin_key = 'lim1'`
        )
        .get() as { c: number }
    ).c;
    db.close();

    const sqlReturned = runtime.lookupBaseByPinyinAndToneKey('lim', 'lim1', 1, 8);
    const eligible = sqlReturned.filter(
      (h) => h.enabled && h.word.length === 1 && h.isAlias !== true && h.priorScore > 0
    );
    const recallHits = recallSpanTopKV2(runtime, {
      syllables: ['lim'],
      windowText: '零',
      termLength: 1,
      topK: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [1],
    }).hits;

    // Historical before-repair baseline kept at lattice_v1_batch1_0c (do not overwrite).
    expect(dbCount).toBe(9);
    expect(sqlReturned.length).toBe(8);
    expect(eligible.length).toBe(1);
    expect(recallHits).toHaveLength(0);
    expect(sqlReturned.some((h) => h.word === '玖')).toBe(false);
  });

  it('tone runtime unsupported → Empty (Mandatory Tone Recall / 1.1C)', () => {
    const rt = boot();
    expect(rt.supportsToneFirstRecall()).toBe(true);
    rt.supportsToneFirstRecall = () => false;
    const spyPlain = jest.spyOn(rt, 'lookupBaseByPinyinKey');
    const spyPlainExact = jest.spyOn(rt, 'lookupBaseByExactSurfaceAndPinyin');
    const result = recallSpanTopKV2(rt, {
      syllables: ['wo'],
      windowText: '我',
      termLength: 1,
      topK: 1,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3],
    });
    expect(result.hits).toHaveLength(0);
    expect(result.toneRecallReadiness?.state).toBe('runtime_unsupported');
    expect(spyPlain).not.toHaveBeenCalled();
    expect(spyPlainExact).not.toHaveBeenCalled();
    spyPlain.mockRestore();
    spyPlainExact.mockRestore();
  });
});
