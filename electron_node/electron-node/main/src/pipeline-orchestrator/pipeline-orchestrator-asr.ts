/**
 * Pipeline Orchestrator ASR Handler
 * 处理ASR相关的逻辑，包括流式处理等
 */

import logger from '../logger';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../task-router/task-router';
import {
  ASRTask,
  ASRResult,
} from '../task-router/types';
import { PartialResultCallback } from '../inference/inference-service';
import { decodeOpusToPcm16 } from '../utils/opus-codec';
import { AggregatorManager } from '../aggregator/aggregator-manager';
import { PromptBuilder, PromptBuilderContext } from '../asr/prompt-builder';
import { loadNodeConfig } from '../node-config';

export class PipelineOrchestratorASRHandler {
  private enableS1PromptBias: boolean;
  private aggregatorManager: AggregatorManager | null;
  private promptBuilder: PromptBuilder | null;

  constructor(
    private taskRouter: TaskRouter,
    aggregatorManager?: AggregatorManager
  ) {
    // 读取 Feature Flag 配置
    const config = loadNodeConfig();
    this.enableS1PromptBias = config.features?.enableS1PromptBias ?? false;
    
    // S1: 初始化 AggregatorManager 和 PromptBuilder（仅在启用时）
    if (aggregatorManager && this.enableS1PromptBias) {
      this.aggregatorManager = aggregatorManager;
      const mode = 'offline'; // 默认模式
      this.promptBuilder = new PromptBuilder(mode);
      logger.info({ mode }, 'PipelineOrchestratorASRHandler: S1 PromptBuilder initialized');
    } else {
      this.aggregatorManager = aggregatorManager || null;
      this.promptBuilder = null;
    }
  }

  /**
   * 构建S1 prompt（如果启用）
   */
  buildPrompt(job: JobAssignMessage): string | undefined {
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
    return contextText;
  }

  /**
   * 处理流式 ASR
   */
  async processASRStreaming(
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
        'PipelineOrchestratorASRHandler: Decoding Opus audio to PCM16 before ASR (ASR Only)'
      );
      
      const pcm16Buffer = await decodeOpusToPcm16(job.audio, job.sample_rate || 16000);
      
      // 验证PCM16 Buffer长度是否为2的倍数（PCM16要求）
      let finalPcm16Buffer = pcm16Buffer;
      if (pcm16Buffer.length % 2 !== 0) {
        logger.error(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pcm16DataLength: pcm16Buffer.length,
            isOdd: pcm16Buffer.length % 2 !== 0,
            opusDataLength: job.audio.length,
          },
          '🚨 CRITICAL: Decoded PCM16 buffer length is not a multiple of 2 before sending to ASR! This will cause 400 error.'
        );
        // 修复：截断最后一个字节
        const fixedLength = pcm16Buffer.length - (pcm16Buffer.length % 2);
        finalPcm16Buffer = pcm16Buffer.slice(0, fixedLength);
        logger.warn(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            originalLength: pcm16Buffer.length,
            fixedLength: finalPcm16Buffer.length,
            bytesRemoved: pcm16Buffer.length - finalPcm16Buffer.length,
          },
          'Fixed PCM16 buffer length by truncating last byte(s) before sending to ASR'
        );
      }
      
      audioForASR = finalPcm16Buffer.toString('base64');
      audioFormatForASR = 'pcm16';
      
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          opusDataLength: job.audio.length,
          pcm16DataLength: finalPcm16Buffer.length,
          originalLength: pcm16Buffer.length,
          wasFixed: finalPcm16Buffer.length !== pcm16Buffer.length,
          sampleRate: job.sample_rate || 16000,
          isLengthValid: finalPcm16Buffer.length % 2 === 0,
        },
        'PipelineOrchestratorASRHandler: Opus audio decoded to PCM16 successfully (ASR Only)'
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
        'PipelineOrchestratorASRHandler: Failed to decode Opus audio (ASR Only). Opus decoding is required, no fallback available.'
      );
      throw new Error(`Opus decoding failed: ${errorMessage}. Three-end communication only uses Opus format, decoding is required.`);
    }
    
    // S1: 构建prompt（如果启用，与processJob中的逻辑一致）
    let contextText = this.buildPrompt(job);
    
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
