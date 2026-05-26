import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { buildAliasIndexes, lookupAliasExact } from './alias-index';
import { buildExactWordIndex, lookupExactWord } from './exact-index';
import type { HotwordEntry } from './hotword-types';

const pilotSeed = path.resolve(__dirname, '../../../data/lexicon/pilot/lexicon_1k_pilot_v1.jsonl');
const validateScript = path.resolve(__dirname, '../../../scripts/lexicon/validate-lexicon-seed.mjs');

function loadHotwordsFromSeed(seedPath: string): HotwordEntry[] {
  const lines = fs.readFileSync(seedPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    const row = JSON.parse(line) as {
      termId?: string;
      word: string;
      pinyin?: string;
      domains?: string[];
      priorScore?: number;
      aliases?: string[];
      enabled?: boolean;
    };
    const word = row.word.trim();
    const pinyin = (row.pinyin ?? '')
      .trim()
      .split(/[\s,/|]+/)
      .map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    return {
      id: row.termId ?? `row-${index + 1}`,
      word,
      normalized: word.toLowerCase(),
      pinyin,
      priorScore: row.priorScore ?? 0.5,
      frequency: 1,
      enabled: row.enabled !== false,
      domains: row.domains?.length ? row.domains : ['general'],
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
    };
  });
}

describe('lexicon-1k-pilot', () => {
  it('strict validation PASS on deployed pilot seed', () => {
    expect(fs.existsSync(pilotSeed)).toBe(true);
    const result = spawnSync(
      process.execPath,
      [
        validateScript,
        '--input',
        pilotSeed,
        '--strict',
        '--report',
        path.join(path.dirname(pilotSeed), 'lexicon_1k_validation-report.json'),
      ],
      { encoding: 'utf-8' }
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(
      fs.readFileSync(path.join(path.dirname(pilotSeed), 'lexicon_1k_validation-report.json'), 'utf-8')
    );
    expect(report.ok).toBe(true);
    expect(report.totalRows).toBe(1000);
  });

  it('alias exact and latin exact samples from seed rows', () => {
    const hotwords = loadHotwordsFromSeed(pilotSeed).filter((h) => h.enabled && h.priorScore > 0);
    expect(hotwords.length).toBe(1000);

    const { exactIndex } = buildAliasIndexes(hotwords);
    const exactWordIndex = buildExactWordIndex(hotwords);

    expect(lookupAliasExact(exactIndex, 'gpu')[0]?.hotword.word).toBe('GPU');
    expect(lookupExactWord(exactWordIndex, 'CUDA')[0]?.word).toBe('CUDA');
    expect(lookupAliasExact(exactIndex, 'chatgpt')[0]?.hotword.word).toBe('GPT');
  });
});
