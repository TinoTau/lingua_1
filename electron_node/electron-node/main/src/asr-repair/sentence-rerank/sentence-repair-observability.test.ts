import { describe, expect, it } from '@jest/globals';
import type { WindowCandidate } from '../../lexicon/hotword-types';
import { buildSentenceRepairExtra } from './sentence-repair-observability';
import type { SentenceCandidate } from '../sentence-expansion/types';
import type { SentenceRerankResult } from './types';

function candidate(text: string, partial: Partial<SentenceCandidate> = {}): SentenceCandidate {
  const replacements = partial.replacements ?? [];
  return {
    text,
    hypothesisIndex: 0,
    baseText: text,
    replacements,
    candidateSource: partial.candidateSource ?? 'window_single',
    phoneticScore: 0.5,
    hotwordPrior: 1,
    combinedScore: 0.7,
    ...partial,
  };
}

describe('sentence-repair-observability', () => {
  it('outputs executed/modified/historical pickedReason', () => {
    const replacement: WindowCandidate = {
      windowId: 'w1',
      hypothesisIndex: 0,
      from: '后选',
      to: '候选',
      start: 0,
      end: 2,
      hotwordId: 'hw',
      phoneticScore: 0.9,
      priorScore: 1,
      source: 'lexicon_pinyin_topk',
    };
    const picked = candidate('候选生成', {
      replacements: [replacement],
      candidateSource: 'window_single',
      combinedScore: 0.9,
    });
    const runner = candidate('后选生城', { combinedScore: 0.5 });
    const rerank: SentenceRerankResult = {
      candidates: [picked, runner],
      picked,
      kenlmAvailable: true,
      kenlmTiming: {
        batchMs: 10,
        queryCount: 2,
        avgMs: 5,
        p50Ms: 5,
        p95Ms: 9,
        maxMs: 9,
      },
      rerankMs: 12,
    };

    const extra = buildSentenceRepairExtra({
      ctx: {
        asrHypotheses: [{ text: '后选生城', rank: 0 }],
        segmentForJobResult: '后选生城',
      },
      rerank,
      baselineText: '后选生城',
      executed: true,
    });

    expect(extra?.executed).toBe(true);
    expect(extra?.modified).toBe(true);
    expect(extra?.pickedReason).toBe('hotword_recall');
    expect(extra?.kenlmTiming?.batchMs).toBe(10);
    expect(extra?.candidateSource).toBe('window_single');
    expect(extra?.restore_metrics.picked_from_phonetic_expansion_count).toBe(0);
  });
});
