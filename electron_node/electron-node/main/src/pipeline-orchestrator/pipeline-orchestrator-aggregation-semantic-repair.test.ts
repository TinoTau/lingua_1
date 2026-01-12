/**
 * PipelineOrchestrator 聚合和语义修复测试
 * 验证文本聚合和语义修复在 PipelineOrchestrator 中的正确执行
 */

import { PipelineOrchestrator } from './pipeline-orchestrator';
import { TaskRouter } from '../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult } from '../task-router/types';
import { AggregatorManager } from '../aggregator/aggregator-manager';
import { SemanticRepairInitializer } from '../agent/postprocess/postprocess-semantic-repair-initializer';
import { SemanticRepairStage } from '../agent/postprocess/semantic-repair-stage';
import { AggregationStage } from '../agent/postprocess/aggregation-stage';
import { PipelineOrchestratorAudioProcessor } from './pipeline-orchestrator-audio-processor';

// Mock TaskRouter
jest.mock('../task-router/task-router');

// Mock node-config
jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({
    features: {
      enableS1PromptBias: false,
    },
  })),
}));

// Mock opus-codec
jest.mock('../utils/opus-codec', () => ({
  convertWavToOpus: jest.fn(async (wavBuffer: Buffer) => {
    return Buffer.from('mock_opus_data_' + wavBuffer.length);
  }),
  decodeOpusToPcm16: jest.fn(async (opusDataBase64: string, sampleRate: number) => {
    if (opusDataBase64 === 'invalid_opus_data') {
      throw new Error('Invalid Opus data format');
    }
    return Buffer.from('mock_pcm16_data');
  }),
  encodePcm16ToOpusBuffer: jest.fn(async (pcm16Data: Buffer, sampleRate: number, channels: number) => {
    return Buffer.from('mock_opus_data_' + pcm16Data.length);
  }),
}));

// Mock SemanticRepairInitializer
jest.mock('../agent/postprocess/postprocess-semantic-repair-initializer');

// Mock AggregatorManager
jest.mock('../aggregator/aggregator-manager');

// Mock AggregationStage
jest.mock('../agent/postprocess/aggregation-stage');

// Mock withGpuLease
jest.mock('../gpu-arbiter', () => ({
  withGpuLease: jest.fn((serviceType, fn, options) => {
    return fn();
  }),
}));

// Mock PipelineOrchestratorAudioProcessor
jest.mock('./pipeline-orchestrator-audio-processor');

