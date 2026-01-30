/**
 * AggregationStage 单元测试
 * 测试文本聚合阶段的完整流程，包括完全重复检测
 */

import { AggregationStage } from './aggregation-stage';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { DeduplicationHandler } from '../aggregator-middleware-deduplication';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../../inference/inference-service';

describe('AggregationStage', () => {
  let aggregationStage: AggregationStage;
  let mockAggregatorManager: jest.Mocked<AggregatorManager>;
  let mockDeduplicationHandler: jest.Mocked<DeduplicationHandler>;
  const sessionId = 'test-session-1';

  beforeEach(() => {
    // 创建 mock 对象
    mockAggregatorManager = {
      processUtterance: jest.fn(),
      getLastCommittedText: jest.fn(),
    } as any;

    mockDeduplicationHandler = {
      isDuplicate: jest.fn(),
      getLastSentText: jest.fn(),
      setLastSentText: jest.fn(),
    } as any;

    aggregationStage = new AggregationStage(
      mockAggregatorManager,
      mockDeduplicationHandler
    );
  });

  describe('补充动作 A1-3: 完全重复发送防护（B3-1）', () => {
    // 补充动作 A1-3: 完全重复发送防护（B3-1）
    // 锁定风险：防止账本更新顺序错误，防止 send 失败 / 重试路径引入重复发送
    it('【补充动作 A1-3】完全重复发送防护（B3-1）', () => {
      const lastSentText = '天气很好';
      const incomingText = '天气很好';  // 与 lastSentText 完全重复

      // 设置 mock：lastSentText 已存在
      mockDeduplicationHandler.getLastSentText.mockReturnValue(lastSentText);

      // 设置 mock：isDuplicate 返回完全重复
      mockDeduplicationHandler.isDuplicate.mockReturnValue({
        isDuplicate: true,
        reason: 'same_as_last_sent',
      });

      // 设置 mock：aggregatorManager.processUtterance 返回结果
      mockAggregatorManager.processUtterance.mockReturnValue({
        action: 'NEW_STREAM',
        text: incomingText,
        isLastInMergedGroup: false,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      // 创建测试用的 job 和 result
      const job: JobAssignMessage = {
        job_id: 'job-1',
        session_id: sessionId,
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
      } as any;

      const result: JobResult = {
        text_asr: incomingText,
        text_translated: '',
        tts_audio: '',
        extra: {},
        quality_score: 0.9,
        segments: [],
      };

      // 执行聚合（传递lastCommittedText参数，必需参数）
      const aggregationResult = aggregationStage.process(job, result, null);

      // 期望：action = DROP，reason = DUPLICATE_EXACT
      expect(aggregationResult.shouldDiscard).toBe(true);
      expect(aggregationResult.aggregatedText).toBe('');
      expect(aggregationResult.segmentForJobResult).toBe('');
      expect(aggregationResult.shouldWaitForMerge).toBe(false);
      expect(aggregationResult.shouldSendToSemanticRepair).toBe(false);

      // 验证 isDuplicate 被调用
      expect(mockDeduplicationHandler.isDuplicate).toHaveBeenCalledWith(
        sessionId,
        incomingText,
        job.job_id,
        job.utterance_index
      );
    });
  });

  describe('优化验证：lastCommittedText参数处理', () => {
    const createJob = (): JobAssignMessage => ({
      job_id: 'job-1',
      session_id: sessionId,
      utterance_index: 0,
      src_lang: 'zh',
      tgt_lang: 'en',
    } as any);

    const createResult = (text: string): JobResult => ({
      text_asr: text,
      text_translated: '',
      tts_audio: '',
      extra: {},
      quality_score: 0.9,
      segments: [],
    });

    beforeEach(() => {
      mockAggregatorManager.processUtterance.mockReturnValue({
        action: 'NEW_STREAM',
        text: 'test text',
        isLastInMergedGroup: false,
        metrics: { dedupCount: 0, dedupCharsRemoved: 0 },
      });
      mockDeduplicationHandler.isDuplicate.mockReturnValue({
        isDuplicate: false,
        reason: '',
      });
      mockDeduplicationHandler.getLastSentText.mockReturnValue(null);
    });

    it('应该直接使用传递的lastCommittedText参数，不调用getLastCommittedText', () => {
      const lastCommittedText = '上一句文本内容';
      // 长度 > 40 字符，确保 TextForwardMergeManager 门控为 SEND（>40 强制发送）
      const incomingText = '这是新的文本内容，长度足够发送给语义修复的测试句子，确保通过门控，这一段必须超过四十个字符。';

      mockAggregatorManager.processUtterance.mockReturnValue({
        action: 'NEW_STREAM',
        text: incomingText,
        isLastInMergedGroup: false,
        metrics: { dedupCount: 0, dedupCharsRemoved: 0 },
      });

      const result = aggregationStage.process(
        createJob(),
        createResult(incomingText),
        lastCommittedText
      );

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
      expect(result.shouldSendToSemanticRepair).toBe(true);
      // 有 previousText 时，下游收到的是合并长句（lastCommittedText + 本句）
      expect(result.aggregatedText).toBe(lastCommittedText + incomingText);
      expect(result.segmentForJobResult).toBeDefined();
      expect(result.segmentForJobResult!.length).toBeGreaterThan(0);
    });

    it('应该正确处理null的lastCommittedText参数', () => {
      // 长度 > 40 字符，确保门控为 SEND（>40 强制发送）
      const incomingText = '这是一个测试文本，长度足够不会被丢弃的句子，确保通过门控发送，这一段必须超过四十个字符。';

      mockAggregatorManager.processUtterance.mockReturnValue({
        action: 'NEW_STREAM',
        text: incomingText,
        isLastInMergedGroup: false,
        metrics: { dedupCount: 0, dedupCharsRemoved: 0 },
      });

      const result = aggregationStage.process(
        createJob(),
        createResult(incomingText),
        null
      );

      expect(mockAggregatorManager.getLastCommittedText).not.toHaveBeenCalled();
      expect(result.shouldSendToSemanticRepair).toBe(true);
      expect(result.aggregatedText).toBe(incomingText);
      expect(result.segmentForJobResult).toBeDefined();
    });
  });
});
