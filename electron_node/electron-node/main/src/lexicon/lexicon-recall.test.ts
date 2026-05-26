import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database = require('better-sqlite3');
import { LexiconRuntime } from './lexicon-runtime';
import { recallSegmentWindowCandidates } from './window-recall';
import { sha256File } from './lexicon-manifest';

function seedBundle(tmpDir: string): void {
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
  const insertHw = db.prepare(
    `INSERT INTO lexicon_terms (id, word, normalized, pinyin, prior_score, frequency, domains, source, updated_at, tags, enabled)
     VALUES (?, ?, ?, ?, ?, 10, '["general"]', 'test', ?, '[]', 1)`
  );
  insertHw.run('hw-1', '候选生成', '候选生成', 'hou xuan sheng cheng', 0.85, Date.now());
  db.close();
  const checksum = sha256File(sqlitePath);
  fs.writeFileSync(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 'final-v1',
      version: 'test-v5',
      checksum: `sha256:${checksum}`,
      createdAt: '2026-05-17T00:00:00Z',
      backend: 'sqlite',
      scored_lexicon_version: 'final-v1',
      terms_without_prior_count: 0,
      term_count: 1,
      enabled_term_count: 1,
      terms_with_prior_count: 1,
    })
  );
  fs.writeFileSync(path.join(tmpDir, 'checksum.txt'), `sha256:${checksum}`);
}

describe('recallSegmentWindowCandidates', () => {
  let tmpDir: string;
  let runtime: LexiconRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-recall-'));
    seedBundle(tmpDir);
    process.env.LEXICON_BUNDLE_PATH = tmpDir;
    runtime = new LexiconRuntime();
    runtime.load();
  });

  afterEach(() => {
    runtime.close();
    delete process.env.LEXICON_BUNDLE_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('no_diff_span when only rank0', () => {
    const segment = '我们要做后选生城';
    const { candidates, diagnostics, noDiffSpan } = recallSegmentWindowCandidates(
      segment,
      [{ text: segment, rank: 0 }],
      runtime
    );
    expect(candidates).toEqual([]);
    expect(noDiffSpan).toBe(true);
    expect(diagnostics.slidingWindowCount).toBe(0);
  });

  it('recalls 候选生成 via diff windows when rank1 differs', () => {
    const segment = '我们要做后选生城';
    const { candidates, diagnostics } = recallSegmentWindowCandidates(
      segment,
      [
        { text: segment, rank: 0 },
        { text: '我们要做后选声城', rank: 1 },
      ],
      runtime
    );
    expect(diagnostics.windowsFromNbestDiffCount).toBeGreaterThan(0);
    expect(diagnostics.slidingWindowCount).toBe(0);
    const hit = candidates.find((c) => c.to === '候选生成');
    expect(hit).toBeDefined();
  });

  it('recalls for homophone segment when n-best provides diff', () => {
    const segment = '我们要做后选声城';
    const { candidates } = recallSegmentWindowCandidates(
      segment,
      [
        { text: segment, rank: 0 },
        { text: '我们要做后选生城', rank: 1 },
      ],
      runtime
    );
    const hit = candidates.find((c) => c.to === '候选生成');
    expect(hit).toBeDefined();
  });
});