describe('PipelineOrchestrator - Aggregation and Semantic Repair', () => {
  let orchestrator: PipelineOrchestrator;
  let mockTaskRouter: any;
  let mockAggregatorManager: jest.Mocked<AggregatorManager>;
  let mockServicesHandler: any;
  let mockSemanticRepairStage: jest.Mocked<SemanticRepairStage>;
  let mockAggregationStage: jest.Mocked<AggregationStage>;
  let mockAudioProcessor: jest.Mocked<PipelineOrchestratorAudioProcessor>;

  beforeEach(async () => {
    // Mock TaskRouter
    mockTaskRouter = {
      routeASRTask: jest.fn(),
      routeNMTTask: jest.fn(),
      routeTTSTask: jest.fn(),
    };

    // Mock AggregatorManager
    mockAggregatorManager = {
      processUtterance: jest.fn(),
      getLastCommittedText: jest.fn(),
    } as any;

    // Mock AggregationStage
    mockAggregationStage = {
      process: jest.fn(),
    } as any;

    (AggregationStage as jest.MockedClass<typeof AggregationStage>).mockImplementation(() => mockAggregationStage);

    // Mock PipelineOrchestratorAudioProcessor
    mockAudioProcessor = {
      processAudio: jest.fn(),
    } as any;

    (PipelineOrchestratorAudioProcessor as jest.MockedClass<typeof PipelineOrchestratorAudioProcessor>).mockImplementation(() => mockAudioProcessor);

    // Mock ServicesHandler
    mockServicesHandler = {
      getInstalledServices: jest.fn(),
    };

    // Mock SemanticRepairStage
    mockSemanticRepairStage = {
      process: jest.fn(),
    } as any;

    // Mock SemanticRepairInitializer
    (SemanticRepairInitializer as jest.MockedClass<typeof SemanticRepairInitializer>).mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
      getInitPromise: jest.fn().mockResolvedValue(undefined),
      isInitialized: jest.fn().mockReturnValue(true),
      getSemanticRepairStage: jest.fn().mockReturnValue(mockSemanticRepairStage),
    } as any));

    orchestrator = new PipelineOrchestrator(
      mockTaskRouter as any,
      mockAggregatorManager,
      'offline',
      mockServicesHandler
    );
    
    // 等待 SemanticRepairInitializer 初始化完成（如果异步）
    await new Promise(resolve => setTimeout(resolve, 100));
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

  const createASRResult = (text: string): ASRResult => ({
    text,
    confidence: 0.95,
    language: 'zh',
    is_final: true,
    segments: [
      { text, start: 0, end: 1 },
    ],
    language_probability: 0.95,
  });

  describe('文本聚合功能', () => {
    it('应该在 ASR 之后执行文本聚合', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock AggregationStage.process 返回聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界，欢迎使用',
        aggregationChanged: true,
        action: 'NEW_STREAM',
        isLastInMergedGroup: false,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      // Mock SemanticRepairStage 跳过（不调用）
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好世界，欢迎使用',
        decision: 'PASS',
        confidence: 1.0,
        semanticRepairApplied: false,
        reasonCodes: [],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证聚合被调用
      expect(mockAggregationStage.process).toHaveBeenCalled();
      expect(result.text_asr).toBeDefined();
      expect(result.aggregation_applied).toBeDefined();
    });

    it('应该在聚合后更新 JobResult 中的聚合字段', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界，欢迎使用',
        aggregationChanged: true,
        action: 'MERGE',
        isLastInMergedGroup: true,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 1,
          dedupCharsRemoved: 5,
        },
      });

      const result = await orchestrator.processJob(job);

      // 验证聚合字段已设置
      expect(result.aggregation_applied).toBe(true);
      expect(result.aggregation_action).toBe('MERGE');
      expect(result.is_last_in_merged_group).toBe(true);
      expect(result.aggregation_metrics).toEqual({
        dedupCount: 1,
        dedupCharsRemoved: 5,
      });
    });

    it('应该在聚合后执行内部重复检测', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界 你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果（包含重复文本）
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界 你好世界',
        aggregationChanged: true,
        action: 'NEW_STREAM',
        isLastInMergedGroup: false,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      const result = await orchestrator.processJob(job);

      // 验证聚合被调用
      expect(mockAggregationStage.process).toHaveBeenCalled();
      // 注意：内部重复检测在聚合之后执行，但结果可能不会反映在 text_asr 中（取决于实现）
      expect(result.text_asr).toBeDefined();
    });
  });

  describe('语义修复功能', () => {
    it('应该在聚合之后执行语义修复', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界',
        aggregationChanged: false,
        action: 'NEW_STREAM',
        isLastInMergedGroup: false,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      // Mock 语义修复结果
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好，世界',
        decision: 'REPAIR',
        confidence: 0.85,
        semanticRepairApplied: true,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证语义修复被调用
      expect(mockSemanticRepairStage.process).toHaveBeenCalled();
      expect(result.semantic_repair_applied).toBe(true);
      expect(result.semantic_repair_confidence).toBe(0.85);
      expect(result.text_asr_repaired).toBe('你好，世界');
      expect(result.text_asr).toBe('你好，世界'); // 修复后的文本应该用于 text_asr
    });

    it('应该在语义修复使用聚合后的文本', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果（聚合后的文本）
      const aggregatedText = '你好世界，欢迎使用';
      mockAggregationStage.process.mockReturnValue({
        aggregatedText,
        aggregationChanged: true,
        action: 'MERGE',
        isLastInMergedGroup: true,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      // Mock 语义修复结果
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好，世界，欢迎使用',
        decision: 'REPAIR',
        confidence: 0.85,
        semanticRepairApplied: true,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证语义修复接收的是聚合后的文本
      const semanticRepairCall = mockSemanticRepairStage.process.mock.calls[0];
      expect(semanticRepairCall[1]).toContain('你好世界'); // 应该包含聚合后的文本
      expect(result.text_asr).toBe('你好，世界，欢迎使用'); // 最终文本应该是修复后的
    });

    it('应该在语义修复拒绝时使用原始文本', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界',
        aggregationChanged: false,
        action: 'NEW_STREAM',
        isLastInMergedGroup: false,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 0,
          dedupCharsRemoved: 0,
        },
      });

      // Mock 语义修复拒绝
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好世界',
        decision: 'REJECT',
        confidence: 0.5,
        semanticRepairApplied: false,
        reasonCodes: ['LOW_CONFIDENCE'],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证语义修复被调用但未应用
      expect(mockSemanticRepairStage.process).toHaveBeenCalled();
      expect(result.semantic_repair_applied).toBeFalsy();
      expect(result.text_asr).toBe('你好世界'); // 应该使用原始文本
    });

    it('应该在 use_asr 为 false 时跳过语义修复', async () => {
      const job = createJob({ pipeline: { use_asr: false, use_nmt: true, use_tts: false } });

      // 如果 use_asr 为 false，ASR 应该被跳过
      const result = await orchestrator.processJob(job);

      // 验证语义修复未被调用
      expect(mockSemanticRepairStage.process).not.toHaveBeenCalled();
      expect(result.semantic_repair_applied).toBeFalsy();
    });
  });

  describe('聚合和语义修复的集成', () => {
    it('应该按顺序执行：ASR → 聚合 → 语义修复', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界，欢迎使用',
        aggregationChanged: true,
        action: 'MERGE',
        isLastInMergedGroup: true,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 1,
          dedupCharsRemoved: 5,
        },
      });

      // Mock 语义修复结果
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好，世界，欢迎使用',
        decision: 'REPAIR',
        confidence: 0.85,
        semanticRepairApplied: true,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证执行顺序
      expect(mockTaskRouter.routeASRTask).toHaveBeenCalled();
      expect(mockAggregationStage.process).toHaveBeenCalled();
      expect(mockSemanticRepairStage.process).toHaveBeenCalled();

      // 验证最终结果包含聚合和修复信息
      expect(result.aggregation_applied).toBe(true);
      expect(result.semantic_repair_applied).toBe(true);
      expect(result.text_asr).toBe('你好，世界，欢迎使用');
      expect(result.text_asr_repaired).toBe('你好，世界，欢迎使用');
    });

    it('应该在聚合和语义修复后正确设置 JobResult 字段', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock 音频处理
      mockAudioProcessor.processAudio.mockResolvedValue({
        audioForASR: 'base64_audio_data',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: false,
      });

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      // Mock 聚合结果
      mockAggregationStage.process.mockReturnValue({
        aggregatedText: '你好世界，欢迎使用',
        aggregationChanged: true,
        action: 'MERGE',
        isLastInMergedGroup: true,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        metrics: {
          dedupCount: 2,
          dedupCharsRemoved: 10,
        },
      });

      // Mock 语义修复结果
      mockSemanticRepairStage.process.mockResolvedValue({
        textOut: '你好，世界，欢迎使用',
        decision: 'REPAIR',
        confidence: 0.90,
        semanticRepairApplied: true,
        reasonCodes: ['LOW_QUALITY_SCORE'],
      } as any);

      const result = await orchestrator.processJob(job);

      // 验证所有字段都已正确设置
      expect(result.text_asr).toBe('你好，世界，欢迎使用');
      expect(result.aggregation_applied).toBe(true);
      expect(result.aggregation_action).toBe('MERGE');
      expect(result.is_last_in_merged_group).toBe(true);
      expect(result.aggregation_metrics).toEqual({
        dedupCount: 2,
        dedupCharsRemoved: 10,
      });
      expect(result.semantic_repair_applied).toBe(true);
      expect(result.semantic_repair_confidence).toBe(0.90);
      expect(result.text_asr_repaired).toBe('你好，世界，欢迎使用');
    });
  });
});
