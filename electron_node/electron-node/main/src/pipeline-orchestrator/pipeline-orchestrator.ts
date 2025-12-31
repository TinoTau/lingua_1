// 流水线编排器 - 协调多个服务完成完整流程

import logger from '../logger';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../task-router/task-router';
import {
  ASRTask,
  ASRResult,
} from '../task-router/types';
import { JobResult, PartialResultCallback } from '../inference/inference-service';
// Gate-A: Session Context Manager
import { SessionContextManager, SessionContextResetRequest } from './session-context-manager';
// S1: Prompt Builder
import { AggregatorManager } from '../aggregator/aggregator-manager';
import { PromptBuilder, PromptBuilderContext } from '../asr/prompt-builder';
import { Mode } from '../aggregator/aggregator-decision';
import { loadNodeConfig } from '../node-config';
import { AggregatorMiddleware } from '../agent/aggregator-middleware';
import { decodeOpusToPcm16 } from '../utils/opus-codec';
import { AudioAggregator } from './audio-aggregator';

export class PipelineOrchestrator {
  private sessionContextManager: SessionContextManager;
  private aggregatorManager: AggregatorManager | null = null;
  private aggregatorMiddleware: AggregatorMiddleware | null = null;
  private promptBuilder: PromptBuilder | null = null;
  private enableS1PromptBias: boolean;
  private audioAggregator: AudioAggregator;

