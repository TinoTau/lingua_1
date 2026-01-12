/**
 * PostProcessCoordinator 翻译功能测试
 * 验证文本聚合和语义修复移动后，翻译功能仍然正常工作
 */

import { PostProcessCoordinator } from './postprocess-coordinator';
import { TaskRouter } from '../../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../../inference/inference-service';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { TranslationStage } from './translation-stage';
import { NMTResult } from '../../task-router/types';
import { DedupStage } from './dedup-stage';
import { PostProcessMergeHandler } from './postprocess-merge-handler';
import { PostProcessTextFilter } from './postprocess-text-filter';

// Mock TaskRouter
jest.mock('../../task-router/task-router');

// Mock node-config
jest.mock('../../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({
    features: {
      enablePostProcessTranslation: true,
    },
  })),
}));

// Mock TranslationStage
jest.mock('./translation-stage');

// Mock AggregatorManager
jest.mock('../../aggregator/aggregator-manager');

// Mock DedupStage
jest.mock('./dedup-stage');

// Mock PostProcessMergeHandler
jest.mock('./postprocess-merge-handler');

// Mock PostProcessTextFilter
jest.mock('./postprocess-text-filter');

// Mock TTSStage
const mockTTSStageInstance = {
  process: jest.fn().mockResolvedValue({
    ttsAudio: '',
    ttsFormat: 'opus',
    ttsTimeMs: 0,
  }),
};

jest.mock('./tts-stage', () => ({
  TTSStage: jest.fn().mockImplementation(() => mockTTSStageInstance),
}));

// Mock TONEStage
const mockTONEStageInstance = {
  process: jest.fn().mockResolvedValue({
    audio: undefined,
    embedding: undefined,
    speaker_id: undefined,
    toneTimeMs: 0,
  }),
};

jest.mock('./tone-stage', () => ({
  TONEStage: jest.fn().mockImplementation(() => mockTONEStageInstance),
}));

