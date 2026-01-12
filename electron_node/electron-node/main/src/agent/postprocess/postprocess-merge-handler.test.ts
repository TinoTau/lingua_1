/**
 * PostProcessMergeHandler 单元测试
 */

import { PostProcessMergeHandler } from './postprocess-merge-handler';
import { JobAssignMessage } from '@shared/protocols/messages';
import { AggregationStageResult } from './aggregation-stage';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';

// Mock SequentialExecutor
jest.mock('../../sequential-executor/sequential-executor-factory', () => ({
  getSequentialExecutor: jest.fn(),
}));

describe('PostProcessMergeHandler', () => {
  let handler: PostProcessMergeHandler;
  let mockSequentialExecutor: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSequentialExecutor = {
      cancelTask: jest.fn(),
    };

    (getSequentialExecutor as jest.Mock).mockReturnValue(mockSequentialExecutor);

    handler = new PostProcessMergeHandler();
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

  describe('合并处理', () => {
    it('应该在 MERGE 且不是最后一个时返回空结果并取消任务', () => {
      const job = createJob({ utterance_index: 1 });
      const aggregationResult = createAggregationResult({
        action: 'MERGE',
        isLastInMergedGroup: false,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result?.shouldSend).toBe(true);
      expect(result.result?.aggregatedText).toBe('');
      expect(result.result?.action).toBe('MERGE');

      // 验证取消了所有服务类型的任务
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledTimes(3);
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Task merged into later utterance',
        'NMT'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Task merged into later utterance',
        'TTS'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Task merged into later utterance',
        'SEMANTIC_REPAIR'
      );
    });

    it('应该在 MERGE 且是最后一个时继续处理', () => {
      const job = createJob({ utterance_index: 2 });
      const aggregationResult = createAggregationResult({
        action: 'MERGE',
        isLastInMergedGroup: true,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      expect(result.result).toBeUndefined();
      expect(mockSequentialExecutor.cancelTask).not.toHaveBeenCalled();
    });
  });

  describe('向前合并处理', () => {
    it('应该在 mergedFromUtteranceIndex 存在时取消前一个 utterance 的任务', () => {
      const job = createJob({ utterance_index: 2 });
      const aggregationResult = createAggregationResult({
        mergedFromUtteranceIndex: 1,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      
      // 验证取消了前一个 utterance 的所有服务类型的任务
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledTimes(3);
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Previous utterance text merged into current utterance (2)',
        'NMT'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Previous utterance text merged into current utterance (2)',
        'TTS'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Previous utterance text merged into current utterance (2)',
        'SEMANTIC_REPAIR'
      );
    });

    it('应该在 mergedFromPendingUtteranceIndex 存在时取消待合并 utterance 的任务', () => {
      const job = createJob({ utterance_index: 2 });
      const aggregationResult = createAggregationResult({
        mergedFromPendingUtteranceIndex: 1,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      
      // 验证取消了待合并 utterance 的所有服务类型的任务
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledTimes(3);
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Pending utterance text merged into current utterance (2)',
        'NMT'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Pending utterance text merged into current utterance (2)',
        'TTS'
      );
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        1,
        'Pending utterance text merged into current utterance (2)',
        'SEMANTIC_REPAIR'
      );
    });

    it('应该同时处理 mergedFromUtteranceIndex 和 mergedFromPendingUtteranceIndex', () => {
      const job = createJob({ utterance_index: 3 });
      const aggregationResult = createAggregationResult({
        mergedFromUtteranceIndex: 1,
        mergedFromPendingUtteranceIndex: 2,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      
      // 验证取消了两个 utterance 的任务（每个 3 个服务类型，共 6 次）
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledTimes(6);
    });
  });

  describe('正常流程', () => {
    it('应该在正常流程时继续处理', () => {
      const job = createJob();
      const aggregationResult = createAggregationResult({
        action: 'NEW_STREAM',
        isLastInMergedGroup: true,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(false);
      expect(result.result).toBeUndefined();
      expect(mockSequentialExecutor.cancelTask).not.toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('应该处理空的 session_id', () => {
      const job = createJob({ session_id: '' });
      const aggregationResult = createAggregationResult({
        action: 'MERGE',
        isLastInMergedGroup: false,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        '',
        0,
        'Task merged into later utterance',
        'NMT'
      );
    });

    it('应该处理 undefined utterance_index', () => {
      const job = createJob({ utterance_index: undefined as any });
      const aggregationResult = createAggregationResult({
        action: 'MERGE',
        isLastInMergedGroup: false,
      });

      const result = handler.process(job, aggregationResult);

      expect(result.shouldReturn).toBe(true);
      expect(mockSequentialExecutor.cancelTask).toHaveBeenCalledWith(
        'test-session',
        0,
        'Task merged into later utterance',
        'NMT'
      );
    });
  });
});
