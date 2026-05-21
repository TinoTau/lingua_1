import * as fs from 'fs';
import * as path from 'path';
import type { SentenceCandidate } from '../sentence-expansion/types';
import { createKenlmBatchScorer } from './kenlm-scorer';
import { rerankSentenceCandidates } from './rerank';
import { resetLmScorerForTests } from '../../phonetic-correction/lm-scorer';

const RERANK_SRC = fs.readFileSync(path.join(__dirname, 'rerank.ts'), 'utf-8');
const KENLM_SCORER_SRC = fs.readFileSync(path.join(__dirname, 'kenlm-scorer.ts'), 'utf-8');

function baseCandidate(text: string, phoneticScore: number): SentenceCandidate {
  return {
    text,
    hypothesisIndex: 0,
    phoneticScore,
    hotwordPrior: 0,
    acousticScore: -1,
    replacements: [],
  };
}

describe('sentence KenLM smoke', () => {
  it('句级 rerank 源码不依赖 asrKenlmMeta', () => {
    expect(RERANK_SRC).not.toMatch(/asrKenlmMeta|asr_kenlm_meta/);
    expect(KENLM_SCORER_SRC).not.toMatch(/asrKenlmMeta|asr_kenlm_meta/);
  });

  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
    resetLmScorerForTests();
  });

  it('KenLM 不可用时 fail-open，rerank 不抛错', async () => {
    delete process.env.CHAR_LM_PATH;
    delete process.env.PROJECT_ROOT;
    resetLmScorerForTests();
    expect(createKenlmBatchScorer()).toBeNull();

    const candidates = [
      baseCandidate('我们要做后选生城', 0.9),
      baseCandidate('我们要做候选生成', 0.7),
    ];
    const result = await rerankSentenceCandidates(candidates);
    expect(result.kenlmAvailable).toBe(false);
    expect(result.picked.text).toBeDefined();
    expect(result.candidates.every((c) => c.kenlmScore === undefined)).toBe(true);
  });

  it('mock KenLM 写入 kenlmScore，且不读取 asrKenlmMeta', async () => {
    const mockScorer = {
      async scoreBatch(sentences: string[]) {
        const scores = sentences.map((sentence, i) => ({
          sentence,
          score: i === 0 ? -50 : -5,
          normalizedScore: i === 0 ? 0.1 : 0.9,
        }));
        return {
          scores,
          timing: {
            batchMs: 2,
            queryCount: sentences.length,
            avgMs: 1,
            p50Ms: 1,
            p95Ms: 2,
            maxMs: 2,
          },
        };
      },
    };

    const candidates = [
      baseCandidate('短句甲', 0.95),
      baseCandidate('短句乙', 0.5),
    ];
    const result = await rerankSentenceCandidates(candidates, undefined, mockScorer);
    expect(result.kenlmAvailable).toBe(true);
    expect(result.candidates.some((c) => c.kenlmScore !== undefined)).toBe(true);
    expect(result.picked.text).toBe('短句乙');
  });
});
