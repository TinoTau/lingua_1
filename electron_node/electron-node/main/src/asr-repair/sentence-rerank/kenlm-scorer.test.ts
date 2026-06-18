import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { tokenizeForLm } from '../../phonetic-correction/char-tokenize';
import * as lmScorer from '../../phonetic-correction/lm-scorer';
import { createKenlmBatchScorer } from './kenlm-scorer';

jest.mock('../../phonetic-correction/lm-scorer', () => {
  const actual = jest.requireActual<typeof lmScorer>('../../phonetic-correction/lm-scorer');
  return {
    ...actual,
    resolveCharLmModelPath: jest.fn(() => '/tmp/model.trie.bin'),
    resolveKenlmQueryPath: jest.fn(() => '/tmp/query'),
    isKenlmSubprocessRunnable: jest.fn(() => true),
    runKenlmQueryBatch: jest.fn(),
  };
});

jest.mock('../../fw-detector/fw-config', () => ({
  loadFwDetectorRuntimeConfig: jest.fn(() => ({
    kenlmSubprocessTimeoutMs: 5000,
    kenlmSubprocessMaxLines: 17,
  })),
}));

const mockedLm = lmScorer as jest.Mocked<typeof lmScorer>;

describe('createKenlmBatchScorer batch-only', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLm.isKenlmSubprocessRunnable.mockReturnValue(true);
    const { loadFwDetectorRuntimeConfig } = jest.requireMock('../../fw-detector/fw-config') as {
      loadFwDetectorRuntimeConfig: jest.Mock;
    };
    loadFwDetectorRuntimeConfig.mockReturnValue({
      kenlmSubprocessTimeoutMs: 5000,
      kenlmSubprocessMaxLines: 17,
    });
  });

  it('全空 tokenized 不 spawn，score 全 0', async () => {
    const scorer = createKenlmBatchScorer();
    expect(scorer).not.toBeNull();
    const batch = await scorer!.scoreBatch(['   ', '\t']);
    expect(batch.scores).toHaveLength(2);
    expect(batch.scores.every((s) => s.score === 0)).toBe(true);
    expect(mockedLm.runKenlmQueryBatch).not.toHaveBeenCalled();
    expect(batch.runtime?.kenlmSubprocessCount).toBe(0);
    expect(batch.runtime?.kenlmSubprocessErrorReason).toBeUndefined();
  });

  it('batch 成功：一次 subprocess，顺序映射含空行', async () => {
    mockedLm.runKenlmQueryBatch.mockResolvedValue({
      ok: true,
      results: [
        { score: -10, oovCount: 0 },
        { score: -20, oovCount: 1 },
      ],
      wallMs: 120,
    });

    const scorer = createKenlmBatchScorer()!;
    const sentences = ['你好', '   ', '世界'];
    const batch = await scorer.scoreBatch(sentences);

    expect(mockedLm.runKenlmQueryBatch).toHaveBeenCalledTimes(1);
    const stdinLines = mockedLm.runKenlmQueryBatch.mock.calls[0][2];
    expect(stdinLines).toEqual([tokenizeForLm('你好'), tokenizeForLm('世界')]);

    expect(batch.scores[0].score).toBe(-10);
    expect(batch.scores[1].score).toBe(0);
    expect(batch.scores[2].score).toBe(-20);
    expect(batch.runtime?.kenlmSubprocessCount).toBe(1);
    expect(batch.runtime?.kenlmSubprocessMs).toBe(120);
    expect(batch.timing.batchMs).toBe(120);
    expect(batch.timing.queryCount).toBe(3);
  });

  it('batch 失败 → scoreAllZero', async () => {
    mockedLm.runKenlmQueryBatch.mockResolvedValue({
      ok: false,
      reason: 'parse_mismatch: expected 1 got 0',
    });

    const scorer = createKenlmBatchScorer()!;
    const batch = await scorer.scoreBatch(['测试']);

    expect(batch.scores[0].score).toBe(0);
    expect(batch.runtime?.kenlmSubprocessErrorReason).toContain('parse_mismatch');
    expect(batch.runtime?.kenlmSubprocessCount).toBe(0);
  });

  it('超过 maxLines 非空句 → 多次 batch chunk', async () => {
    const { loadFwDetectorRuntimeConfig } = await import('../../fw-detector/fw-config');
    (loadFwDetectorRuntimeConfig as jest.Mock).mockReturnValue({
      kenlmSubprocessTimeoutMs: 5000,
      kenlmSubprocessMaxLines: 2,
    });
    mockedLm.runKenlmQueryBatch
      .mockResolvedValueOnce({
        ok: true,
        results: [
          { score: -1, oovCount: 0 },
          { score: -2, oovCount: 0 },
        ],
        wallMs: 50,
      })
      .mockResolvedValueOnce({
        ok: true,
        results: [{ score: -3, oovCount: 0 }],
        wallMs: 40,
      });

    const scorer = createKenlmBatchScorer()!;
    const batch = await scorer.scoreBatch(['一', '二', '三']);

    expect(mockedLm.runKenlmQueryBatch).toHaveBeenCalledTimes(2);
    expect(batch.scores.map((s) => s.score)).toEqual([-1, -2, -3]);
    expect(batch.runtime?.kenlmSubprocessCount).toBe(2);
    expect(batch.runtime?.kenlmSubprocessMs).toBe(90);
  });

  it('25 句中 5 空行 20 非空 → 2 spawns', async () => {
    const sentences: string[] = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(`你好测试${i}`);
    }
    for (let i = 0; i < 5; i++) {
      sentences.push('   ');
    }

    mockedLm.runKenlmQueryBatch.mockImplementation(async (_m, _q, lines) => ({
      ok: true,
      results: lines.map((_, idx) => ({ score: -(idx + 1), oovCount: 0 })),
      wallMs: 10,
    }));

    const scorer = createKenlmBatchScorer()!;
    const batch = await scorer.scoreBatch(sentences);

    expect(mockedLm.runKenlmQueryBatch).toHaveBeenCalledTimes(2);
    expect(batch.runtime?.kenlmSubprocessCount).toBe(2);
    expect(batch.runtime?.kenlmQueryCount).toBe(25);
    expect(batch.scores.filter((s) => s.score !== 0)).toHaveLength(20);
  });

  it('chunk2 fail → 整批 scoreAllZero', async () => {
    const { loadFwDetectorRuntimeConfig } = await import('../../fw-detector/fw-config');
    (loadFwDetectorRuntimeConfig as jest.Mock).mockReturnValue({
      kenlmSubprocessTimeoutMs: 5000,
      kenlmSubprocessMaxLines: 2,
    });
    mockedLm.runKenlmQueryBatch
      .mockResolvedValueOnce({
        ok: true,
        results: [
          { score: -1, oovCount: 0 },
          { score: -2, oovCount: 0 },
        ],
        wallMs: 50,
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'timeout',
      });

    const scorer = createKenlmBatchScorer()!;
    const batch = await scorer.scoreBatch(['一', '二', '三']);

    expect(batch.scores.every((s) => s.score === 0)).toBe(true);
    expect(batch.runtime?.kenlmSubprocessErrorReason).toBe('timeout');
    expect(batch.runtime?.kenlmSubprocessCount).toBe(0);
  });

  it('subprocess unavailable → fail-open', async () => {
    mockedLm.isKenlmSubprocessRunnable.mockReturnValue(false);

    const scorer = createKenlmBatchScorer()!;
    const batch = await scorer.scoreBatch(['测试']);

    expect(mockedLm.runKenlmQueryBatch).not.toHaveBeenCalled();
    expect(batch.scores[0].score).toBe(0);
    expect(batch.runtime?.kenlmSubprocessErrorReason).toBe('subprocess_unavailable');
  });
});
