/**
 * runAsrStep - ASR 步骤
 * 处理音频聚合、ASR识别、Gate-A上下文重置
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { PartialResultCallback } from '../../inference/inference-service';
import { ASRTask, ASRResult } from '../../task-router/types';
import { SessionContextResetRequest } from '../../pipeline-orchestrator/session-context-manager';
import { AudioAggregator } from '../../pipeline-orchestrator/audio-aggregator';
import { PipelineOrchestratorAudioProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorASRHandler } from '../../pipeline-orchestrator/pipeline-orchestrator-asr';
import { withGpuLease } from '../../gpu-arbiter';
import logger from '../../logger';

export interface AsrStepOptions {
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
}

export async function runAsrStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle,
  options?: AsrStepOptions
): Promise<void> {
  // 初始化音频聚合器和处理器
  const audioAggregator = new AudioAggregator();
  const audioProcessor = new PipelineOrchestratorAudioProcessor(audioAggregator);
  const asrResultProcessor = new PipelineOrchestratorASRResultProcessor();
  const asrHandler = new PipelineOrchestratorASRHandler(
    services.taskRouter,
    services.aggregatorManager
  );

  // 构建 prompt（如果启用）
  const contextText = asrHandler.buildPrompt(job) || (job as any).context_text;

  // 处理音频：聚合和格式转换
  const audioProcessResult = await audioProcessor.processAudio(job);
  if (audioProcessResult?.shouldReturnEmpty) {
    logger.info(
      { jobId: job.job_id, sessionId: job.session_id },
      'runAsrStep: Audio buffered, returning empty'
    );
    return;
  }

  if (!audioProcessResult) {
    throw new Error('Failed to process audio');
  }

  const audioForASR = audioProcessResult.audioForASR;
  const audioFormatForASR = audioProcessResult.audioFormatForASR;

  // 构建 ASR 任务
  const asrTask: ASRTask = {
    audio: audioForASR,
    audio_format: audioFormatForASR,
    sample_rate: job.sample_rate || 16000,
    src_lang: job.src_lang,
    enable_streaming: job.enable_streaming_asr || false,
    context_text: contextText,
    job_id: job.job_id,
    utterance_index: job.utterance_index,
    padding_ms: job.padding_ms,
    rerun_count: (job as any).rerun_count || 0,
  } as any;
  (asrTask as any).session_id = job.session_id;

  // 调用 ASR 服务
  let asrResult: ASRResult;
  if (job.enable_streaming_asr && options?.partialCallback) {
    // 流式 ASR
    asrResult = await asrHandler.processASRStreaming(asrTask, options.partialCallback);
  } else {
    // 非流式 ASR（使用 GPU 租约）
    asrResult = await withGpuLease(
      'ASR',
      async () => {
        return await services.taskRouter.routeASRTask(asrTask);
      },
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        stage: 'ASR',
      }
    );
  }

  // 更新 JobContext
  ctx.asrText = asrResult.text;
  ctx.asrResult = asrResult;
  ctx.asrSegments = asrResult.segments;
  ctx.languageProbabilities = asrResult.language_probabilities;
  ctx.qualityScore = asrResult.badSegmentDetection?.qualityScore;
  ctx.rerunCount = (job as any).rerun_count || 0;

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      asrTextLength: ctx.asrText?.length || 0,
      qualityScore: ctx.qualityScore,
    },
    'runAsrStep: ASR completed'
  );

  // Gate-A: 检查是否需要重置上下文
  if ((asrResult as any).shouldResetContext && services.sessionContextManager) {
    const sessionId = job.session_id || job.job_id || 'unknown';
    const resetRequest: SessionContextResetRequest = {
      sessionId,
      reason: 'consecutive_low_quality',
      jobId: job.job_id,
    };

    logger.info(
      {
        sessionId,
        jobId: job.job_id,
        qualityScore: asrResult.badSegmentDetection?.qualityScore,
      },
      'Gate-A: Detected shouldResetContext flag, triggering context reset'
    );

    // 异步重置上下文（不阻塞主流程）
    services.sessionContextManager
      .resetContext(resetRequest, services.taskRouter)
      .then((resetResult: any) => {
        logger.info(
          { sessionId, jobId: job.job_id, resetResult },
          'Gate-A: Context reset completed'
        );
      })
      .catch((error: any) => {
        logger.error(
          { sessionId, jobId: job.job_id, error: error.message },
          'Gate-A: Context reset failed'
        );
      });
  }

  // 处理 ASR 结果：空文本检查、无意义文本检查
  const asrResultProcessResult = asrResultProcessor.processASRResult(job, asrResult);
  if (asrResultProcessResult.shouldReturnEmpty) {
    logger.info(
      { jobId: job.job_id },
      'runAsrStep: ASR result is empty or meaningless, skipping further processing'
    );
    // 保持 ctx.asrText 为空，后续步骤会跳过
  }

  // ASR 完成回调
  options?.asrCompletedCallback?.(true);
}
