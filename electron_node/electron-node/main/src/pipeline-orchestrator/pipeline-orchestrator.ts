// 流水线编排器 - 协调多个服务完成完整流程

import logger from '../logger';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../task-router/task-router';
import {
  ASRTask,
  ASRResult,
} from '../task-router/types';
import { JobResult, PartialResultCallback } from '../inference/inference-service';
import { SessionContextManager, SessionContextResetRequest } from './session-context-manager';
import { AggregatorManager } from '../aggregator/aggregator-manager';
import { PromptBuilder, PromptBuilderContext } from '../asr/prompt-builder';
import { Mode } from '../aggregator/aggregator-decision';
import { loadNodeConfig } from '../node-config';
import { AggregatorMiddleware } from '../agent/aggregator-middleware';
import { decodeOpusToPcm16 } from '../utils/opus-codec';
import { AudioAggregator } from './audio-aggregator';
import { PipelineOrchestratorASRHandler } from './pipeline-orchestrator-asr';
import { withGpuLease } from '../gpu-arbiter';
import { PipelineOrchestratorAudioProcessor } from './pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from './pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorResultBuilder } from './pipeline-orchestrator-result-builder';

export class PipelineOrchestrator {
  private sessionContextManager: SessionContextManager;
  private aggregatorManager: AggregatorManager | null = null;
  private aggregatorMiddleware: AggregatorMiddleware | null = null;
  private audioAggregator: AudioAggregator;
  private asrHandler: PipelineOrchestratorASRHandler;
  private audioProcessor: PipelineOrchestratorAudioProcessor;
  private asrResultProcessor: PipelineOrchestratorASRResultProcessor;
  private resultBuilder: PipelineOrchestratorResultBuilder;

  constructor(
    private taskRouter: TaskRouter,
    aggregatorManager?: AggregatorManager,
    mode: Mode = 'offline',
    aggregatorMiddleware?: AggregatorMiddleware
  ) {
    // Gate-A: 初始化 Session Context Manager
    this.sessionContextManager = new SessionContextManager();
    this.sessionContextManager.setTaskRouter(taskRouter);
    
    // S1: 初始化 AggregatorManager（用于ASR handler）
    this.aggregatorManager = aggregatorManager || null;
    
    // 初始化 ASR Handler
    this.asrHandler = new PipelineOrchestratorASRHandler(taskRouter, aggregatorManager);
    
    // 设置 AggregatorMiddleware（用于在 ASR 之后、NMT 之前进行文本聚合）
    this.aggregatorMiddleware = aggregatorMiddleware || null;
    if (this.aggregatorMiddleware) {
      logger.info({}, 'PipelineOrchestrator: AggregatorMiddleware initialized for pre-NMT aggregation');
    }
    
    // 初始化音频聚合器（用于在ASR之前聚合音频）
    this.audioAggregator = new AudioAggregator();
    logger.info({}, 'PipelineOrchestrator: AudioAggregator initialized for pre-ASR audio aggregation');
    
    // 初始化模块化处理器
    this.audioProcessor = new PipelineOrchestratorAudioProcessor(this.audioAggregator);
    this.asrResultProcessor = new PipelineOrchestratorASRResultProcessor(this.aggregatorMiddleware);
    this.resultBuilder = new PipelineOrchestratorResultBuilder();
  }

  /**
   * Gate-B: 获取 TaskRouter 实例（用于获取 Rerun 指标）
   */
  getTaskRouter(): TaskRouter {
    return this.taskRouter;
  }

