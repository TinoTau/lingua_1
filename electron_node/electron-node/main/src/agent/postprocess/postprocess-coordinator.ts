/**
 * PostProcessCoordinator - 后处理协调器
 * 职责：串联各 Stage，管理 session / trace / context，汇总最终输出
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../../inference/inference-service';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { TaskRouter } from '../../task-router/task-router';
import { ServicesHandler } from '../node-agent-services';
import { AggregationStageResult } from './aggregation-stage';
import { TranslationStage, TranslationStageConfig, TranslationStageResult } from './translation-stage';
import { DedupStage, DedupStageResult } from './dedup-stage';
import { TTSStage, TTSStageResult } from './tts-stage';
import { TONEStage, TONEStageResult } from './tone-stage';
import logger from '../../logger';
import { loadNodeConfig } from '../../node-config';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { PostProcessMergeHandler } from './postprocess-merge-handler';
import { PostProcessTextFilter } from './postprocess-text-filter';
import { DeduplicationHandler } from '../aggregator-middleware-deduplication';

export interface PostProcessResult {
  shouldSend: boolean;
  aggregatedText: string;
  translatedText: string;
  ttsAudio?: string;  // TTS 音频
  ttsFormat?: string;  // TTS 格式
  toneAudio?: string;  // TONE 音色配音音频
  toneFormat?: string;  // TONE 音频格式
  speakerId?: string;  // 音色ID
  action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
    translationTimeMs?: number;
    ttsTimeMs?: number;
    toneTimeMs?: number;
    fromCache?: boolean;
  };
  reason?: string;  // 如果 shouldSend=false，说明原因
}

export interface PostProcessConfig {
  enabled: boolean;
  translationConfig?: TranslationStageConfig;
}

export class PostProcessCoordinator {
  private translationStage: TranslationStage | null = null;
  private ttsStage: TTSStage | null = null;
  private toneStage: TONEStage | null = null;
  private dedupStage: DedupStage;
  private enablePostProcessTranslation: boolean;
  // 模块化处理器
  private mergeHandler: PostProcessMergeHandler;
  private textFilter: PostProcessTextFilter;
  // 去重处理器（维护lastSentText，记录实际发送的文本）
  private deduplicationHandler: DeduplicationHandler;

  constructor(
    private aggregatorManager: AggregatorManager | null,
    private taskRouter: TaskRouter | null,
    private servicesHandler?: ServicesHandler | null,
    config?: PostProcessConfig
  ) {
    // 读取 Feature Flag 配置
    const nodeConfig = loadNodeConfig();
    this.enablePostProcessTranslation = nodeConfig.features?.enablePostProcessTranslation ?? true;

    // 注意：文本聚合现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
    // 不再需要在这里初始化 AggregationStage

    // 初始化各 Stage
    this.dedupStage = new DedupStage();

    // 如果启用 PostProcess 翻译，初始化 TranslationStage 和 TTSStage
    if (this.enablePostProcessTranslation && taskRouter) {
      this.translationStage = new TranslationStage(
        taskRouter,
        aggregatorManager,
        config?.translationConfig || {}
      );
      this.ttsStage = new TTSStage(taskRouter);
      this.toneStage = new TONEStage(taskRouter);
      logger.info({}, 'PostProcessCoordinator: TranslationStage, TTSStage, and TONEStage initialized');
    } else {
      logger.info({}, 'PostProcessCoordinator: TranslationStage and TTSStage disabled');
    }

    // 注意：语义修复现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
    // 不再需要在这里初始化语义修复Stage

    // 初始化模块化处理器
    this.mergeHandler = new PostProcessMergeHandler();
    this.textFilter = new PostProcessTextFilter();
    // 初始化去重处理器（维护lastSentText，记录实际发送的文本）
    this.deduplicationHandler = new DeduplicationHandler();

    logger.info(
      {
        enablePostProcessTranslation: this.enablePostProcessTranslation,
        hasAggregatorManager: !!aggregatorManager,
        hasTaskRouter: !!taskRouter,
        hasServicesHandler: !!servicesHandler,
        note: 'Text aggregation and semantic repair are now handled in PipelineOrchestrator (bound to ASR)',
      },
      'PostProcessCoordinator initialized'
    );
  }

  /**
   * 注意：语义修复现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
   * 不再需要重新初始化语义修复Stage
   */

  /**
   * 获取 DedupStage 实例（用于在成功发送后记录job_id）
   */
  getDedupStage(): DedupStage {
    return this.dedupStage;
  }

  /**
   * 处理 JobResult（后处理入口）
   */
  async process(
    job: JobAssignMessage,
    result: JobResult
  ): Promise<PostProcessResult> {
    const processStartTime = Date.now();
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        asrTextLength: result.text_asr?.length || 0,
        hasTranslatedText: !!result.text_translated,
        timestamp: new Date().toISOString(),
      },
      'PostProcessCoordinator: Starting post-process (ENTRY)'
    );

    // 如果未启用，直接返回原始结果
    if (!this.enablePostProcessTranslation) {
      return {
        shouldSend: true,
        aggregatedText: result.text_asr || '',
        translatedText: result.text_translated || '',
      };
    }

    // Stage 1: 使用聚合和语义修复后的文本（如果已应用）
    // 注意：文本聚合和语义修复现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
    // result.text_asr 已经是聚合和修复后的文本（如果应用了）
    const asrTextTrimmed = (result.text_asr || '').trim();
    if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
      // 先经过DedupStage检查，避免重复发送相同的空结果
      const dedupResult = this.dedupStage.process(job, '', '');

      if (!dedupResult.shouldSend) {
        // DedupStage过滤了空结果，但仍然需要发送给调度服务器（用于核销）
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            reason: dedupResult.reason || 'duplicate_empty',
            note: 'DedupStage filtered duplicate empty result, but still sending to scheduler for job cancellation',
          },
          'PostProcessCoordinator: Duplicate empty result filtered by DedupStage, but still sending to scheduler for cancellation'
        );
      } else {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            reason: 'ASR result is empty, returning empty result but shouldSend=true to prevent timeout',
          },
          'PostProcessCoordinator: ASR result is empty, returning empty result (shouldSend=true to prevent scheduler timeout)'
        );
      }

      // 无论DedupStage是否过滤，都返回shouldSend=true，确保调度服务器能够核销job
      return {
        shouldSend: true,  // 修复：返回true，确保发送空结果给调度服务器，避免超时
        aggregatedText: '',
        translatedText: '',
        ttsAudio: '',
        ttsFormat: 'opus',
        reason: 'ASR result is empty',
      };
    }

    // 使用 PipelineOrchestrator 处理后的文本（已经是聚合和修复后的文本）
    let textForTranslation = result.text_asr;  // 已经是聚合和修复后的文本
    let semanticRepairApplied = result.semantic_repair_applied || false;
    let semanticRepairConfidence = result.semantic_repair_confidence || 0;

    // 构建聚合结果（用于后续处理）
    // 注意：文本聚合现在在 PipelineOrchestrator 中执行，这里只是从 JobResult 中提取信息
    const aggregationResult: AggregationStageResult = {
      aggregatedText: textForTranslation,
      aggregationChanged: result.aggregation_applied || false,
      action: result.aggregation_action,
      isLastInMergedGroup: result.is_last_in_merged_group,
      isFirstInMergedGroup: false,  // 已废弃，保留用于兼容
      shouldDiscard: false,  // 文本过滤逻辑现在在 PipelineOrchestrator 中处理
      shouldWaitForMerge: false,  // 文本过滤逻辑现在在 PipelineOrchestrator 中处理
      shouldSendToSemanticRepair: true,  // 语义修复现在在 PipelineOrchestrator 中处理
      metrics: result.aggregation_metrics,
    };

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedTextLength: textForTranslation.length,
        aggregationApplied: result.aggregation_applied,
        semanticRepairApplied: semanticRepairApplied,
        action: result.aggregation_action,
        note: 'Using aggregated and semantic-repaired text from PipelineOrchestrator',
      },
      'PostProcessCoordinator: Using aggregated and semantic-repaired text from PipelineOrchestrator'
    );

    // 处理合并逻辑
    const mergeResult = this.mergeHandler.process(job, aggregationResult);
    if (mergeResult.shouldReturn && mergeResult.result) {
      return mergeResult.result;
    }

    // 处理文本过滤逻辑
    const filterResult = this.textFilter.process(job, aggregationResult);
    if (filterResult.shouldReturn && filterResult.result) {
      return filterResult.result;
    }

    // Stage 2: 翻译（唯一 NMT 入口）
    let translationResult: TranslationStageResult = {
      translatedText: '',
    };

    // 检查是否需要翻译
    let shouldTranslate = job.pipeline?.use_nmt !== false;  // 默认 true，如果明确设置为 false 则跳过

    // 支持只选择 NMT（文本翻译模式）：如果 use_asr === false，使用 job 中的输入文本
    let textToTranslate = textForTranslation;
    if (job.pipeline?.use_asr === false) {
      // 只选择 NMT 模式：使用 job 中的输入文本（如果有）
      const inputText = (job as any).input_text || (job as any).text || '';
      if (inputText && inputText.trim().length > 0) {
        textToTranslate = inputText.trim();
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            inputTextLength: textToTranslate.length,
            note: 'Text translation mode: using input_text from job (ASR disabled)',
          },
          'PostProcessCoordinator: Text translation mode - using input_text from job'
        );
      } else {
        logger.warn(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            note: 'Text translation mode but no input_text provided',
          },
          'PostProcessCoordinator: Text translation mode but no input_text, skipping translation'
        );
        shouldTranslate = false;
      }
    }

    // 如果文本被聚合，或者 Pipeline NMT 已禁用，需要翻译
    // 注意：aggregationResult.aggregationChanged 表示文本是否被聚合（与原始 ASR 文本不同）
    const needsTranslation = shouldTranslate && (
      aggregationResult.aggregationChanged ||  // 文本被聚合
      !result.text_translated ||
      result.text_translated.trim().length === 0 ||
      job.pipeline?.use_asr === false  // 只选择 NMT 模式
    );

    logger.info(  // 改为 info 级别，确保输出
      {
        jobId: job.job_id,
        utteranceIndex: job.utterance_index,
        action: aggregationResult.action,
        isFirstInMergedGroup: aggregationResult.isFirstInMergedGroup,
        isLastInMergedGroup: aggregationResult.isLastInMergedGroup,
        aggregatedTextLength: aggregationResult.aggregatedText.length,
        aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 100),
        aggregationChanged: aggregationResult.aggregationChanged,
        needsTranslation,
        hasPipelineTranslation: !!result.text_translated,
      },
      'PostProcessCoordinator: Before translation stage'
    );

    if (needsTranslation && this.translationStage) {
      // 重要：翻译时使用语义修复后的文本（textForTranslation），而不是原始聚合文本
      // 记录实际传递给TranslationStage的文本
      const translationStartTime = Date.now();
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          textToTranslate: textForTranslation,
          textToTranslateLength: textForTranslation.length,
          textPreview: textForTranslation.substring(0, 100),
          originalAggregatedText: aggregationResult.aggregatedText,
          originalAggregatedTextLength: aggregationResult.aggregatedText.length,
          semanticRepairApplied,
          semanticRepairConfidence,
          timestamp: new Date().toISOString(),
        },
        'PostProcessCoordinator: Starting translation stage (NMT request START)'
      );

      translationResult = await this.translationStage.process(
        job,
        textToTranslate,  // 使用 textToTranslate（可能是 input_text 或 textForTranslation）
        result.quality_score,
        aggregationResult.metrics?.dedupCharsRemoved || 0,
        {
          semanticRepairApplied,
          semanticRepairConfidence,
        }
      );
      const translationDuration = Date.now() - translationStartTime;

      if (translationDuration > 30000) {
        logger.warn({
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          translationDurationMs: translationDuration,
          note: 'Translation stage took longer than 30 seconds - may be blocked by homophone repair',
        }, 'PostProcessCoordinator: Translation stage took too long');
      }

      logger.debug(
        {
          jobId: job.job_id,
          utteranceIndex: job.utterance_index,
          translatedTextLength: translationResult.translatedText.length,
          translatedTextPreview: translationResult.translatedText.substring(0, 100),
          fromCache: translationResult.fromCache,
          translationDurationMs: translationDuration,
        },
        'PostProcessCoordinator: Translation completed'
      );
    } else if (result.text_translated) {
      // 使用 Pipeline 的翻译结果（如果存在且文本未被聚合）
      translationResult = {
        translatedText: result.text_translated,
        fromCache: false,
      };
    }

    // Stage 3: 去重检查
    const dedupResult = this.dedupStage.process(
      job,
      aggregationResult.aggregatedText,
      translationResult.translatedText
    );

    // Stage 4: TTS 音频生成（在翻译完成后，但只在去重检查通过时生成）
    let ttsResult: TTSStageResult = {
      ttsAudio: '',
      ttsFormat: 'opus',  // 强制使用 opus 格式
    };

    // 生成 TTS 音频（只有在去重检查通过时才生成 TTS）
    // 如果去重检查失败，说明这是重复的文本，不应该生成 TTS 音频
    // 检查是否需要生成 TTS
    const shouldGenerateTTS = job.pipeline?.use_tts !== false && dedupResult.shouldSend;  // 默认 true，如果明确设置为 false 则跳过

    if (shouldGenerateTTS && translationResult.translatedText && translationResult.translatedText.trim().length > 0 && this.ttsStage) {
      try {
        const ttsStartTime = Date.now();
        ttsResult = await this.ttsStage.process(job, translationResult.translatedText);
        const ttsDuration = Date.now() - ttsStartTime;

        if (ttsDuration > 30000) {
          logger.warn({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            ttsDurationMs: ttsDuration,
            note: 'TTS generation took longer than 30 seconds - GPU may be overloaded',
          }, 'PostProcessCoordinator: TTS generation took too long');
        }
        // TTSStage 返回 WAV 格式，Opus 编码由 NodeAgent 统一处理
      } catch (ttsError) {
        // TTS 生成失败（比如 Opus 编码失败），记录错误但继续处理
        // 返回空音频，确保任务仍然返回结果
        logger.error(
          {
            error: ttsError,
            jobId: job.job_id,
            sessionId: job.session_id,
            translatedText: translationResult.translatedText.substring(0, 50),
          },
          'PostProcessCoordinator: TTS generation failed, continuing with empty audio'
        );
        ttsResult = {
          ttsAudio: '',
          ttsFormat: 'opus',
        };
      }
    } else if (result.tts_audio) {
      // 如果 Pipeline 已经生成了 TTS 音频，使用 Pipeline 的结果
      ttsResult = {
        ttsAudio: result.tts_audio,
        ttsFormat: result.tts_format || 'opus',  // 强制使用 opus 格式
      };
    } else {
      // TTS 被禁用或跳过
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          useTts: job.pipeline?.use_tts,
          shouldSend: dedupResult.shouldSend,
          hasTranslatedText: !!translationResult.translatedText,
        },
        'PostProcessCoordinator: TTS disabled by pipeline config or skipped, no TTS audio generated'
      );
    }

    // Stage 5: TONE 音色配音（在 TTS 之后，如果启用了 TONE）
    let toneResult: TONEStageResult = {
      toneAudio: undefined,
      toneFormat: undefined,
      speakerId: undefined,
    };

    // 检查是否需要生成 TONE
    const shouldGenerateTONE = job.pipeline?.use_tone === true && ttsResult.ttsAudio && ttsResult.ttsAudio.trim().length > 0;

    if (shouldGenerateTONE && this.toneStage) {
      try {
        const toneStartTime = Date.now();
        // 从 job 中提取 speaker_id
        const speakerId = (job as any).speaker_id || (job as any).voice_id;
        toneResult = await this.toneStage.process(
          job,
          ttsResult.ttsAudio,
          ttsResult.ttsFormat || 'opus',
          speakerId
        );
        const toneDuration = Date.now() - toneStartTime;

        if (toneDuration > 30000) {
          logger.warn({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            toneDurationMs: toneDuration,
            note: 'TONE processing took longer than 30 seconds',
          }, 'PostProcessCoordinator: TONE processing took too long');
        }

        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            speakerId: toneResult.speakerId,
            hasToneAudio: !!toneResult.toneAudio,
            toneDurationMs: toneDuration,
          },
          'PostProcessCoordinator: TONE processing completed'
        );
      } catch (toneError) {
        // TONE 处理失败，记录错误但继续处理
        logger.error(
          {
            error: toneError,
            jobId: job.job_id,
            sessionId: job.session_id,
          },
          'PostProcessCoordinator: TONE processing failed, continuing without TONE audio'
        );
        // 保持 toneResult 为空
      }
    } else {
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          useTone: job.pipeline?.use_tone,
          hasTtsAudio: !!ttsResult.ttsAudio,
        },
        'PostProcessCoordinator: TONE disabled by pipeline config or no TTS audio, skipping TONE'
      );
    }

    // 汇总结果
    // 重要：如果进行了语义修复，使用修复后的文本作为 aggregatedText（用于返回给web端的text_asr字段）
    // 这样web端显示的就是修复后的文本，而不是原始ASR文本
    const finalAggregatedText = textForTranslation || aggregationResult.aggregatedText;
    const totalProcessDuration = Date.now() - processStartTime;

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        totalProcessDurationMs: totalProcessDuration,
        shouldSend: dedupResult.shouldSend,
        aggregatedTextLength: finalAggregatedText.length,
        translatedTextLength: translationResult.translatedText.length,
        timestamp: new Date().toISOString(),
      },
      'PostProcessCoordinator: Post-process completed (EXIT)'
    );

    // 如果使用了 TONE，优先使用 TONE 音频，否则使用 TTS 音频
    const finalAudio = toneResult.toneAudio || ttsResult.ttsAudio;
    const finalAudioFormat = toneResult.toneFormat || ttsResult.ttsFormat || 'opus';

    const postProcessResult: PostProcessResult = {
      shouldSend: dedupResult.shouldSend,
      aggregatedText: finalAggregatedText,
      translatedText: translationResult.translatedText,
      ttsAudio: finalAudio,  // 使用 TONE 音频（如果存在）或 TTS 音频
      ttsFormat: finalAudioFormat,  // 使用 TONE 格式（如果存在）或 TTS 格式
      toneAudio: toneResult.toneAudio,  // 单独返回 TONE 音频（可选）
      toneFormat: toneResult.toneFormat,
      speakerId: toneResult.speakerId,
      action: aggregationResult.action,
      metrics: {
        ...aggregationResult.metrics,
        translationTimeMs: translationResult.translationTimeMs,
        ttsTimeMs: ttsResult.ttsTimeMs,
        toneTimeMs: toneResult.toneTimeMs,
        fromCache: translationResult.fromCache,
      },
      reason: dedupResult.reason,
    };

    logger.debug(
      {
        jobId: job.job_id,
        utteranceIndex: job.utterance_index,
        shouldSend: postProcessResult.shouldSend,
        aggregatedTextLength: postProcessResult.aggregatedText.length,
        translatedTextLength: postProcessResult.translatedText.length,
        translatedTextPreview: postProcessResult.translatedText.substring(0, 100),
        ttsAudioLength: postProcessResult.ttsAudio?.length || 0,
        action: postProcessResult.action,
        reason: postProcessResult.reason,
      },
      'PostProcessCoordinator: Final result summary'
    );

    return postProcessResult;
  }

  /**
   * 清理 session
   */
  removeSession(sessionId: string): void {
    this.dedupStage.removeSession(sessionId);
    this.deduplicationHandler.removeSession(sessionId);
    // AggregationStage 和 TranslationStage 使用 AggregatorManager，由外部管理
    logger.debug({ sessionId }, 'PostProcessCoordinator: Session removed');
  }

  /**
   * 获取最后发送的文本（用于去重）
   */
  getLastSentText(sessionId: string): string | undefined {
    return this.deduplicationHandler.getLastSentText(sessionId);
  }

  /**
   * 设置最后发送的文本（在成功发送后调用）
   */
  setLastSentText(sessionId: string, text: string): void {
    this.deduplicationHandler.setLastSentText(sessionId, text);
    logger.debug(
      {
        sessionId,
        textLength: text.length,
        textPreview: text.substring(0, 50),
      },
      'PostProcessCoordinator: Updated lastSentText after successful send'
    );
  }

  /**
   * 获取去重处理器（用于AggregationStage）
   */
  getDeduplicationHandler(): DeduplicationHandler {
    return this.deduplicationHandler;
  }
}

