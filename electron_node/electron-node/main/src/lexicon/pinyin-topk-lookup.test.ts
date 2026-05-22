import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database = require('better-sqlite3');
import { LexiconRuntime } from './lexicon-runtime';
import { sha256File } from './lexicon-manifest';
import { lookupTopKByPinyin } from './pinyin-topk-lookup';
import { syllablesKey } from './pinyin-index';
import { SCORED_LEXICON_VERSION } from './scored-lexicon';

function seedBundle(tmpDir: string, rows: { id: string; word: string; pinyin: string; prior: number }[]) {
  const sqlitePath = path.join(tmpDir, 'lexicon.sqlite');
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE lexicon_terms (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      prior_score REAL NOT NULL,
      frequency INTEGER DEFAULT 1,
      domain TEXT,
      tags TEXT,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE lexicon_confusions (
      id TEXT PRIMARY KEY,
      observed TEXT NOT NULL,
      hotword_id TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
  `);
  const ins = db.prepare(
    `INSERT INTO lexicon_terms (id, word, pinyin, prior_score, frequency, tags, enabled)
     VALUES (?, ?, ?, ?, 10, '[]', 1)`
  );
  for (const r of rows) {
    ins.run(r.id, r.word, r.pinyin, r.prior);
  }
  db.close();
  const checksum = sha256File(sqlitePath);
  fs.writeFileSync(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify({
      version: 'test-v5',
      checksum,
      createdAt: '2026-05-22T00:00:00Z',
      backend: 'sqlite',
      scored_lexicon_version: SCORED_LEXICON_VERSION,
      terms_without_prior_count: 0,
    })
  );
  fs.writeFileSync(path.join(tmpDir, 'checksum.txt'), checksum);
}

describe('lookupTopKByPinyin', () => {
  let tmpDir: string;
  let rt: LexiconRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topk-'));
    process.env.LEXICON_BUNDLE_PATH = tmpDir;
    seedBundle(tmpDir, [
      { id: 'a', word: '候选', pinyin: 'hou xuan', prior: 9 },
      { id: 'b', word: '后选', pinyin: 'hou xuan', prior: 5 },
      { id: 'c', word: '候选', pinyin: 'hou xuan', prior: 7 },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(rt.getPinyinIndexSize()).toBeGreaterThan(0);
  });

  afterEach(() => {
    rt.close();
    delete process.env.LEXICON_BUNDLE_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns TopK sorted by candidateScore for termLength 2', () => {
    const key = syllablesKey(['hou', 'xuan']);
    expect(rt.getPinyinBucket(key).length).toBe(3);
    const { hits, nearPinyinAttemptCount } = lookupTopKByPinyin(rt, {
      syllables: ['hou', 'xuan'],
      windowText: '后选',
      termLength: 2,
      topK: 3,
    });
    expect(nearPinyinAttemptCount).toBe(0);
    expect(hits.length).toBe(3);
    expect(hits[0].source).toBe('lexicon_pinyin_topk');
    expect(hits[0].rankInTopK).toBe(1);
    expect(hits[0].candidateScoreBreakdown.editDistancePenalty).toBeLessThanOrEqual(1);
    expect(hits[0].candidateScore).toBeGreaterThanOrEqual(hits[1].candidateScore);
    expect(hits.every((h) => h.hotword.word.length === 2)).toBe(true);
  });
});