  /**
   * 处理完整任务（ASR -> NMT -> TTS）
   * @param asrCompletedCallback ASR 完成时的回调，用于释放 ASR 服务容量
   */
  async processJob(
    job: JobAssignMessage,
    partialCallback?: PartialResultCallback,
    asrCompletedCallback?: (asrCompleted: boolean) => void
  ): Promise<JobResult> {
    const startTime = Date.now();

    try {
      // 1. ASR 任务
      logger.debug({ jobId: job.job_id }, 'Starting ASR task');
      
      // S1: 构建prompt（如果启用）
      const contextText = this.asrHandler.buildPrompt(job) || (job as any).context_text;
      
      // 处理音频：聚合和格式转换
      const audioProcessResult = await this.audioProcessor.processAudio(job);
      if (audioProcessResult?.shouldReturnEmpty) {
        return this.resultBuilder.buildEmptyResult();
      }
      
      if (!audioProcessResult) {
        throw new Error('Failed to process audio');
      }
      
      const audioForASR = audioProcessResult.audioForASR;
      const audioFormatForASR = audioProcessResult.audioFormatForASR;
      
      const asrTask: ASRTask = {
        audio: audioForASR,
        audio_format: audioFormatForASR,
        sample_rate: job.sample_rate || 16000,
        src_lang: job.src_lang,
        enable_streaming: job.enable_streaming_asr || false,
        context_text: contextText,  // S1: 使用构建的prompt或原始context_text
        job_id: job.job_id, // 传递 job_id 用于任务取消
        utterance_index: job.utterance_index, // 传递 utterance_index 用于日志和调试
        // EDGE-4: Padding 配置（从 job 中提取，如果调度服务器传递了该参数）
        padding_ms: job.padding_ms,
        // P0.5-SH-4: 传递重跑次数（从 job 中提取，如果调度服务器传递了该参数）
        rerun_count: (job as any).rerun_count || 0,
      } as any; // 添加session_id用于日志
      (asrTask as any).session_id = job.session_id;

      let asrResult: ASRResult;
      if (job.enable_streaming_asr && partialCallback) {
        // 流式 ASR 处理
        asrResult = await this.asrHandler.processASRStreaming(asrTask, partialCallback);
      } else {
        // GPU仲裁：获取GPU租约
        asrResult = await withGpuLease(
          'ASR',
          async () => {
            return await this.taskRouter.routeASRTask(asrTask);
          },
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            stage: 'ASR',
          }
        );
      }

      // 记录 ASR 所有生成结果
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          asrText: asrResult.text,
          asrTextLength: asrResult.text?.length || 0,
          segmentsCount: asrResult.segments?.length || 0,
          qualityScore: asrResult.badSegmentDetection?.qualityScore,
          languageProbability: asrResult.language_probability,
        },
        'PipelineOrchestrator: ASR result received'
      );
      
      // Gate-A: 检查是否需要重置上下文
      if ((asrResult as any).shouldResetContext) {
        const sessionId = (job as any).session_id || job.job_id || 'unknown';
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
        
        // 执行上下文重置（异步，不阻塞主流程）
        this.sessionContextManager.resetContext(resetRequest, this.taskRouter)
          .then((resetResult) => {
            logger.info(
              {
                sessionId,
                jobId: job.job_id,
                resetResult,
              },
              'Gate-A: Context reset completed'
            );
          })
          .catch((error) => {
            logger.error(
              {
                sessionId,
                jobId: job.job_id,
                error: error.message,
              },
              'Gate-A: Context reset failed'
            );
          });
      }
      
      // ASR 完成后，立即通知 InferenceService 从 currentJobs 中移除任务
      // 这样可以让 ASR 服务更快地处理下一个任务，避免任务堆积
      if (asrCompletedCallback) {
        asrCompletedCallback(true);
      }

      // 处理ASR结果：空文本检查、无意义文本检查、文本聚合
      const asrResultProcessResult = this.asrResultProcessor.processASRResult(job, asrResult);
      
      if (asrResultProcessResult.shouldReturnEmpty) {
        if (asrResultProcessResult.textForNMT) {
          // 无意义文本
          return this.resultBuilder.buildMeaninglessTextResult(
            asrResultProcessResult.textForNMT,
            asrResult
          );
        } else {
          // 空文本
          return this.resultBuilder.buildEmptyResult(asrResult);
        }
      }
      
      const textForNMT = asrResultProcessResult.textForNMT;
      
      // 构建结果
      const result = this.resultBuilder.buildResult(
        textForNMT,
        asrResult,
        asrTask.rerun_count
      );

      const processingTime = Date.now() - startTime;
      logger.info(
        { jobId: job.job_id, processingTime },
        'Pipeline orchestration completed'
      );

      return result;
    } catch (error) {
      logger.error({ error, jobId: job.job_id }, 'Pipeline orchestration failed');
      throw error;
    }
  }

  /**
   * 处理仅 ASR 任务
   */
  async processASROnly(job: JobAssignMessage): Promise<{ text_asr: string }> {
    return await this.asrHandler.processASROnly(job);
  }


}

