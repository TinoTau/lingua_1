import { describe, expect, it } from '@jest/globals';
import type { WindowCandidate } from '../../lexicon/hotword-types';
import { expandSentenceCandidates } from './sentence-expansion/sentence-expansion';
import { rerankSentenceCandidates } from './sentence-rerank/rerank';
import { applySentenceRepair } from './sentence-rerank/apply-sentence-repair';
import type { JobContext } from '../pipeline/context/job-context';

describe('Recover CTC n-best rerank', () => {
  const replacement: WindowCandidate = {
    windowId: 'h0-aw-4-8-x',
    hypothesisIndex: 0,
    from: '后选生城',
    to: '候选生成',
    start: 4,
    end: 8,
    hotwordId: 'hw-1',
    phoneticScore: 0.92,
    priorScore: 1.2,
    source: 'lexicon_pinyin_topk',
  };

  const hypotheses = [
    { text: '我们要做后选生城', rank: 0, acousticScore: -1 },
    { text: '我们要做后选生城', rank: 1, acousticScore: -3 },
  ];

  it('segment-first 窗替换可进入 picked', async () => {
    const { candidates: sentenceCandidates } = expandSentenceCandidates({
      segmentText: hypotheses[0].text,
      hypotheses,
      windowCandidates: [replacement],
    });
    expect(sentenceCandidates.some((c) => c.hypothesisIndex === 0)).toBe(true);
    expect(sentenceCandidates.some((c) => c.text === '我们要做候选生成')).toBe(true);
    expect(sentenceCandidates.every((c) => c.candidateSource !== 'raw_ctc_baseline')).toBe(true);

    const mockScorer = {
      async scoreBatch(sentences: string[]) {
        const scores = sentences.map((sentence) => ({
          sentence,
          score: sentence.includes('候选生成') ? -5 : -40,
          normalizedScore: sentence.includes('候选生成') ? 0.9 : 0.1,
        }));
        return {
          scores,
          timing: {
            batchMs: 1,
            queryCount: sentences.length,
            avgMs: 1,
            p50Ms: 1,
            p95Ms: 1,
            maxMs: 1,
          },
        };
      },
    };

    const rerank = await rerankSentenceCandidates(sentenceCandidates, undefined, mockScorer);
    expect(rerank.picked.hypothesisIndex).toBe(0);
    expect(rerank.picked.text).toBe('我们要做候选生成');
    expect(rerank.picked.candidateSource).toBe('window_single');

    const ctx: JobContext = {
      segmentForJobResult: '我们要做后选生城',
      asrHypotheses: hypotheses,
      nbestSynthetic: false,
    };
    applySentenceRepair(ctx, rerank.picked);
    expect(ctx.repairedText).toBe('我们要做候选生成');
    expect(ctx.asrRepairApplied).toBe(true);
  });
});
