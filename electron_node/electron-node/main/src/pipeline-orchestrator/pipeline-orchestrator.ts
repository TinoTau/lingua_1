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

export class PipelineOrchestrator {
  private sessionContextManager: SessionContextManager;
  private aggregatorManager: AggregatorManager | null = null;
  private aggregatorMiddleware: AggregatorMiddleware | null = null;
  private audioAggregator: AudioAggregator;
  private asrHandler: PipelineOrchestratorASRHandler;

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
      
      // 音频聚合：在ASR之前根据 is_manual_cut 和 is_pause_triggered 标识聚合音频
      // 这样可以避免ASR识别不完整的短句，提高识别准确率
      const aggregatedAudio = await this.audioAggregator.processAudioChunk(job);
      
      // 如果返回null，说明音频被缓冲，等待更多音频块或触发标识
      // 此时应该返回空结果，不进行ASR处理
      if (aggregatedAudio === null) {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            bufferStatus: this.audioAggregator.getBufferStatus(job.session_id),
          },
          'PipelineOrchestrator: Audio chunk buffered, waiting for more chunks or trigger. Returning empty result.'
        );
        // 返回空结果，等待更多音频块或触发标识
        return {
          text_asr: '',
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
            language_probability: undefined,
            language_probabilities: undefined,
          },
        };
      }
      
      // 音频已聚合，继续处理
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          aggregatedAudioLength: aggregatedAudio.length,
        },
        'PipelineOrchestrator: Audio aggregated, proceeding to ASR'
      );
      
      // Opus 解码：强制要求输入格式必须是 Opus，在 Pipeline 中解码为 PCM16
      // 注意：三端之间只使用 Opus 格式传输，不再支持其他格式
      const audioFormat = job.audio_format || 'opus';
      
      if (audioFormat !== 'opus') {
        const errorMessage = `Audio format must be 'opus', but received '${audioFormat}'. Three-end communication only uses Opus format.`;
        logger.error(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            receivedFormat: audioFormat,
          },
          errorMessage
        );
        throw new Error(errorMessage);
      }
      
      let audioForASR: string;
      let audioFormatForASR = 'pcm16';
      
      try {
        // 验证聚合后的音频长度是否为2的倍数（PCM16要求）
        let finalAudio = aggregatedAudio;
        if (aggregatedAudio.length % 2 !== 0) {
          logger.error(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              aggregatedAudioLength: aggregatedAudio.length,
              isOdd: aggregatedAudio.length % 2 !== 0,
            },
            '🚨 CRITICAL: Aggregated audio length is not a multiple of 2 before sending to ASR! This will cause 400 error.'
          );
          // 修复：截断最后一个字节
          const fixedLength = aggregatedAudio.length - (aggregatedAudio.length % 2);
          finalAudio = aggregatedAudio.slice(0, fixedLength);
          logger.warn(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              originalLength: aggregatedAudio.length,
              fixedLength: finalAudio.length,
              bytesRemoved: aggregatedAudio.length - finalAudio.length,
            },
            'Fixed aggregated audio length by truncating last byte(s) before sending to ASR'
          );
        }
        
        // 使用聚合后的音频（已经是PCM16格式）
        // 将 PCM16 Buffer 转换为 base64 字符串
        audioForASR = finalAudio.toString('base64');
        audioFormatForASR = 'pcm16';
        
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedAudioLength: finalAudio.length,
            originalLength: aggregatedAudio.length,
            wasFixed: finalAudio.length !== aggregatedAudio.length,
            sampleRate: job.sample_rate || 16000,
            isLengthValid: finalAudio.length % 2 === 0,
          },
          'PipelineOrchestrator: Aggregated audio ready for ASR (PCM16 format)'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          {
            error,
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            errorMessage,
          },
          'PipelineOrchestrator: Failed to process aggregated audio'
        );
        throw new Error(`Failed to process aggregated audio: ${errorMessage}`);
      }
      
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
        asrResult = await this.taskRouter.routeASRTask(asrTask);
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

      // 检查 ASR 结果是否为空或无意义（防止空文本进入 NMT/TTS）
      // 重要：ASR 服务已经过滤了空文本，但节点端也应该检查以确保安全
      const asrTextTrimmed = (asrResult.text || '').trim();
      if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrResult.text,
          },
          'PipelineOrchestrator: ASR result is empty, returning empty result to scheduler (no NMT/TTS)'
        );
        // 返回空结果，不进行翻译和 TTS
        return {
          text_asr: '',
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
            language_probability: asrResult.language_probability,
            language_probabilities: asrResult.language_probabilities,
          },
        };
      }

      // 检查是否为无意义文本（如 "The", "A", "An" 等）
      // 这些通常是 NMT 对空文本的默认翻译
      const meaninglessWords = ['the', 'a', 'an', 'this', 'that', 'it'];
      if (meaninglessWords.includes(asrTextTrimmed.toLowerCase())) {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrResult.text,
          },
          'PipelineOrchestrator: ASR result is meaningless word, returning empty result to scheduler (no NMT/TTS)'
        );
        return {
          text_asr: asrResult.text,
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
            language_probability: asrResult.language_probability,
            language_probabilities: asrResult.language_probabilities,
          },
        };
      }

      // 1.5. AggregatorMiddleware: 在 ASR 之后、NMT 之前进行文本聚合
      let textForNMT = asrTextTrimmed;
      let shouldProcessNMT = true;
      if (this.aggregatorMiddleware) {
        const aggregationResult = this.aggregatorMiddleware.processASRResult(job, {
          text: asrTextTrimmed,
          segments: asrResult.segments,
          language_probability: asrResult.language_probability,
          language_probabilities: asrResult.language_probabilities,
          badSegmentDetection: asrResult.badSegmentDetection,
        });
        
        if (aggregationResult.shouldProcess) {
          textForNMT = aggregationResult.aggregatedText;
          shouldProcessNMT = true;
          
          // 记录合并后的结果
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              originalASRText: asrTextTrimmed,
              originalASRTextLength: asrTextTrimmed.length,
              aggregatedText: textForNMT,
              aggregatedTextLength: textForNMT.length,
              action: aggregationResult.action,
              dedupCharsRemoved: aggregationResult.metrics?.dedupCharsRemoved || 0,
              textChanged: textForNMT !== asrTextTrimmed,
            },
            'PipelineOrchestrator: Text aggregated after ASR, ready for NMT'
          );
        } else {
          // Aggregator 决定不处理（可能是重复文本）
          shouldProcessNMT = false;
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              originalASRText: asrTextTrimmed,
              originalASRTextLength: asrTextTrimmed.length,
              aggregatedText: aggregationResult.aggregatedText,
              reason: 'Aggregator filtered duplicate text',
              action: aggregationResult.action,
            },
            'PipelineOrchestrator: Aggregator filtered text, returning empty result to scheduler (no NMT/TTS)'
          );
        }
      } else {
        // 没有 AggregatorMiddleware，使用原始 ASR 文本
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrTextTrimmed,
            note: 'No AggregatorMiddleware, using original ASR text for NMT',
          },
          'PipelineOrchestrator: Using original ASR text for NMT'
        );
      }

      // 2. 返回聚合后的文本，由 PostProcess 处理 NMT/TTS
      if (!shouldProcessNMT) {
        // Aggregator 决定不处理，返回空结果
        // 修复：确保textForNMT为空，避免PostProcess处理
        textForNMT = '';
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrTextTrimmed,
            aggregatedText: textForNMT,
            reason: 'Aggregator filtered duplicate text, returning empty result to scheduler (no NMT/TTS)',
          },
          'PipelineOrchestrator: Aggregator filtered duplicate text, returning empty result (no NMT/TTS)'
        );
      } else {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrTextTrimmed,
            aggregatedText: textForNMT,
          },
          'PipelineOrchestrator: Passing aggregated text to PostProcess for NMT/TTS'
        );
      }
      
      // 返回聚合后的文本（如果 AggregatorMiddleware 处理过），由 PostProcess 处理
      // 3. 返回结果
      // OBS-2: 计算 ASR 质量级别
      let asrQualityLevel: 'good' | 'suspect' | 'bad' | undefined;
      if (asrResult.badSegmentDetection) {
        const qualityScore = asrResult.badSegmentDetection.qualityScore;
        if (qualityScore >= 0.7) {
          asrQualityLevel = 'good';
        } else if (qualityScore >= 0.4) {
          asrQualityLevel = 'suspect';
        } else {
          asrQualityLevel = 'bad';
        }
      }

      // OBS-2: 计算 segments_meta
      let segmentsMeta: { count: number; max_gap: number; avg_duration: number } | undefined;
      if (asrResult.segments && asrResult.segments.length > 0) {
        const segments = asrResult.segments;
        let maxGap = 0;
        let totalDuration = 0;
        
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          if (segment.end && segment.start) {
            const duration = segment.end - segment.start;
            totalDuration += duration;
            
            // 计算与前一个 segment 的间隔
            if (i > 0 && segments[i - 1].end !== undefined) {
              const prevEnd = segments[i - 1].end!;
              const gap = segment.start - prevEnd;
              if (gap > maxGap) {
                maxGap = gap;
              }
            }
          }
        }
        
        segmentsMeta = {
          count: segments.length,
          max_gap: maxGap,
          avg_duration: segments.length > 0 ? totalDuration / segments.length : 0,
        };
      }

      const result: JobResult = {
        text_asr: textForNMT,  // 使用聚合后的文本（如果 AggregatorMiddleware 处理过）
        text_translated: '',  // 空翻译，由 PostProcess 填充
        tts_audio: '',  // TTS 也由 PostProcess 处理
        tts_format: 'pcm16',
        extra: {
          emotion: undefined,
          speech_rate: undefined,
          voice_style: undefined,
          language_probability: asrResult.language_probability,  // 新增：检测到的语言的概率
          language_probabilities: asrResult.language_probabilities,  // 新增：所有语言的概率信息
        },
        // OBS-2: ASR 质量信息
        asr_quality_level: asrQualityLevel,
        reason_codes: asrResult.badSegmentDetection?.reasonCodes,
        quality_score: asrResult.badSegmentDetection?.qualityScore,
        rerun_count: asrTask.rerun_count,
        segments_meta: segmentsMeta,
        // 传递 segments 信息给中间件使用
        segments: asrResult.segments as any,
      };

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

