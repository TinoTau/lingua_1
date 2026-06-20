import { describe, expect, it } from '@jest/globals';
import type { KenLMScorer } from '../asr-repair/kenlm-batch-types';
import type { SentenceCombination } from './build-sentence-candidates';
import { FW_RERANK_SCORE_MODE, rerankFwSentences } from './rerank-fw-sentences';

function combo(text: string, candidateScore: number): SentenceCombination {
  return { text, replacements: [], candidateScore };
}

function mockScorer(
  rows: Array<{ score: number; normalizedScore: number }>
): KenLMScorer {
  return {
    scoreBatch: async (sentences) => ({
      scores: sentences.map((sentence, i) => ({
        sentence,
        score: rows[i]?.score ?? 0,
        normalizedScore: rows[i]?.normalizedScore ?? 0,
      })),
      timing: {
        batchMs: 1,
        queryCount: sentences.length,
        avgMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        maxMs: 0,
      },
    }),
  };
}

describe('rerankFwSentences raw log delta', () => {
  it('below gate remains raw', async () => {
    const scorer = mockScorer([
      { score: -100, normalizedScore: 0.5 },
      { score: -98, normalizedScore: 0.51 },
    ]);
    const result = await rerankFwSentences('raw', [combo('candidate-a', 1)], scorer, 3.0);

    expect(result.pickedIsRaw).toBe(true);
    expect(result.picked).toBeNull();
    expect(result.maxDelta).toBeCloseTo(2);
    expect(result.scoreMode).toBe(FW_RERANK_SCORE_MODE);
    expect(result.baselineRawScore).toBe(-100);
    expect(result.pickedRawScore).toBeUndefined();
    expect(result.topCandidates[0]?.kenlmDelta).toBeCloseTo(2);
    expect(result.allCombinationDeltas).toEqual([2]);
  });

  it('above gate picks candidate', async () => {
    const scorer = mockScorer([
      { score: -100, normalizedScore: 0.5 },
      { score: -95, normalizedScore: 0.55 },
      { score: -90, normalizedScore: 0.6 },
    ]);
    const candidates = [combo('candidate-a', 1), combo('candidate-b', 2)];
    const result = await rerankFwSentences('raw', candidates, scorer, 3.0);

    expect(result.pickedIsRaw).toBe(false);
    expect(result.picked?.text).toBe('candidate-b');
    expect(result.maxDelta).toBeCloseTo(10);
    expect(result.pickedRawScore).toBe(-90);
    expect(result.maxNormalizedDelta).toBeCloseTo(0.1);
  });

  it('normalized delta no longer gates pick', async () => {
    const scorer = mockScorer([
      { score: -100, normalizedScore: 0.5 },
      { score: -99.9, normalizedScore: 0.9 },
    ]);
    const result = await rerankFwSentences('raw', [combo('candidate-a', 1)], scorer, 3.0);

    expect(result.pickedIsRaw).toBe(true);
    expect(result.maxDelta).toBeCloseTo(0.1);
    expect(result.maxNormalizedDelta).toBeCloseTo(0.4);
  });

  it('scorer null skips scoreMode', async () => {
    const result = await rerankFwSentences('raw', [combo('candidate-a', 1)], null, 3.0);

    expect(result.pickedIsRaw).toBe(true);
    expect(result.scoreMode).toBeUndefined();
    expect(result.baselineRawScore).toBeUndefined();
  });

  it('empty candidates skips scoreMode', async () => {
    const result = await rerankFwSentences('raw', [], mockScorer([]), 3.0);

    expect(result.pickedIsRaw).toBe(true);
    expect(result.scoreMode).toBeUndefined();
  });

  it('fail-open all-zero scores remain raw', async () => {
    const scorer = mockScorer([
      { score: 0, normalizedScore: 0.5 },
      { score: 0, normalizedScore: 0.5 },
    ]);
    const result = await rerankFwSentences('raw', [combo('candidate-a', 1)], scorer, 3.0);

    expect(result.pickedIsRaw).toBe(true);
    expect(result.maxDelta).toBe(0);
    expect(result.scoreMode).toBe(FW_RERANK_SCORE_MODE);
  });
});
