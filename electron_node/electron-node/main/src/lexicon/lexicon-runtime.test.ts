import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database = require('better-sqlite3');
import { LexiconRuntime } from './lexicon-runtime';
import { readManifest, sha256File } from './lexicon-manifest';
import { resetLexiconRuntimeForTests } from './lexicon-runtime-holder';

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

  function writeBundle(rows: { id: string; word: string; pinyin: string; frequency?: number }[]) {
    const sqlitePath = path.join(tmpDir, 'lexicon.sqlite');
    const db = new Database(sqlitePath);
    db.exec(`
      CREATE TABLE lexicon_terms (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        pinyin TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        domain TEXT,
        enabled INTEGER DEFAULT 1
      );
      CREATE TABLE lexicon_confusions (
        id TEXT PRIMARY KEY,
        observed TEXT NOT NULL,
        hotword_id TEXT NOT NULL,
        pinyin TEXT,
        source TEXT,
        enabled INTEGER DEFAULT 1
      );
    `);
    const insert = db.prepare(
      `INSERT INTO lexicon_terms (id, word, pinyin, frequency, enabled)
       VALUES (?, ?, ?, ?, 1)`
    );
    for (const row of rows) {
      insert.run(row.id, row.word, row.pinyin, row.frequency ?? 1);
    }
    db.close();
    const checksum = sha256File(sqlitePath);
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        version: 'test',
        checksum,
        createdAt: '2026-05-17T00:00:00Z',
        backend: 'sqlite',
      })
    );
    fs.writeFileSync(path.join(tmpDir, 'checksum.txt'), checksum);
  }

  it('loads bundle, builds pinyin index, recalls by observed and pinyin', () => {
    writeBundle([
      {
        id: 'hw-1',
        word: '候选生成',
        pinyin: 'hou xuan sheng cheng',
        frequency: 10,
      },
    ]);
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('ok');
    expect(rt.getPinyinIndexSize()).toBeGreaterThan(0);

    const observedHits = rt.recallHotwordsByObserved('候选生成');
    expect(observedHits.length).toBe(1);

    const pinyinHits = rt.recallHotwordsByPinyin(['hou', 'xuan', 'sheng', 'cheng']);
    expect(pinyinHits.length).toBeGreaterThan(0);
    expect(pinyinHits[0].word).toBe('候选生成');
  });

  it('returns missing when bundle absent', () => {
    process.env.LEXICON_BUNDLE_PATH = path.join(tmpDir, 'nonexistent-bundle');
    rt = new LexiconRuntime();
    const state = rt.load();
    expect(state.status).toBe('missing');
  });

  it('returns error on checksum mismatch', () => {
    writeBundle([{ id: '1', word: 'a', pinyin: 'a' }]);
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
