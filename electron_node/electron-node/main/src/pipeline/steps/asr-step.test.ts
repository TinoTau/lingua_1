/**
 * ASR Step 单元测试
 * 
 * 测试 originalJobInfo 传递和 utteranceIndex 正确使用
 * 符合 LONG_UTTERANCE_JOB_CONTAINER_POLICY.md 的要求
 */

import { runAsrStep } from './asr-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { OriginalJobInfo } from '../../pipeline-orchestrator/audio-aggregator-types';

// Mock dependencies
jest.mock('../../logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../gpu-arbiter', () => ({
  withGpuLease: jest.fn(async (stage, fn) => fn()),
}));

jest.mock('../job-pipeline', () => ({
  runJobPipeline: jest.fn(),
}));

jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-audio-processor');
jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor');
jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-asr');
// Mock original-job-result-dispatcher module
const mockRegisterOriginalJob = jest.fn();
const mockAddASRSegment = jest.fn();
jest.mock('../../pipeline-orchestrator/original-job-result-dispatcher', () => {
  const actual = jest.requireActual('../../pipeline-orchestrator/original-job-result-dispatcher');
  return {
    ...actual,
    OriginalJobResultDispatcher: jest.fn().mockImplementation(() => ({
      registerOriginalJob: mockRegisterOriginalJob,
      addASRSegment: mockAddASRSegment,
    })),
  };
});

import logger from '../../logger';
import { withGpuLease } from '../../gpu-arbiter';
import { runJobPipeline } from '../job-pipeline';
import { PipelineOrchestratorAudioProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorASRHandler } from '../../pipeline-orchestrator/pipeline-orchestrator-asr';
import { OriginalJobResultDispatcher } from '../../pipeline-orchestrator/original-job-result-dispatcher';

