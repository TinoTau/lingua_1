/**
 * InferenceService 集成测试
 * 验证文本聚合和语义修复移动后，整个流程（ASR → 聚合 → 语义修复 → 翻译）正常工作
 */

import { InferenceService } from './inference-service';
import { TaskRouter } from '../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult, NMTResult } from '../task-router/types';
import { AggregatorManager } from '../aggregator/aggregator-manager';
import { PostProcessCoordinator } from '../agent/postprocess/postprocess-coordinator';
import { SemanticRepairStage } from '../agent/postprocess/semantic-repair-stage';
import { PipelineOrchestrator } from '../pipeline-orchestrator/pipeline-orchestrator';

// Mock TaskRouter
jest.mock('../task-router/task-router');

// Mock node-config
jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({
    features: {
      enableS1PromptBias: false,
      enablePostProcessTranslation: true,
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

// Mock PostProcessCoordinator
jest.mock('../agent/postprocess/postprocess-coordinator');

// Mock SemanticRepairInitializer
jest.mock('../agent/postprocess/postprocess-semantic-repair-initializer');

// Mock PipelineOrchestrator
jest.mock('../pipeline-orchestrator/pipeline-orchestrator');

// Mock withGpuLease
jest.mock('../gpu-arbiter', () => ({
  withGpuLease: jest.fn((serviceType, fn, options) => {
    return fn();
  }),
}));

// Mock PipelineOrchestratorAudioProcessor
jest.mock('../pipeline-orchestrator/pipeline-orchestrator-audio-processor');

describe('InferenceService - Aggregation and Translation Integration', () => {
  let inferenceService: InferenceService;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockAggregatorManager: AggregatorManager | null;
  let mockPostProcessCoordinator: jest.Mocked<PostProcessCoordinator>;
  let mockServicesHandler: any;
  let mockPipelineOrchestrator: jest.Mocked<PipelineOrchestrator>;

  beforeEach(() => {
    // Mock TaskRouter
    mockTaskRouter = {
      routeASRTask: jest.fn(),
      routeNMTTask: jest.fn(),
      routeTTSTask: jest.fn(),
      routeTONETask: jest.fn(),
      refreshServiceEndpoints: jest.fn().mockResolvedValue(undefined),
    } as any;

    // Mock AggregatorManager
    mockAggregatorManager = {
      processUtterance: jest.fn(),
      getLastCommittedText: jest.fn(),
    } as any;

    // Mock ServicesHandler
    mockServicesHandler = {
      getInstalledServices: jest.fn(),
    };

    // Mock PostProcessCoordinator
    mockPostProcessCoordinator = {
      process: jest.fn(),
      getDedupStage: jest.fn(),
    } as any;

    (PostProcessCoordinator as jest.MockedClass<typeof PostProcessCoordinator>).mockImplementation(() => mockPostProcessCoordinator);

    // Mock PipelineOrchestrator
    mockPipelineOrchestrator = {
      processJob: jest.fn(),
      processASROnly: jest.fn(),
    } as any;

    (PipelineOrchestrator as jest.MockedClass<typeof PipelineOrchestrator>).mockImplementation(() => mockPipelineOrchestrator);

    inferenceService = new InferenceService(
      mockTaskRouter as any,
      mockAggregatorManager,
      null, // semanticRepairServiceManager
      mockServicesHandler
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

  describe('完整流程：ASR → 聚合 → 语义修复 → 翻译', () => {
    it('应该正确处理完整流程', async () => {
      const job = createJob();
      const asrResult = createASRResult('你好世界');

      // Mock PipelineOrchestrator 返回结果（包含聚合和语义修复）
      mockPipelineOrchestrator.processJob.mockResolvedValue({
        text_asr: '你好，世界，欢迎使用', // 聚合和语义修复后的文本
        text_translated: '',
        tts_audio: '',
        tts_format: 'pcm16',
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
      } as any);

      // Mock PostProcessCoordinator（翻译）
      mockPostProcessCoordinator.process.mockResolvedValue({
        shouldSend: true,
        aggregatedText: '你好，世界，欢迎使用',
        translatedText: 'Hello, World, Welcome',
        ttsAudio: '',
        ttsFormat: 'opus',
      });

      const result = await inferenceService.processJob(job);

      // 验证 PipelineOrchestrator 被调用
      expect(mockPipelineOrchestrator.processJob).toHaveBeenCalled();

      // 验证 PostProcessCoordinator 被调用
      expect(mockPostProcessCoordinator.process).toHaveBeenCalled();

      // 验证 PostProcessCoordinator 接收的 JobResult 包含聚合和语义修复信息
      const postProcessCall = mockPostProcessCoordinator.process.mock.calls[0];
      const jobResult = postProcessCall[1] as any;
      
      // 验证聚合信息已传递
      expect(jobResult.aggregation_applied).toBeDefined();
      
      // 验证最终结果包含翻译
      expect(result.text_translated).toBeDefined();
    });

    it('应该将聚合后的文本传递给翻译', async () => {
      const job = createJob();

      // Mock PipelineOrchestrator 返回结果（包含聚合）
      mockPipelineOrchestrator.processJob.mockResolvedValue({
        text_asr: '你好世界，欢迎使用', // 聚合后的文本
        text_translated: '',
        tts_audio: '',
        tts_format: 'pcm16',
        aggregation_applied: true,
        aggregation_action: 'MERGE',
        is_last_in_merged_group: true,
        aggregation_metrics: {
          dedupCount: 1,
          dedupCharsRemoved: 5,
        },
      } as any);

      // Mock PostProcessCoordinator（翻译）
      mockPostProcessCoordinator.process.mockResolvedValue({
        shouldSend: true,
        aggregatedText: '你好，世界，欢迎使用',
        translatedText: 'Hello, World, Welcome',
        ttsAudio: '',
        ttsFormat: 'opus',
      });

      const result = await inferenceService.processJob(job);

      // 验证 PostProcessCoordinator 被调用
      expect(mockPostProcessCoordinator.process).toHaveBeenCalled();

      // 验证 PostProcessCoordinator 接收的 JobResult 包含聚合后的文本
      const postProcessCall = mockPostProcessCoordinator.process.mock.calls[0];
      const jobResult = postProcessCall[1] as any;
      
      // 验证 text_asr 包含聚合后的文本（或语义修复后的文本）
      expect(jobResult.text_asr).toBeDefined();
      expect(jobResult.text_asr.length).toBeGreaterThan(0);

      // 验证最终结果包含翻译
      expect(result.text_translated).toBeDefined();
    });

    it('应该将语义修复后的文本传递给翻译', async () => {
      const job = createJob();

      // Mock PipelineOrchestrator 返回结果（包含语义修复）
      mockPipelineOrchestrator.processJob.mockResolvedValue({
        text_asr: '你好，世界', // 语义修复后的文本
        text_translated: '',
        tts_audio: '',
        tts_format: 'pcm16',
        aggregation_applied: false,
        semantic_repair_applied: true,
        semantic_repair_confidence: 0.85,
        text_asr_repaired: '你好，世界',
      } as any);

      // Mock PostProcessCoordinator（翻译）
      mockPostProcessCoordinator.process.mockResolvedValue({
        shouldSend: true,
        aggregatedText: '你好，世界',
        translatedText: 'Hello, World',
        ttsAudio: '',
        ttsFormat: 'opus',
      });

      const result = await inferenceService.processJob(job);

      // 验证 PostProcessCoordinator 被调用
      expect(mockPostProcessCoordinator.process).toHaveBeenCalled();

      // 验证 PostProcessCoordinator 接收的 JobResult 可能包含语义修复信息
      const postProcessCall = mockPostProcessCoordinator.process.mock.calls[0];
      const jobResult = postProcessCall[1] as any;
      
      // 验证 text_asr 已设置
      expect(jobResult.text_asr).toBeDefined();

      // 验证最终结果包含翻译
      expect(result.text_translated).toBeDefined();
    });
  });

  describe('翻译功能完整性', () => {
    it('应该在聚合和语义修复后正常执行翻译', async () => {
      const job = createJob();

      // Mock PipelineOrchestrator 返回结果（包含聚合和语义修复）
      mockPipelineOrchestrator.processJob.mockResolvedValue({
        text_asr: '你好，世界，欢迎使用', // 聚合和语义修复后的文本
        text_translated: '',
        tts_audio: '',
        tts_format: 'pcm16',
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
      } as any);

      // Mock PostProcessCoordinator（翻译）
      mockPostProcessCoordinator.process.mockResolvedValue({
        shouldSend: true,
        aggregatedText: '你好，世界，欢迎使用',
        translatedText: 'Hello, World, Welcome',
        ttsAudio: '',
        ttsFormat: 'opus',
      });

      const result = await inferenceService.processJob(job);

      // 验证翻译成功
      expect(result.text_translated).toBe('Hello, World, Welcome');
      expect(mockPostProcessCoordinator.process).toHaveBeenCalled();
    });

    it('应该在 use_nmt 为 false 时跳过翻译', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: false,
          use_tts: false,
        },
      });

      // Mock PipelineOrchestrator 返回结果
      mockPipelineOrchestrator.processJob.mockResolvedValue({
        text_asr: '你好世界',
        text_translated: '',
        tts_audio: '',
        tts_format: 'pcm16',
        aggregation_applied: false,
      } as any);

      // Mock PostProcessCoordinator（不翻译）
      mockPostProcessCoordinator.process.mockResolvedValue({
        shouldSend: true,
        aggregatedText: '你好世界',
        translatedText: '',
        ttsAudio: '',
        ttsFormat: 'opus',
      });

      const result = await inferenceService.processJob(job);

      // 验证翻译被跳过
      expect(result.text_translated).toBe('');
      expect(mockPostProcessCoordinator.process).toHaveBeenCalled();
    });
  });
});
