/**
 * PostProcessTextFilter 单元测试
 */

import { PostProcessTextFilter } from './postprocess-text-filter';
import { JobAssignMessage } from '@shared/protocols/messages';
import { AggregationStageResult } from './aggregation-stage';

describe('PostProcessTextFilter', () => {
  let filter: PostProcessTextFilter;

  beforeEach(() => {
    filter = new PostProcessTextFilter();
  });

  const createJob = (overrides?: Partial<JobAssignMessage>): JobAssignMessage => ({
    type: 'job_assign',
    job_id: 'test-job-1',
    attempt_id: 1,
    session_id: 'test-session',
    utterance_index: 0,
    src_lang: 'zh',
    tgt_lang: 'en',
    dialect: null,
    pipeline: {
      use_asr: true,
      use_nmt: true,
      use_tts: true,
    },
    audio: 'base64_opus_audio_data',
    audio_format: 'opus',
    sample_rate: 16000,
    trace_id: 'test-trace',
    ...overrides,
  });

  const createAggregationResult = (overrides?: Partial<AggregationStageResult>): AggregationStageResult => ({
    aggregatedText: '你好世界',
    aggregationChanged: false,
    action: 'NEW_STREAM',
    isLastInMergedGroup: true,
    isFirstInMergedGroup: false,
    shouldDiscard: false,
    shouldWaitForMerge: false,
    shouldSendToSemanticRepair: true,
    ...overrides,
  });

  describe('文本丢弃处理', () => {
    it('应该在 shouldDiscard=true 时返回 shouldSend=false', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        shouldDiscard: true,
        aggregatedText: '短文本',
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.shouldSend).toBe(false);
      expect(result.result?.aggregatedText).toBe('');
      expect(result.result?.reason).toContain('Text too short');
    });
  });

  describe('等待合并处理', () => {
    it('应该在 shouldWaitForMerge=true 时返回 shouldSend=false', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        shouldWaitForMerge: true,
        aggregatedText: '中等长度文本',
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.shouldSend).toBe(false);
      expect(result.result?.aggregatedText).toBe('');
      expect(result.result?.reason).toContain('Text length 6-20 chars');
    });
  });

  describe('空文本处理', () => {
    it('应该在聚合文本为空时返回 shouldSend=false', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        aggregatedText: '',
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.shouldSend).toBe(false);
      expect(result.result?.aggregatedText).toBe('');
      expect(result.result?.reason).toContain('Aggregated text is empty');
    });

    it('应该在聚合文本只有空格时返回 shouldSend=false', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        aggregatedText: '   ',
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.shouldSend).toBe(false);
    });
  });

  describe('正常流程', () => {
    it('应该在正常文本时继续处理', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        aggregatedText: '这是一个正常长度的文本',
        shouldDiscard: false,
        shouldWaitForMerge: false,
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      expect(result.result).toBeUndefined();
    });

    it('应该正确传递 action 和 metrics', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        shouldDiscard: true,
        action: 'MERGE',
        metrics: {
          dedupCount: 2,
          dedupCharsRemoved: 5,
        },
      });

      const result = filter.process(job, aggregationResult);

      expect(result.result?.action).toBe('MERGE');
      expect(result.result?.metrics).toEqual({
        dedupCount: 2,
        dedupCharsRemoved: 5,
      });
    });
  });

  describe('边界情况', () => {
    it('应该处理 undefined aggregatedText', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        aggregatedText: undefined as any,
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result?.shouldSend).toBe(false);
    });

    it('应该处理 null aggregatedText', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        aggregatedText: null as any,
      });

      const result = filter.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result?.shouldSend).toBe(false);
    });
  });
});