describe('ASR Step - UtteranceIndex Fix', () => {
  let mockServices: ServicesBundle;
  let mockAudioProcessor: jest.Mocked<PipelineOrchestratorAudioProcessor>;
  let mockAsrHandler: jest.Mocked<PipelineOrchestratorASRHandler>;
  let mockResultSender: any;
  let dispatcher: OriginalJobResultDispatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterOriginalJob.mockClear();
    mockAddASRSegment.mockClear();

    // Mock AudioProcessor
    mockAudioProcessor = {
      processAudio: jest.fn(),
    } as any;

    // Mock ASRHandler
    mockAsrHandler = {
      buildPrompt: jest.fn(() => null),
    } as any;

    // Mock ResultSender
    mockResultSender = {
      sendJobResult: jest.fn(),
    };

    // Mock TaskRouter
    const mockTaskRouter = {
      routeASRTask: jest.fn().mockResolvedValue({
        text: 'test asr text',
        segments: [],
        language_probabilities: {},
      }),
    };

    // Mock ServicesBundle
    mockServices = {
      audioAggregator: {} as any,
      taskRouter: mockTaskRouter as any,
      aggregatorManager: {} as any,
      resultSender: mockResultSender,
    } as ServicesBundle;

    // Mock PipelineOrchestratorAudioProcessor constructor
    (PipelineOrchestratorAudioProcessor as any).mockImplementation(() => mockAudioProcessor);
    (PipelineOrchestratorASRHandler as any).mockImplementation(() => mockAsrHandler);
    (PipelineOrchestratorASRResultProcessor as any).mockImplementation(() => ({}));

    // Mock runJobPipeline
    (runJobPipeline as jest.MockedFunction<typeof runJobPipeline>).mockResolvedValue({
      text_asr: 'test asr text',
      text_translated: 'test translated text',
      tts_audio: Buffer.from('test audio'),
      tts_format: 'opus',
      should_send: true,
      extra: {},
    });

    // Mock withGpuLease
    (withGpuLease as jest.MockedFunction<typeof withGpuLease>).mockImplementation(
      async (stage, fn) => fn()
    );

    // Get dispatcher instance
    dispatcher = new OriginalJobResultDispatcher();
  });

  /**
   * 测试场景1：验证 originalJobInfo 传递和 utteranceIndex 正确使用
   * 
   * 场景：
   * - Job 625 (utteranceIndex: 2) 合并了 Job 623 (utteranceIndex: 0) 和 Job 624 (utteranceIndex: 1) 的音频
   * - 验证创建的 originalJob 使用正确的 utteranceIndex
   */
  it('应该使用原始job的utteranceIndex创建originalJob', async () => {
    // 设置 dispatcher 的回调，模拟 ASR 结果处理
    let capturedCallbacks: Array<{
      originalJobId: string;
      callback: (asrData: any, originalJobMsg: JobAssignMessage) => Promise<void>;
    }> = [];

    (mockDispatcher.registerOriginalJob as jest.Mock).mockImplementation(
      (sessionId, originalJobId, expectedSegmentCount, originalJob, callback) => {
        capturedCallbacks.push({ originalJobId, callback });
        // 立即触发回调（模拟 finalize 场景）
        if (expectedSegmentCount === 0) {
          setTimeout(async () => {
            await callback(
              {
                originalJobId,
                asrText: 'test asr text',
                asrSegments: [],
                languageProbabilities: {},
              },
              originalJob
            );
          }, 0);
        }
      }
    );
    // 准备测试数据
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2, // 当前job的utteranceIndex
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0, // 原始job的utteranceIndex
      },
      {
        jobId: 'job-624',
        startOffset: 100,
        endOffset: 200,
        utteranceIndex: 1, // 原始job的utteranceIndex
      },
    ];

    // Mock audioProcessor.processAudio 返回 originalJobInfo
    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    // 记录传递给 runJobPipeline 的 originalJob
    const capturedOriginalJobs: JobAssignMessage[] = [];
    (runJobPipeline as jest.MockedFunction<typeof runJobPipeline>).mockImplementation(
      async (params: any) => {
        if (params.job) {
          capturedOriginalJobs.push(params.job);
        }
        return {
          text_asr: 'test asr text',
          text_translated: 'test translated text',
          tts_audio: Buffer.from('test audio'),
          tts_format: 'opus',
          should_send: true,
          extra: {},
        };
      }
    );

    // 执行测试
    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：应该为每个原始job调用 runJobPipeline
    expect(runJobPipeline).toHaveBeenCalledTimes(2);

    // 验证：Job 623 使用 utteranceIndex: 0
    const job623 = capturedOriginalJobs.find(job => job.job_id === 'job-623');
    expect(job623).toBeDefined();
    expect(job623?.utterance_index).toBe(0); // ✅ 使用原始job的utteranceIndex

    // 验证：Job 624 使用 utteranceIndex: 1
    const job624 = capturedOriginalJobs.find(job => job.job_id === 'job-624');
    expect(job624).toBeDefined();
    expect(job624?.utterance_index).toBe(1); // ✅ 使用原始job的utteranceIndex

    // 验证：不应该使用当前job的utteranceIndex (2)
    expect(job623?.utterance_index).not.toBe(2);
    expect(job624?.utterance_index).not.toBe(2);
  });

  /**
   * 测试场景2：验证当 originalJobInfo 中找不到对应job时，使用当前job的utteranceIndex作为后备
   */
  it('当originalJobInfo中找不到对应job时，应该使用当前job的utteranceIndex作为后备', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    // originalJobInfo 中只有 job-623，没有 job-624
    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'], // job-624 不在 originalJobInfo 中
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    const capturedOriginalJobs: JobAssignMessage[] = [];
    (runJobPipeline as jest.MockedFunction<typeof runJobPipeline>).mockImplementation(
      async (params: any) => {
        if (params.job) {
          capturedOriginalJobs.push(params.job);
        }
        return {
          text_asr: 'test asr text',
          text_translated: 'test translated text',
          tts_audio: Buffer.from('test audio'),
          tts_format: 'opus',
          should_send: true,
          extra: {},
        };
      }
    );

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：Job 623 使用 originalJobInfo 中的 utteranceIndex: 0
    const job623 = capturedOriginalJobs.find(job => job.job_id === 'job-623');
    expect(job623?.utterance_index).toBe(0);

    // 验证：Job 624 使用当前job的utteranceIndex: 2 作为后备
    const job624 = capturedOriginalJobs.find(job => job.job_id === 'job-624');
    expect(job624?.utterance_index).toBe(2); // 后备值
  });

  /**
   * 测试场景3：验证 originalJobInfo 为空数组时的处理
   */
  it('当originalJobInfo为空数组时，应该使用当前job的utteranceIndex', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623'],
      originalJobInfo: [], // 空数组
    });

    const ctx = initJobContext(currentJob);

    const capturedOriginalJobs: JobAssignMessage[] = [];
    (runJobPipeline as jest.MockedFunction<typeof runJobPipeline>).mockImplementation(
      async (params: any) => {
        if (params.job) {
          capturedOriginalJobs.push(params.job);
        }
        return {
          text_asr: 'test asr text',
          text_translated: 'test translated text',
          tts_audio: Buffer.from('test audio'),
          tts_format: 'opus',
          should_send: true,
          extra: {},
        };
      }
    );

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：使用当前job的utteranceIndex作为后备
    const job623 = capturedOriginalJobs.find(job => job.job_id === 'job-623');
    expect(job623?.utterance_index).toBe(2); // 后备值
  });

  /**
   * 测试场景4：验证 ResultSender 接收到正确的 utteranceIndex
   */
  it('应该将正确的utteranceIndex传递给ResultSender', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
      {
        jobId: 'job-624',
        startOffset: 100,
        endOffset: 200,
        utteranceIndex: 1,
      },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：ResultSender 被调用了2次（每个原始job一次）
    expect(mockResultSender.sendJobResult).toHaveBeenCalledTimes(2);

    // 验证：Job 623 的结果使用 utterance_index: 0
    const job623Call = (mockResultSender.sendJobResult as jest.Mock).mock.calls.find(
      call => call[0].job_id === 'job-623'
    );
    expect(job623Call).toBeDefined();
    expect(job623Call[0].utterance_index).toBe(0); // ✅ 使用原始job的utteranceIndex

    // 验证：Job 624 的结果使用 utterance_index: 1
    const job624Call = (mockResultSender.sendJobResult as jest.Mock).mock.calls.find(
      call => call[0].job_id === 'job-624'
    );
    expect(job624Call).toBeDefined();
    expect(job624Call[0].utterance_index).toBe(1); // ✅ 使用原始job的utteranceIndex
  });

  /**
   * 测试场景5：验证没有 originalJobIds 时，不创建 originalJob
   */
  it('当没有originalJobIds时，不应该创建originalJob', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: [], // 没有原始job
      originalJobInfo: [],
    });

    const ctx = initJobContext(currentJob);

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：不应该调用 runJobPipeline（因为没有原始job）
    expect(runJobPipeline).not.toHaveBeenCalled();
  });

  /**
   * 测试场景6：验证 originalJobInfo 传递链路完整性
   * 从 AudioProcessor -> asr-step -> originalJob 创建
   */
  it('应该正确传递originalJobInfo从AudioProcessor到originalJob创建', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
    ];

    // 验证 AudioProcessor 返回了 originalJobInfo
    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623'],
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    const capturedOriginalJobs: JobAssignMessage[] = [];
    (runJobPipeline as jest.MockedFunction<typeof runJobPipeline>).mockImplementation(
      async (params: any) => {
        if (params.job) {
          capturedOriginalJobs.push(params.job);
        }
        return {
          text_asr: 'test asr text',
          text_translated: 'test translated text',
          tts_audio: Buffer.from('test audio'),
          tts_format: 'opus',
          should_send: true,
          extra: {},
        };
      }
    );

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：originalJobInfo 被正确使用
    const job623 = capturedOriginalJobs.find(job => job.job_id === 'job-623');
    expect(job623).toBeDefined();
    expect(job623?.utterance_index).toBe(0); // ✅ 从 originalJobInfo 中获取

    // 验证：日志记录了使用原始job的utteranceIndex
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'job-623',
        originalUtteranceIndex: 0,
        currentJobUtteranceIndex: 2,
        note: 'Using original job utterance_index (LONG_UTTERANCE_JOB_CONTAINER_POLICY)',
      }),
      expect.stringContaining('Created original job with original utterance_index')
    );
  });

  /**
   * 测试场景7：验证空容器检测和空结果核销
   * 
   * 场景：
   * - 有3个原始job：job-623, job-624, job-625
   * - 但只有job-623和job-624被分配到batch
   * - job-625是空容器，应该立即发送空结果核销
   */
  it('应该检测空容器并发送空结果核销', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-626',
      session_id: 'session-1',
      utterance_index: 3,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
      {
        jobId: 'job-624',
        startOffset: 100,
        endOffset: 200,
        utteranceIndex: 1,
      },
      {
        jobId: 'job-625', // 空容器：没有被分配到batch
        startOffset: 200,
        endOffset: 250,
        utteranceIndex: 2,
      },
    ];

    // 只有job-623和job-624被分配到batch，job-625是空的
    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'], // job-625没有被分配
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    // Mock dispatcher.registerOriginalJob
    const mockDispatcher = {
      registerOriginalJob: jest.fn(),
    };
    (OriginalJobResultDispatcher as any).mockImplementation(() => mockDispatcher);

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：应该为job-625（空容器）发送空结果核销
    // 注意：由于我们mock了ASR处理，实际的registerOriginalJob可能不会被调用
    // 但空容器检测应该在注册之后执行
    expect(mockResultSender.sendJobResult).toHaveBeenCalledTimes(1);
    
    const emptyResultCall = (mockResultSender.sendJobResult as jest.Mock).mock.calls[0];
    expect(emptyResultCall).toBeDefined();
    
    // 验证空job消息
    const emptyJob = emptyResultCall[0];
    expect(emptyJob.job_id).toBe('job-625');
    expect(emptyJob.utterance_index).toBe(2); // 使用原始job的utteranceIndex
    
    // 验证空结果
    const emptyResult = emptyResultCall[1];
    expect(emptyResult.text_asr).toBe('');
    expect(emptyResult.text_translated).toBe('');
    expect(emptyResult.tts_audio).toBe('');
    expect(emptyResult.should_send).toBe(true);
    expect(emptyResult.extra?.reason).toBe('NO_TEXT_ASSIGNED');
    
    // 验证reason参数
    expect(emptyResultCall[4]).toBe('NO_TEXT_ASSIGNED');
  });

  /**
   * 测试场景8：验证多个空容器的处理
   * 
   * 场景：
   * - 有5个原始job：job-623, job-624, job-625, job-626, job-627
   * - 只有job-623和job-624被分配到batch
   * - job-625, job-626, job-627都是空容器，应该都发送空结果核销
   */
  it('应该检测多个空容器并发送空结果核销', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-628',
      session_id: 'session-1',
      utterance_index: 5,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
      {
        jobId: 'job-624',
        startOffset: 100,
        endOffset: 200,
        utteranceIndex: 1,
      },
      {
        jobId: 'job-625', // 空容器1
        startOffset: 200,
        endOffset: 250,
        utteranceIndex: 2,
      },
      {
        jobId: 'job-626', // 空容器2
        startOffset: 250,
        endOffset: 300,
        utteranceIndex: 3,
      },
      {
        jobId: 'job-627', // 空容器3
        startOffset: 300,
        endOffset: 350,
        utteranceIndex: 4,
      },
    ];

    // 只有job-623和job-624被分配到batch
    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    // Mock ASR processing to return empty results (no actual ASR call)
    (mockAsrHandler as any).processAsr = jest.fn().mockResolvedValue({
      text: '',
      segments: [],
      language_probabilities: {},
    });

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：应该为job-623和job-624注册OriginalJob
    expect(mockRegisterOriginalJob).toHaveBeenCalledTimes(2);

    // 验证：应该为3个空容器都发送空结果核销
    expect(mockResultSender.sendJobResult).toHaveBeenCalledTimes(3);
    
    const emptyResultCalls = (mockResultSender.sendJobResult as jest.Mock).mock.calls;
    
    // 验证每个空容器都发送了空结果
    const emptyJobIds = emptyResultCalls.map(call => call[0].job_id).sort();
    expect(emptyJobIds).toEqual(['job-625', 'job-626', 'job-627']);
    
    // 验证每个空结果都包含正确的utteranceIndex和reason
    emptyResultCalls.forEach((call, index) => {
      const emptyJob = call[0];
      const emptyResult = call[1];
      
      expect(emptyJob.utterance_index).toBe(2 + index); // 2, 3, 4
      expect(emptyResult.text_asr).toBe('');
      expect(emptyResult.extra?.reason).toBe('NO_TEXT_ASSIGNED');
      expect(call[4]).toBe('NO_TEXT_ASSIGNED');
    });
  });

  /**
   * 测试场景9：验证没有空容器时不发送空结果
   * 
   * 场景：
   * - 有3个原始job：job-623, job-624, job-625
   * - 所有job都被分配到batch
   * - 不应该发送任何空结果
   */
  it('当没有空容器时，不应该发送空结果', async () => {
    const currentJob: JobAssignMessage = {
      job_id: 'job-626',
      session_id: 'session-1',
      utterance_index: 3,
      audio: Buffer.from('test audio'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      {
        jobId: 'job-623',
        startOffset: 0,
        endOffset: 100,
        utteranceIndex: 0,
      },
      {
        jobId: 'job-624',
        startOffset: 100,
        endOffset: 200,
        utteranceIndex: 1,
      },
      {
        jobId: 'job-625',
        startOffset: 200,
        endOffset: 300,
        utteranceIndex: 2,
      },
    ];

    // 所有job都被分配到batch
    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio', 'base64audio2', 'base64audio3'],
      originalJobIds: ['job-623', 'job-624', 'job-625'], // 所有job都有batch
      originalJobInfo: originalJobInfo,
    });

    const ctx = initJobContext(currentJob);

    // Mock ASR processing to return empty results (no actual ASR call)
    (mockAsrHandler as any).processAsr = jest.fn().mockResolvedValue({
      text: '',
      segments: [],
      language_probabilities: {},
    });

    await runAsrStep(currentJob, ctx, mockServices);

    // 验证：不应该发送任何空结果（因为没有空容器）
    // 注意：由于所有job都有batch，空容器检测不会触发
    // 但如果有正常的job处理，可能会调用sendJobResult（通过runJobPipeline）
    // 这里我们主要验证空容器检测逻辑不会误触发
    const emptyResultCalls = (mockResultSender.sendJobResult as jest.Mock).mock.calls.filter(
      call => call[1]?.extra?.reason === 'NO_TEXT_ASSIGNED'
    );
    expect(emptyResultCalls.length).toBe(0);
  });
});