describe('PostProcessCoordinator - Translation Functionality', () => {
  let coordinator: PostProcessCoordinator;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockAggregatorManager: AggregatorManager | null;
  let mockTranslationStage: jest.Mocked<TranslationStage>;
  let mockDedupStage: jest.Mocked<DedupStage>;
  let mockMergeHandler: jest.Mocked<PostProcessMergeHandler>;
  let mockTextFilter: jest.Mocked<PostProcessTextFilter>;

  beforeEach(() => {
    // Mock TaskRouter
    mockTaskRouter = {
      routeNMTTask: jest.fn(),
      routeTTSTask: jest.fn(),
      routeTONETask: jest.fn(),
    } as any;

    // Mock AggregatorManager
    mockAggregatorManager = null;

    // Mock TranslationStage
    mockTranslationStage = {
      process: jest.fn(),
    } as any;

    (TranslationStage as jest.MockedClass<typeof TranslationStage>).mockImplementation(() => mockTranslationStage);

    // Mock DedupStage
    mockDedupStage = {
      process: jest.fn().mockReturnValue({ shouldSend: true }),
      removeSession: jest.fn(),
    } as any;

    (DedupStage as jest.MockedClass<typeof DedupStage>).mockImplementation(() => mockDedupStage);

    // Mock PostProcessMergeHandler
    mockMergeHandler = {
      process: jest.fn().mockReturnValue({ shouldReturn: false }),
    } as any;

    (PostProcessMergeHandler as jest.MockedClass<typeof PostProcessMergeHandler>).mockImplementation(() => mockMergeHandler);

    // Mock PostProcessTextFilter
    mockTextFilter = {
      process: jest.fn().mockReturnValue({ shouldReturn: false }),
    } as any;

    (PostProcessTextFilter as jest.MockedClass<typeof PostProcessTextFilter>).mockImplementation(() => mockTextFilter);

    coordinator = new PostProcessCoordinator(
      mockAggregatorManager,
      mockTaskRouter,
      null,
      {
        enabled: true,
        translationConfig: {
          nmtRepairEnabled: false,
        },
      }
    );
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

  const createJobResult = (overrides?: Partial<JobResult>): JobResult => ({
    text_asr: '你好世界',
    text_translated: '',
    tts_audio: '',
    tts_format: 'pcm16',
    ...overrides,
  });

  describe('使用聚合后的文本进行翻译', () => {
    it('应该使用 JobResult 中的聚合后文本进行翻译', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好世界，欢迎使用', // 聚合后的文本
        aggregation_applied: true,
        aggregation_action: 'MERGE',
        is_last_in_merged_group: true,
        aggregation_metrics: {
          dedupCount: 1,
          dedupCharsRemoved: 5,
        },
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译被调用，且使用的是聚合后的文本
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好世界，欢迎使用'); // 应该使用聚合后的文本
      expect(postProcessResult.translatedText).toBe('Hello World, Welcome');
    });

    it('应该使用语义修复后的文本进行翻译', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好，世界，欢迎使用', // 语义修复后的文本
        aggregation_applied: true,
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.85,
        text_asr_repaired: '你好，世界，欢迎使用',
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello, World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译被调用，且使用的是语义修复后的文本
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好，世界，欢迎使用'); // 应该使用语义修复后的文本
      expect(postProcessResult.translatedText).toBe('Hello, World, Welcome');
    });

    it('应该优先使用语义修复后的文本（如果存在）', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好世界，欢迎使用', // 聚合后的文本
        text_asr_repaired: '你好，世界，欢迎使用', // 语义修复后的文本
        aggregation_applied: true,
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.85,
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello, World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译使用的是语义修复后的文本（而不是聚合后的文本）
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好，世界，欢迎使用'); // 应该使用语义修复后的文本
      expect(postProcessResult.translatedText).toBe('Hello, World, Welcome');
    });
  });

  describe('翻译功能完整性', () => {
    it('应该在聚合和语义修复后正常执行翻译', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好，世界，欢迎使用', // 聚合和语义修复后的文本
        aggregation_applied: true,
        aggregation_action: 'MERGE',
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.85,
        text_asr_repaired: '你好，世界，欢迎使用',
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello, World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译成功
      expect(postProcessResult.translatedText).toBe('Hello, World, Welcome');
      expect(postProcessResult.shouldSend).toBe(true);
    });

    it('应该在 use_nmt 为 false 时跳过翻译', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: false,
          use_tts: false,
        },
      });
      const result = createJobResult({
        text_asr: '你好世界',
        aggregation_applied: true,
      });

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译未被调用
      expect(mockTranslationStage.process).not.toHaveBeenCalled();
      expect(postProcessResult.translatedText).toBe('');
    });

    it('应该在 NMT-only 模式下使用 input_text', async () => {
      const job = createJob({
        pipeline: {
          use_asr: false,
          use_nmt: true,
          use_tts: false,
        },
        input_text: '你好世界',
      } as any);
      const result = createJobResult({
        text_asr: '',
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello World',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译被调用，且使用的是 input_text
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好世界'); // 应该使用 input_text
      expect(postProcessResult.translatedText).toBe('Hello World');
    });
  });

  describe('聚合状态传递', () => {
    it('应该正确传递聚合状态到后续处理', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好世界，欢迎使用',
        aggregation_applied: true,
        aggregation_action: 'MERGE',
        is_last_in_merged_group: true,
        aggregation_metrics: {
          dedupCount: 2,
          dedupCharsRemoved: 10,
        },
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证聚合状态被正确使用
      expect(mockTranslationStage.process).toHaveBeenCalled();
      // 验证翻译使用的是聚合后的文本
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好世界，欢迎使用');
      expect(postProcessResult.translatedText).toBe('Hello World, Welcome');
    });

    it('应该在聚合未应用时使用原始文本', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好世界', // 原始文本（未聚合）
        aggregation_applied: false,
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello World',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译使用的是原始文本
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好世界');
      expect(postProcessResult.translatedText).toBe('Hello World');
    });
  });

  describe('完整流程测试', () => {
    it('应该正确处理：聚合 → 语义修复 → 翻译', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好，世界，欢迎使用', // 聚合和语义修复后的文本
        aggregation_applied: true,
        aggregation_action: 'MERGE',
        is_last_in_merged_group: true,
        aggregation_metrics: {
          dedupCount: 1,
          dedupCharsRemoved: 5,
        },
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.85,
        text_asr_repaired: '你好，世界，欢迎使用',
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello, World, Welcome',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证完整流程
      expect(mockTranslationStage.process).toHaveBeenCalled();
      expect(postProcessResult.translatedText).toBe('Hello, World, Welcome');
      expect(postProcessResult.shouldSend).toBe(true);
    });

    it('应该在聚合和语义修复后正确传递文本到翻译', async () => {
      const job = createJob();
      const result = createJobResult({
        text_asr: '你好世界', // 原始 ASR 文本
        text_asr_repaired: '你好，世界', // 聚合和语义修复后的文本
        aggregation_applied: true,
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.90,
      });

      // Mock 翻译结果
      mockTranslationStage.process.mockResolvedValue({
        translatedText: 'Hello, World',
      } as any);

      const postProcessResult = await coordinator.process(job, result);

      // 验证翻译使用的是语义修复后的文本（而不是原始文本）
      expect(mockTranslationStage.process).toHaveBeenCalled();
      const translationCall = mockTranslationStage.process.mock.calls[0];
      expect(translationCall[1]).toBe('你好，世界'); // 应该使用语义修复后的文本
      expect(postProcessResult.translatedText).toBe('Hello, World');
    });
  });
});
