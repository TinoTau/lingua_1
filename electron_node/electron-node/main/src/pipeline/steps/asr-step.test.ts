/**
 * ASR Step 单元测试
 * 单容器架构：所有 segment 结果写入当前 job 的 ctx，不调用 sendJobResult；
 * 空容器记入 ctx.pendingEmptyJobs，由 node-agent 统一发送。
 */

import { runAsrStep } from './asr-step';
import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { OriginalJobInfo } from '../../pipeline-orchestrator/audio-aggregator-types';

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
  withGpuLease: jest.fn(async (_stage: string, fn: () => Promise<any>) => fn()),
}));

jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-audio-processor');
jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor');
jest.mock('../../pipeline-orchestrator/pipeline-orchestrator-asr');

import { PipelineOrchestratorAudioProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorASRHandler } from '../../pipeline-orchestrator/pipeline-orchestrator-asr';

describe('ASR Step - 单容器架构', () => {
  let mockServices: ServicesBundle;
  let mockAudioProcessor: jest.Mocked<PipelineOrchestratorAudioProcessor>;
  let mockAsrResultProcessor: { processASRResult: jest.Mock };
  let mockResultSender: { sendJobResult: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAudioProcessor = {
      processAudio: jest.fn(),
    } as any;

    mockAsrResultProcessor = {
      processASRResult: jest.fn().mockReturnValue({ shouldReturnEmpty: false }),
    };

    mockResultSender = { sendJobResult: jest.fn() };

    const mockTaskRouter = {
      routeASRTask: jest.fn().mockResolvedValue({
        text: 'segment asr text',
        segments: [],
        language_probabilities: {},
      }),
    };

    mockServices = {
      audioAggregator: {} as any,
      taskRouter: mockTaskRouter as any,
      aggregatorManager: {} as any,
      resultSender: mockResultSender,
    } as ServicesBundle;

    (PipelineOrchestratorAudioProcessor as any).mockImplementation(() => mockAudioProcessor);
    (PipelineOrchestratorASRHandler as any).mockImplementation(() => ({
      buildPrompt: jest.fn(() => null),
      processASRStreaming: jest.fn(),
    }));
    (PipelineOrchestratorASRResultProcessor as any).mockImplementation(() => mockAsrResultProcessor);
  });

  it('无 originalJobIds 时：ASR 结果写入 ctx，asr-step 不调用 sendJobResult', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-1',
      session_id: 'session-1',
      utterance_index: 0,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: [],
      originalJobInfo: [],
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect(ctx.asrText).toBe('segment asr text');
    expect(ctx.asrSegments).toEqual([]);
    expect((ctx as any).pendingEmptyJobs).toBeUndefined();
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('多 segment 时：按序合并进 ctx.asrText', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-1',
      session_id: 'session-1',
      utterance_index: 0,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['seg1', 'seg2'],
      originalJobIds: [],
      originalJobInfo: [],
    });

    let callCount = 0;
    (mockServices.taskRouter as any).routeASRTask.mockImplementation(() =>
      Promise.resolve({
        text: callCount++ === 0 ? 'first' : 'second',
        segments: [],
        language_probabilities: {},
      })
    );

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect(ctx.asrText).toBe('first second');
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('有 originalJobIds 时：仍只写 ctx，不调用 runJobPipeline 或 sendJobResult', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-625',
      session_id: 'session-1',
      utterance_index: 2,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      { jobId: 'job-623', startOffset: 0, endOffset: 100, utteranceIndex: 0 },
      { jobId: 'job-624', startOffset: 100, endOffset: 200, utteranceIndex: 1 },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo,
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect(ctx.asrText).toBe('segment asr text');
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('空容器：ctx.pendingEmptyJobs 被设置，asr-step 不发送', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-626',
      session_id: 'session-1',
      utterance_index: 3,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      { jobId: 'job-623', startOffset: 0, endOffset: 100, utteranceIndex: 0 },
      { jobId: 'job-624', startOffset: 100, endOffset: 200, utteranceIndex: 1 },
      { jobId: 'job-625', startOffset: 200, endOffset: 250, utteranceIndex: 2 },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo,
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect((ctx as any).pendingEmptyJobs).toEqual([
      { job_id: 'job-625', utterance_index: 2 },
    ]);
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('多个空容器：ctx.pendingEmptyJobs 包含所有空 job', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-628',
      session_id: 'session-1',
      utterance_index: 5,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      { jobId: 'job-623', startOffset: 0, endOffset: 100, utteranceIndex: 0 },
      { jobId: 'job-624', startOffset: 100, endOffset: 200, utteranceIndex: 1 },
      { jobId: 'job-625', startOffset: 200, endOffset: 250, utteranceIndex: 2 },
      { jobId: 'job-626', startOffset: 250, endOffset: 300, utteranceIndex: 3 },
      { jobId: 'job-627', startOffset: 300, endOffset: 350, utteranceIndex: 4 },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio'],
      originalJobIds: ['job-623', 'job-624'],
      originalJobInfo,
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    const pending = (ctx as any).pendingEmptyJobs as { job_id: string; utterance_index: number }[];
    expect(pending).toHaveLength(3);
    expect(pending.map(p => p.job_id).sort()).toEqual(['job-625', 'job-626', 'job-627']);
    expect(pending.map(p => p.utterance_index)).toEqual([2, 3, 4]);
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('无空容器时：ctx.pendingEmptyJobs 不设置', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-626',
      session_id: 'session-1',
      utterance_index: 3,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    const originalJobInfo: OriginalJobInfo[] = [
      { jobId: 'job-623', startOffset: 0, endOffset: 100, utteranceIndex: 0 },
      { jobId: 'job-624', startOffset: 100, endOffset: 200, utteranceIndex: 1 },
      { jobId: 'job-625', startOffset: 200, endOffset: 300, utteranceIndex: 2 },
    ];

    mockAudioProcessor.processAudio.mockResolvedValue({
      audioForASR: 'base64audio',
      audioFormatForASR: 'pcm16',
      shouldReturnEmpty: false,
      audioSegments: ['base64audio', 'base64audio2', 'base64audio3'],
      originalJobIds: ['job-623', 'job-624', 'job-625'],
      originalJobInfo,
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect((ctx as any).pendingEmptyJobs).toBeUndefined();
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });

  it('音频被缓冲时：设置 ctx.audioBuffered 并 return', async () => {
    const job: JobAssignMessage = {
      job_id: 'job-1',
      session_id: 'session-1',
      utterance_index: 0,
      audio: Buffer.from('test'),
      audio_format: 'opus',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;

    mockAudioProcessor.processAudio.mockResolvedValue({
      shouldReturnEmpty: true,
    });

    const ctx = initJobContext(job);
    await runAsrStep(job, ctx, mockServices);

    expect((ctx as any).audioBuffered).toBe(true);
    expect(ctx.asrText).toBeUndefined();
    expect(mockResultSender.sendJobResult).not.toHaveBeenCalled();
  });
});
