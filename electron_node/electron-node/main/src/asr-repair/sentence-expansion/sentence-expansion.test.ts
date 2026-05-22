import { describe, expect, it } from '@jest/globals';
import { expandSentenceCandidates } from './sentence-expansion';
import type { WindowCandidate } from '../../lexicon/hotword-types';

describe('expandSentenceCandidates (windowSelector path)', () => {
  const hypothesis = { text: '我们要做后选生城', rank: 0, acousticScore: -1 };
  const replacement: WindowCandidate = {
    windowId: 'h0-aw-4-8-x',
    hypothesisIndex: 0,
    from: '后选生城',
    to: '候选生成',
    start: 4,
    end: 8,
    hotwordId: 'hw-1',
    phoneticScore: 0.9,
    priorScore: 1,
    source: 'confusion_evidence',
  };

  it('emits only window expansion candidates (no raw CTC baseline)', () => {
    const { candidates } = expandSentenceCandidates({
      segmentText: hypothesis.text,
      hypotheses: [hypothesis],
      windowCandidates: [replacement],
    });
    expect(candidates.some((c) => c.text === '我们要做后选生城')).toBe(false);
    expect(candidates.some((c) => c.text === '我们要做候选生成')).toBe(true);
    expect(candidates.every((c) => c.candidateSource !== 'raw_ctc_baseline')).toBe(true);
    expect(candidates[0]?.candidateSource).toBe('window_single');
  });

  it('returns empty when no window candidates', () => {
    const { candidates } = expandSentenceCandidates({
      segmentText: hypothesis.text,
      hypotheses: [hypothesis],
      windowCandidates: [],
    });
    expect(candidates).toEqual([]);
  });

  it('window_multi via selector maxReplacements=3', () => {
    const base = '我们要做后选生城和上线计化和案排';
    const { candidates } = expandSentenceCandidates({
      segmentText: base,
      hypotheses: [{ text: base, rank: 0, acousticScore: -1 }],
      windowCandidates: [
        {
          windowId: 'w1',
          hypothesisIndex: 0,
          from: '后选生城',
          to: '候选生成',
          start: 4,
          end: 8,
          hotwordId: 'hw-1',
          phoneticScore: 0.95,
          priorScore: 1,
          source: 'confusion_evidence',
        },
        {
          windowId: 'w2',
          hypothesisIndex: 0,
          from: '上线计化',
          to: '上线计划',
          start: 9,
          end: 13,
          hotwordId: 'hw-2',
          phoneticScore: 0.9,
          priorScore: 1,
          source: 'confusion_evidence',
        },
        {
          windowId: 'w3',
          hypothesisIndex: 0,
          from: '案排',
          to: '安排',
          start: 14,
          end: 16,
          hotwordId: 'hw-3',
          phoneticScore: 0.88,
          priorScore: 1,
          source: 'hotword',
        },
      ],
      limits: { maxActiveWindowsPerSentence: 4 },
    });
    expect(candidates.some((c) => c.candidateSource === 'window_multi')).toBe(true);
  });

  it('d064-like: two non-overlapping 后选生城 spans yield pair candidate', () => {
    const base =
      '今天我们团队要讨论后选生城相关的后选生城流程和上线计划安排请研发一起评估风险';
    const { candidates } = expandSentenceCandidates({
      segmentText: base,
      hypotheses: [{ text: base, rank: 0, acousticScore: -2 }],
      windowCandidates: [
        {
          windowId: 'w-a',
          hypothesisIndex: 0,
          from: '后选生城',
          to: '候选生成',
          start: 9,
          end: 13,
          hotwordId: 'hw-a',
          phoneticScore: 0.95,
          priorScore: 1,
          source: 'confusion_evidence',
        },
        {
          windowId: 'w-b',
          hypothesisIndex: 0,
          from: '后选生城',
          to: '候选生成',
          start: 16,
          end: 20,
          hotwordId: 'hw-b',
          phoneticScore: 0.9,
          priorScore: 1,
          source: 'confusion_evidence',
        },
      ],
      limits: { maxActiveWindowsPerSentence: 4 },
    });
    expect(candidates.some((c) => c.candidateSource === 'window_pair')).toBe(true);
    const pair = candidates.find((c) => c.candidateSource === 'window_pair');
    expect(pair?.replacements.length).toBeGreaterThanOrEqual(2);
    expect(pair?.text.includes('后选生城')).toBe(false);
  });
});