  constructor(
    private taskRouter: TaskRouter,
    aggregatorManager?: AggregatorManager,
    mode: Mode = 'offline',
    aggregatorMiddleware?: AggregatorMiddleware
  ) {
    // 读取 Feature Flag 配置
    const config = loadNodeConfig();
    this.enableS1PromptBias = config.features?.enableS1PromptBias ?? false;
    // Gate-A: 初始化 Session Context Manager
    this.sessionContextManager = new SessionContextManager();
    this.sessionContextManager.setTaskRouter(taskRouter);
    
    // S1: 初始化 AggregatorManager 和 PromptBuilder（仅在启用时）
    if (aggregatorManager && this.enableS1PromptBias) {
      this.aggregatorManager = aggregatorManager;
      this.promptBuilder = new PromptBuilder(mode);
      logger.info({ mode }, 'PipelineOrchestrator: S1 PromptBuilder initialized');
    } else if (aggregatorManager && !this.enableS1PromptBias) {
      logger.info({}, 'PipelineOrchestrator: S1 PromptBias disabled via feature flag');
    }
    
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
      let contextText = (job as any).context_text;  // 保留原有的context_text
      if (this.enableS1PromptBias && this.aggregatorManager && this.promptBuilder && job.session_id) {
        try {
          const state = this.aggregatorManager.getOrCreateState(job.session_id, 'offline');
          const recentCommittedText = (state as any).getRecentCommittedText();
          const userKeywords = (state as any).getRecentKeywords();
          
          // 获取当前质量分数（如果有）
          const lastQuality = (state as any).getLastCommitQuality();
          
          // 记录 context_text 的详细信息（用于调试 Job2 问题）
          logger.info(
            {
              jobId: job.job_id,
              utteranceIndex: job.utterance_index,
              sessionId: job.session_id,
              originalContextText: contextText ? contextText.substring(0, 100) : null,
              originalContextTextLength: contextText?.length || 0,
              recentCommittedTextCount: recentCommittedText.length,
              recentCommittedTextPreview: recentCommittedText.slice(0, 3).map((t: string) => t.substring(0, 50)),
              userKeywordsCount: userKeywords.length,
              lastQuality,
            },
            'S1: Building prompt - context_text details'
          );
          
          // 构建prompt
          const promptCtx: PromptBuilderContext = {
            userKeywords: userKeywords || [],
            recentCommittedText: recentCommittedText || [],
            qualityScore: lastQuality,
          };
          
          const prompt = this.promptBuilder.build(promptCtx);
          if (prompt) {
            // 如果原有context_text存在，可以合并或替换
            // 这里选择替换，因为prompt包含了更完整的上下文信息
            contextText = prompt;
            logger.info(
              {
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                sessionId: job.session_id,
                promptLength: prompt.length,
                hasKeywords: userKeywords.length > 0,
                hasRecent: recentCommittedText.length > 0,
                keywordCount: userKeywords.length,
                recentCount: recentCommittedText.length,
                promptPreview: prompt.substring(0, 200),
                originalContextText: (job as any).context_text ? (job as any).context_text.substring(0, 100) : null,
              },
              'S1: Prompt built and applied to ASR task'
            );
          } else {
            logger.debug(
              {
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                sessionId: job.session_id,
                reason: 'No keywords or recent text available',
              },
              'S1: Prompt not built (no context available)'
            );
          }
        } catch (error) {
          logger.warn(
            { error, jobId: job.job_id, utteranceIndex: job.utterance_index, sessionId: job.session_id },
            'S1: Failed to build prompt, using original context_text'
          );
          // 降级：使用原始context_text
        }
      } else {
        // 即使未启用 S1，也记录 context_text 信息（用于调试）
        logger.info(
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            contextText: contextText ? contextText.substring(0, 200) : null,
            contextTextLength: contextText?.length || 0,
            s1Enabled: this.enableS1PromptBias,
            hasAggregatorManager: !!this.aggregatorManager,
            hasPromptBuilder: !!this.promptBuilder,
            hasSessionId: !!job.session_id,
          },
          'S1: Context_text passed to ASR (S1 disabled or not available)'
        );
      }
      
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
        // 使用聚合后的音频（已经是PCM16格式）
        // 将 PCM16 Buffer 转换为 base64 字符串
        audioForASR = aggregatedAudio.toString('base64');
        audioFormatForASR = 'pcm16';
        
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedAudioLength: aggregatedAudio.length,
            sampleRate: job.sample_rate || 16000,
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
      };

      let asrResult: ASRResult;
      if (job.enable_streaming_asr && partialCallback) {
        // 流式 ASR 处理
        asrResult = await this.processASRStreaming(asrTask, partialCallback);
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
   * 处理流式 ASR
   */
  private async processASRStreaming(
    task: ASRTask,
    partialCallback: PartialResultCallback
  ): Promise<ASRResult> {
    // 对于流式 ASR，我们需要通过 WebSocket 连接
    // 这里简化处理，实际应该使用 WebSocket 客户端
    // 暂时回退到非流式处理
    logger.warn({}, 'Streaming ASR not fully implemented, falling back to non-streaming');
    return await this.taskRouter.routeASRTask({
      ...task,
      enable_streaming: false,
    });
  }

  /**
   * 处理仅 ASR 任务
   */
  async processASROnly(job: JobAssignMessage): Promise<{ text_asr: string }> {
    // Opus 解码：强制要求输入格式必须是 Opus
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
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          opusDataLength: job.audio.length,
          sampleRate: job.sample_rate || 16000,
        },
        'PipelineOrchestrator: Decoding Opus audio to PCM16 before ASR (ASR Only)'
      );
      
      const pcm16Buffer = await decodeOpusToPcm16(job.audio, job.sample_rate || 16000);
      audioForASR = pcm16Buffer.toString('base64');
      audioFormatForASR = 'pcm16';
      
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          opusDataLength: job.audio.length,
          pcm16DataLength: pcm16Buffer.length,
          sampleRate: job.sample_rate || 16000,
        },
        'PipelineOrchestrator: Opus audio decoded to PCM16 successfully (ASR Only)'
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
        'PipelineOrchestrator: Failed to decode Opus audio (ASR Only). Opus decoding is required, no fallback available.'
      );
      throw new Error(`Opus decoding failed: ${errorMessage}. Three-end communication only uses Opus format, decoding is required.`);
    }
    
    // S1: 构建prompt（如果启用，与processJob中的逻辑一致）
    let contextText = (job as any).context_text;
    if (this.enableS1PromptBias && this.aggregatorManager && this.promptBuilder && job.session_id) {
      try {
        const state = this.aggregatorManager.getOrCreateState(job.session_id, 'offline');
        const recentCommittedText = (state as any).getRecentCommittedText();
        const userKeywords = (state as any).getRecentKeywords();
        const lastQuality = (state as any).getLastCommitQuality();
        
        const promptCtx: PromptBuilderContext = {
          userKeywords: userKeywords || [],
          recentCommittedText: recentCommittedText || [],
          qualityScore: lastQuality,
        };
        
        const prompt = this.promptBuilder.build(promptCtx);
        if (prompt) {
          contextText = prompt;
        }
      } catch (error) {
        logger.warn(
          { error, jobId: job.job_id, sessionId: job.session_id },
          'S1: Failed to build prompt in streaming ASR, using original context_text'
        );
      }
    }
    
    const asrTask: ASRTask = {
      audio: audioForASR, // 使用解码后的 PCM16
      audio_format: audioFormatForASR, // 使用 PCM16 格式
      sample_rate: job.sample_rate || 16000,
      src_lang: job.src_lang,
      enable_streaming: job.enable_streaming_asr || false,
      context_text: contextText,  // S1: 使用构建的prompt或原始context_text
      job_id: job.job_id, // 传递 job_id 用于任务取消
    };

    const asrResult = await this.taskRouter.routeASRTask(asrTask);
    return { text_asr: asrResult.text };
  }


}

