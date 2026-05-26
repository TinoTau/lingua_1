import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database = require('better-sqlite3');
import { LexiconRuntime } from './lexicon-runtime';
import { readManifest, sha256File } from './lexicon-manifest';
import { resetLexiconRuntimeForTests } from './lexicon-runtime-holder';
import { LEXICON_SCHEMA_VERSION } from './scored-lexicon';

describe('LexiconRuntime', () => {
  let tmpDir: string;
  let rt: LexiconRuntime | null = null;

  beforeEach(() => {
    resetLexiconRuntimeForTests();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-test-'));
    process.env.LEXICON_BUNDLE_PATH = tmpDir;
  });

  afterEach(() => {
    if (rt) {
      rt.close();
      rt = null;
    }
    delete process.env.LEXICON_BUNDLE_PATH;
    resetLexiconRuntimeForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFinalV1Bundle(
    rows: {
      id: string;
      word: string;
      pinyin: string;
      prior_score: number;
      frequency?: number;
      enabled?: number;
      tags?: string;
      domains?: string;
      aliases?: string;
    }[]
  ) {
    const sqlitePath = path.join(tmpDir, 'lexicon.sqlite');
    const db = new Database(sqlitePath);
    db.exec(`
      CREATE TABLE lexicon_terms (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        normalized TEXT NOT NULL,
        pinyin TEXT NOT NULL,
        prior_score REAL NOT NULL,
        frequency INTEGER DEFAULT 1,
        domain TEXT,
        domains TEXT,
        aliases TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        updated_at INTEGER NOT NULL,
        tags TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);
    const insert = db.prepare(
      `INSERT INTO lexicon_terms (id, word, normalized, pinyin, prior_score, frequency, domain, domains, tags, aliases, source, updated_at, enabled)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'test', ?, ?)`
    );
    for (const row of rows) {
      insert.run(
        row.id,
        row.word,
        row.word,
        row.pinyin,
        row.prior_score,
        row.frequency ?? 1,
        row.domains ?? '["general"]',
        row.tags ?? '[]',
        row.aliases ?? '[]',
        Date.now(),
        row.enabled ?? 1
      );
    }
    db.close();
    const checksum = sha256File(sqlitePath);
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: LEXICON_SCHEMA_VERSION,
        version: 'test-final-v1',
        checksum,
        createdAt: '2026-05-22T00:00:00Z',
        backend: 'sqlite',
        scored_lexicon_version: LEXICON_SCHEMA_VERSION,
        term_count: rows.length,
        enabled_term_count: rows.filter((r) => (r.enabled ?? 1) === 1).length,
        terms_with_prior_count: rows.filter((r) => (r.enabled ?? 1) === 1).length,
        terms_without_prior_count: 0,
        pinyin_index_count: 0,
        mixed_token_count: 0,
      })
    );
    fs.writeFileSync(path.join(tmpDir, 'checksum.txt'), checksum);
  }

  it('loads final-v1 bundle, builds pinyin index by priorScore, recalls by pinyin', () => {
    writeFinalV1Bundle([
      {
        id: 'hw-1',
        word: '候选生成',
        pinyin: 'hou xuan sheng cheng',
        prior_score: 8.5,
        frequency: 10,
      },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(state.scoredLexicon?.termsWithoutPriorSkipped).toBe(0);
    expect(rt.getPinyinIndexSize()).toBeGreaterThan(0);

    const pinyinHits = rt.recallHotwordsByPinyin(['hou', 'xuan', 'sheng', 'cheng']);
    expect(pinyinHits.length).toBeGreaterThan(0);
    expect(pinyinHits[0].word).toBe('候选生成');
    expect(pinyinHits[0].priorScore).toBe(8.5);
  });

  it('skips enabled row without prior_score from index', () => {
    writeFinalV1Bundle([
      {
        id: 'hw-ok',
        word: '好',
        pinyin: 'hao',
        prior_score: 5,
      },
      {
        id: 'hw-bad',
        word: '坏',
        pinyin: 'huai',
        prior_score: 0,
      },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(state.scoredLexicon?.termsWithoutPriorSkipped).toBe(1);
    expect(state.scoredLexicon?.termsWithPriorCount).toBe(1);
    expect(rt.getPinyinIndexSize()).toBe(1);
  });

  it('loads mixed latin without pinyin into exact index', () => {
    writeFinalV1Bundle([
      {
        id: 'hw-gpu',
        word: 'GPU',
        pinyin: '',
        prior_score: 0.9,
        domains: '["tech_ai"]',
      },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(state.scoredLexicon?.mixedTokenCount).toBe(1);
    expect(rt.getExactIndexSize()).toBeGreaterThan(0);
    expect(rt.getPinyinIndexSize()).toBe(0);
    expect(rt.lookupHotwordsByExactWord('gpu')[0]?.word).toBe('GPU');
  });

  it('loads mixed latin token with explicit pinyin', () => {
    writeFinalV1Bundle([
      {
        id: 'hw-gpu',
        word: 'GPU',
        pinyin: 'ji pu you',
        prior_score: 6,
        tags: '["hardware"]',
      },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(state.scoredLexicon?.mixedTokenCount).toBe(1);
    const hits = rt.recallHotwordsByPinyin(['ji', 'pu', 'you']);
    expect(hits[0]?.word).toBe('GPU');
  });

  it('returns error when prior_score column missing', () => {
    const sqlitePath = path.join(tmpDir, 'lexicon.sqlite');
    const db = new Database(sqlitePath);
    db.exec(`
      CREATE TABLE lexicon_terms (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        pinyin TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        enabled INTEGER DEFAULT 1
      );
    `);
    db.prepare(`INSERT INTO lexicon_terms VALUES ('1', 'a', 'a', 1, 1)`).run();
    db.close();
    const checksum = sha256File(sqlitePath);
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        version: 'legacy',
        checksum,
        createdAt: '2026-05-22T00:00:00Z',
        backend: 'sqlite',
      })
    );
    fs.writeFileSync(path.join(tmpDir, 'checksum.txt'), checksum);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('error');
    expect(state.errorMessage).toContain('prior_score');
  });

  it('returns missing when bundle absent', () => {
    process.env.LEXICON_BUNDLE_PATH = path.join(tmpDir, 'nonexistent-bundle');
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('missing');
  });

  it('returns error on checksum mismatch', () => {
    writeFinalV1Bundle([{ id: '1', word: 'a', pinyin: 'a', prior_score: 1 }]);
    const manifest = readManifest(path.join(tmpDir, 'manifest.json'));
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({ ...manifest, checksum: 'deadbeef' })
    );
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('error');
  });
});
