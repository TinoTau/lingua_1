import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../../../pipeline/context/job-context';

const mockRecall = jest.fn();
const mockEnsureLoaded = jest.fn();
const mockGetRuntime = jest.fn();

jest.mock('../../../lexicon/window-recall', () => ({
  recallSegmentWindowCandidates: (...args: unknown[]) => mockRecall(...args),
}));

jest.mock('../../../lexicon/lexicon-runtime-holder', () => ({
  ensureLexiconRuntimeLoaded: () => mockEnsureLoaded(),
  getLexiconRuntime: () => mockGetRuntime(),
}));

jest.mock('../../../node-config', () => ({
  isLexiconRecallEnabled: () => true,
  isLexiconRecallLanguage: () => true,
  getLexiconRecallSkipReason: () => null,
  loadNodeConfig: () => ({}),
}));

import { runLexiconRecallStep } from './lexicon-recall-step';

describe('runLexiconRecallStep', () => {
  const job = {
    job_id: 'job-recall',
    session_id: 's1',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: { use_lexicon: true },
  } as JobAssignMessage;

  beforeEach(() => {
    mockEnsureLoaded.mockReturnValue({ status: 'ok', manifestVersion: 'test' });
    mockGetRuntime.mockReturnValue({
      getPinyinIndexSize: () => 1,
      getEnabledHotwords: () => [],
    });
  });

  it('sets windowCandidates when recall returns hits', async () => {
    mockRecall.mockReturnValue({
      candidates: [
        {
          windowId: 'h0-aw-4-8-x',
          hypothesisIndex: 0,
          from: '后选生城',
          to: '候选生成',
          start: 4,
          end: 8,
          hotwordId: 'hw-1',
          phoneticScore: 0.9,
          priorScore: 1,
          source: 'lexicon_pinyin_topk',
        },
      ],
      truncated: false,
      windowCount: 1,
      diagnostics: { windowCandidateCount: 1, windowsEnumerated: 1 },
      maxDomainBoostApplied: 0,
    });

    const ctx: JobContext = {
      segmentForJobResult: '我们要做后选生城',
      asrHypotheses: [{ text: '我们要做后选生城', rank: 0 }],
    };

    await runLexiconRecallStep(job, ctx, {} as any);

    expect(ctx.windowCandidates).toHaveLength(1);
    expect(ctx.windowCandidates![0].to).toBe('候选生成');
  });

  it('recall 以 segment 为第一参数', async () => {
    mockRecall.mockImplementation((segment: string, hypotheses: { text: string }[]) => {
      expect(segment).toBe('聚合段B');
      expect(hypotheses[0].text).toBe('聚合段B');
      return {
        candidates: [],
        truncated: false,
        windowCount: 0,
        diagnostics: { windowCandidateCount: 0 },
        maxDomainBoostApplied: 0,
      };
    });

    const ctx: JobContext = {
      segmentForJobResult: '聚合段B',
      asrHypotheses: [{ text: '聚合段B', rank: 0 }],
    };

    await runLexiconRecallStep(job, ctx, {} as any);
    expect(mockRecall).toHaveBeenCalled();
  });

  it('leaves windowCandidates empty when no hits', async () => {
    mockRecall.mockReturnValue({
      candidates: [],
      truncated: false,
      windowCount: 0,
      diagnostics: { windowCandidateCount: 0 },
    });

    const ctx: JobContext = {
      segmentForJobResult: '我们继续测试',
      asrHypotheses: [{ text: '我们继续测试', rank: 0 }],
    };

    await runLexiconRecallStep(job, ctx, {} as any);

    expect(ctx.windowCandidates).toEqual([]);
  });
});
