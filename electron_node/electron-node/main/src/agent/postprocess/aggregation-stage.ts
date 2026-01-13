/**
 * AggregationStage - 文本聚合阶段
 * 职责：调用 AggregatorManager.processUtterance()，决定 MERGE / NEW_STREAM / COMMIT
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../../inference/inference-service';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { Mode } from '../../aggregator/aggregator-decision';
import { TextForwardMergeManager } from './text-forward-merge-manager';
import { AggregatorMiddleware } from '../aggregator-middleware';
import { DeduplicationHandler } from '../aggregator-middleware-deduplication';
import logger from '../../logger';

export interface AggregationStageResult {
  aggregatedText: string;
  aggregationChanged: boolean;  // 文本是否被聚合（与原始 ASR 文本不同）
  action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  isFirstInMergedGroup?: boolean;  // 是否是合并组中的第一个 utterance（已废弃，保留用于兼容）
  isLastInMergedGroup?: boolean;  // 是否是合并组中的最后一个 utterance（新逻辑：合并到最后一个）
  shouldDiscard?: boolean;  // 是否应该丢弃（< 6字符）
  shouldWaitForMerge?: boolean;  // 是否应该等待合并（6-10字符）
  shouldSendToSemanticRepair?: boolean;  // 是否应该发送给语义修复（> 10字符）
  mergedFromUtteranceIndex?: number;  // 如果合并了前一个utterance，这里存储前一个utterance的索引（用于通知GPU仲裁器）
  mergedFromPendingUtteranceIndex?: number;  // 如果合并了待合并的文本，这里存储待合并文本的utterance索引（用于通知GPU仲裁器）
  metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
}

export class AggregationStage {
  private forwardMergeManager: TextForwardMergeManager = new TextForwardMergeManager();
  
  constructor(
    private aggregatorManager: AggregatorManager | null,
    private aggregatorMiddleware: AggregatorMiddleware | null = null,
    private deduplicationHandler: DeduplicationHandler | null = null
  ) {}

  /**
   * 执行文本聚合
   */
  process(
    job: JobAssignMessage,
    result: JobResult
  ): AggregationStageResult {
    // 如果未启用 Aggregator，直接返回原始文本
    if (!this.aggregatorManager) {
      return {
        aggregatedText: result.text_asr || '',
        aggregationChanged: false,
      };
    }

    // 检查 session_id
    if (!job.session_id || job.session_id.trim() === '') {
      logger.error(
        { jobId: job.job_id, traceId: job.trace_id },
        'AggregationStage: Job missing session_id, using original text'
      );
      return {
        aggregatedText: result.text_asr || '',
        aggregationChanged: false,
      };
    }

    // 检查 ASR 结果是否为空
    // 修复：如果text_asr为空，直接返回空结果，不调用aggregatorManager.processUtterance()
    // 避免从pending text中返回之前缓存的文本，导致重复输出
    const asrTextTrimmed = (result.text_asr || '').trim();
    if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: 'ASR result is empty, skipping aggregator processing to avoid duplicate output',
        },
        'AggregationStage: ASR result is empty, returning empty aggregated text (skipping aggregator)'
      );
      return {
        aggregatedText: '',
        aggregationChanged: false,
      };
    }

    // 提取 segments
    const segments = result.segments;

    // 双向模式：确定源语言（优先使用检测到的语言，否则使用 lang_a 或 src_lang）
    let sourceLang = job.src_lang;
    if (job.src_lang === 'auto' && job.lang_a) {
      // 双向模式下，如果 src_lang 是 "auto"，使用 lang_a 作为默认源语言
      // 实际检测到的语言会在 language_probabilities 中体现
      sourceLang = job.lang_a;
    }

    // 提取语言概率信息
    const langProbs = {
      top1: result.extra?.language_probabilities
        ? Object.keys(result.extra.language_probabilities)[0] || sourceLang
        : sourceLang,
      p1: result.extra?.language_probability || 0.9,
      top2: result.extra?.language_probabilities
        ? Object.keys(result.extra.language_probabilities).find(
            (lang) => {
              const keys = Object.keys(result.extra!.language_probabilities!);
              return lang !== (keys[0] || sourceLang);
            }
          )
        : undefined,
      p2: result.extra?.language_probabilities
        ? (() => {
            const keys = Object.keys(result.extra.language_probabilities);
            const top1Key = keys[0] || sourceLang;
            const top2Key = keys.find((lang) => lang !== top1Key);
            return top2Key ? result.extra.language_probabilities[top2Key] : undefined;
          })()
        : undefined,
    };

    // 确定模式
    // 始终使用双向互译模式
    const mode: Mode = 'two_way';

    // 处理 utterance
    // 从 job 中提取标识（如果调度服务器传递了该参数）
    const isManualCut = (job as any).is_manual_cut || (job as any).isManualCut || false;
    const isPauseTriggered = (job as any).is_pause_triggered || (job as any).isPauseTriggered || false;
    const isTimeoutTriggered = (job as any).is_timeout_triggered || (job as any).isTimeoutTriggered || false;
    // 修复：检测是否合并了pendingSecondHalf，用于聚合决策
    const hasPendingSecondHalfMerged = (job as any).hasPendingSecondHalfMerged || false;
    
    const aggregatorResult = this.aggregatorManager.processUtterance(
      job.session_id,
      asrTextTrimmed,
      segments,
      langProbs,
      result.quality_score,
      true,  // isFinal: P0 只处理 final 结果
      isManualCut,  // 从 job 中提取
      mode,
      isPauseTriggered,  // 从 job 中提取
      isTimeoutTriggered,  // 从 job 中提取
      hasPendingSecondHalfMerged  // 传递pendingSecondHalf合并标志
    );

    // 获取聚合后的文本
    let aggregatedText = asrTextTrimmed;
    let isFirstInMergedGroup = false;  // 保留用于兼容
    let isLastInMergedGroup = false;  // 新逻辑：是否是合并组中的最后一个
    
    // 新逻辑：只有合并组中的最后一个 utterance 才返回聚合后的文本
    // 其他被合并的 utterance（job 0, 1, 2）返回空文本，直接提交给调度服务器核销
    if (aggregatorResult.action === 'MERGE') {
      // MERGE 操作：检查是否是合并组中的最后一个
      if (aggregatorResult.isLastInMergedGroup === true && aggregatorResult.shouldCommit && aggregatorResult.text) {
        // 这是合并组中的最后一个 utterance（例如 job3），且触发了提交，返回聚合后的文本
        aggregatedText = aggregatorResult.text;
        isLastInMergedGroup = true;
        logger.info(  // 改为 info 级别，确保输出
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            isLastInMergedGroup: true,
            aggregatedTextLength: aggregatedText.length,
            aggregatedTextPreview: aggregatedText.substring(0, 100),
            originalTextLength: asrTextTrimmed.length,
            originalTextPreview: asrTextTrimmed.substring(0, 50),
            shouldCommit: aggregatorResult.shouldCommit,
            hasText: !!aggregatorResult.text,
          },
          'AggregationStage: MERGE action, last in merged group, returning aggregated text'
        );
      } else {
        // 这不是合并组中的最后一个 utterance（例如 job 0, 1, 2），返回空文本
        aggregatedText = '';
        isLastInMergedGroup = false;
        logger.info(  // 改为 info 级别，便于调试
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
            shouldCommit: aggregatorResult.shouldCommit,
            hasText: !!aggregatorResult.text,
            originalTextLength: asrTextTrimmed.length,
            originalTextPreview: asrTextTrimmed.substring(0, 50),
            textPreview: aggregatorResult.text?.substring(0, 50),
          },
          'AggregationStage: MERGE action, not last in merged group, returning empty text (will be sent to scheduler for cancellation)'
        );
      }
    } else if (aggregatorResult.shouldCommit && aggregatorResult.text) {
      // NEW_STREAM 且触发了提交：返回原始 ASR 文本，而不是聚合后的文本
      // 因为 NEW_STREAM 表示新的流，不应该包含之前被合并的文本
      // 如果 aggregatorResult.text 与 asrTextTrimmed 不同，说明可能有问题
      if (aggregatorResult.text !== asrTextTrimmed) {
        logger.warn(
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            originalText: asrTextTrimmed.substring(0, 50),
            aggregatorText: aggregatorResult.text.substring(0, 50),
          },
          'AggregationStage: NEW_STREAM but aggregatorResult.text differs from original ASR text, using original'
        );
      }
      aggregatedText = asrTextTrimmed;  // 修复：NEW_STREAM 应该返回原始 ASR 文本，而不是聚合后的文本
      isFirstInMergedGroup = false;
      isLastInMergedGroup = false;
    } else {
      // NEW_STREAM 但未提交：正常情况，使用原始文本
      aggregatedText = asrTextTrimmed;
      isFirstInMergedGroup = false;
      isLastInMergedGroup = false;
    }

    // 新逻辑：去重和向前合并
    // 修复：参考AggregatorMiddleware的去重逻辑，使用DeduplicationHandler进行完整的去重检查
    // 1. 首先使用DeduplicationHandler进行去重（检查完全重复、子串重复、重叠、高相似度）
    // 2. 然后使用TextForwardMergeManager进行向前合并和边界重叠裁剪
    
    let textAfterDeduplication = aggregatedText;
    let deduplicationApplied = false;
    let deduplicationReason: string | undefined = undefined;
    
    // 使用DeduplicationHandler进行去重（如果提供了）
    if (this.deduplicationHandler && aggregatedText && aggregatedText.trim().length > 0) {
      const duplicateCheck = this.deduplicationHandler.isDuplicate(
        job.session_id,
        aggregatedText,
        job.job_id,
        job.utterance_index
      );
      
      if (duplicateCheck.isDuplicate) {
        // 完全重复，返回空文本
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedText: aggregatedText.substring(0, 50),
            aggregatedTextLength: aggregatedText.length,
            reason: duplicateCheck.reason,
          },
          'AggregationStage: Duplicate text detected by DeduplicationHandler, filtering'
        );
        return {
          aggregatedText: '',
          aggregationChanged: true,
          action: aggregatorResult.action,
          shouldDiscard: true,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: false,
          metrics: aggregatorResult.metrics,
        };
      } else if (duplicateCheck.deduplicatedText) {
        // 重叠去重，使用去重后的文本
        textAfterDeduplication = duplicateCheck.deduplicatedText;
        deduplicationApplied = true;
        deduplicationReason = duplicateCheck.reason;
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            originalText: aggregatedText.substring(0, 50),
            deduplicatedText: textAfterDeduplication.substring(0, 50),
            originalLength: aggregatedText.length,
            deduplicatedLength: textAfterDeduplication.length,
            reason: deduplicationReason,
          },
          'AggregationStage: Overlap detected by DeduplicationHandler, using deduplicated text'
        );
      }
    }
    
    // 获取previousText用于TextForwardMergeManager（边界重叠裁剪）
    // 优先使用DeduplicationHandler的lastSentText，否则使用AggregatorMiddleware，最后使用recentCommittedText
    let previousText: string | null = null;
    if (this.deduplicationHandler) {
      const lastSentText = this.deduplicationHandler.getLastSentText(job.session_id);
      previousText = lastSentText || null;
    } else if (this.aggregatorMiddleware) {
      const lastSentText = this.aggregatorMiddleware.getLastSentText(job.session_id);
      previousText = lastSentText || null;
    } else {
      previousText = this.aggregatorManager?.getLastCommittedText(job.session_id, textAfterDeduplication) || null;
    }
    
    // 添加调试日志：记录previousText和textAfterDeduplication，用于排查去重问题
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedText: aggregatedText.substring(0, 50),
        aggregatedTextLength: aggregatedText.length,
        textAfterDeduplication: textAfterDeduplication.substring(0, 50),
        textAfterDeduplicationLength: textAfterDeduplication.length,
        deduplicationApplied,
        deduplicationReason,
        previousText: previousText ? previousText.substring(0, 50) : null,
        previousTextLength: previousText ? previousText.length : 0,
        hasPreviousText: !!previousText,
        usingDeduplicationHandler: !!this.deduplicationHandler,
        usingLastSentText: !!this.deduplicationHandler || !!this.aggregatorMiddleware,
      },
      'AggregationStage: Before forward merge, checking previousText for deduplication'
    );
    
    // 使用向前合并管理器处理文本（边界重叠裁剪）
    const forwardMergeResult = this.forwardMergeManager.processText(
      job.session_id,
      textAfterDeduplication,
      previousText,
      job.job_id,
      job.utterance_index || 0,
      isManualCut  // 传递手动发送标志
    );

    // 根据处理结果更新aggregatedText
    let finalAggregatedText = textAfterDeduplication;
    if (forwardMergeResult.shouldDiscard) {
      // < 6字符：丢弃
      finalAggregatedText = '';
    } else if (forwardMergeResult.shouldWaitForMerge) {
      // 6-10字符：等待合并，暂时不发送
      finalAggregatedText = '';
    } else if (forwardMergeResult.shouldSendToSemanticRepair) {
      // > 10字符：发送给语义修复
      finalAggregatedText = forwardMergeResult.processedText;
    } else {
      // 其他情况：使用原始文本
      finalAggregatedText = forwardMergeResult.processedText;
    }

    const aggregationChanged = finalAggregatedText.trim() !== asrTextTrimmed.trim() || deduplicationApplied;

    // 优化：检测不完整句子（如果文本不以标点符号结尾，且长度较短，可能是被切分的句子）
    const isIncompleteSentence = this.detectIncompleteSentence(finalAggregatedText);
    if (isIncompleteSentence) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          aggregatedText: finalAggregatedText.substring(0, 100),
          note: 'Detected incomplete sentence, may be caused by audio split in the middle',
        },
        'AggregationStage: Detected incomplete sentence, text may be split incorrectly'
      );
    }

    // 合并去重指标
    const totalDedupChars = (aggregatorResult.metrics?.dedupCharsRemoved || 0) + forwardMergeResult.dedupChars;
    const totalDedupCount = (aggregatorResult.metrics?.dedupCount || 0) + (forwardMergeResult.deduped ? 1 : 0);

    // 记录指标（始终记录，包含关键信息）- 在 aggregatedText 确定之后
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        action: aggregatorResult.action,
        shouldCommit: aggregatorResult.shouldCommit,
        isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
        hasText: !!aggregatorResult.text,
        textLength: aggregatorResult.text?.length || 0,
        originalTextLength: asrTextTrimmed.length,
        aggregatedTextLength: finalAggregatedText.length,
        originalTextPreview: asrTextTrimmed.substring(0, 50),
        aggregatedTextPreview: finalAggregatedText.substring(0, 50),
        aggregatorTextPreview: aggregatorResult.text?.substring(0, 50),
        shouldDiscard: forwardMergeResult.shouldDiscard,
        shouldWaitForMerge: forwardMergeResult.shouldWaitForMerge,
        shouldSendToSemanticRepair: forwardMergeResult.shouldSendToSemanticRepair,
        deduped: totalDedupCount > 0 || deduplicationApplied,
        dedupChars: totalDedupChars,
        deduplicationApplied,
        deduplicationReason,
        forwardMergeDeduped: forwardMergeResult.deduped,
        forwardMergeDedupChars: forwardMergeResult.dedupChars,
      },
      'AggregationStage: Processing completed with forward merge'
    );

    return {
      aggregatedText: finalAggregatedText,
      aggregationChanged,
      action: aggregatorResult.action,
      shouldDiscard: forwardMergeResult.shouldDiscard,
      shouldWaitForMerge: forwardMergeResult.shouldWaitForMerge,
      shouldSendToSemanticRepair: forwardMergeResult.shouldSendToSemanticRepair,
      mergedFromUtteranceIndex: forwardMergeResult.mergedFromUtteranceIndex,  // 如果合并了前一个utterance，传递索引
      mergedFromPendingUtteranceIndex: forwardMergeResult.mergedFromPendingUtteranceIndex,  // 如果合并了待合并的文本，传递索引
      metrics: {
        dedupCount: totalDedupCount,
        dedupCharsRemoved: totalDedupChars,
      },
      isFirstInMergedGroup,  // 保留用于兼容
      isLastInMergedGroup,  // 新逻辑：标识是否是合并组中的最后一个
    };
  }

  /**
   * 检测不完整句子
   * 如果文本不以标点符号结尾，且长度较短，可能是被切分的句子
   */
  private detectIncompleteSentence(text: string): boolean {
    if (!text || text.trim().length === 0) {
      return false;
    }

    const trimmed = text.trim();
    // 检查是否以标点符号结尾（中文和英文标点）
    const endsWithPunctuation = /[。，！？、；：.!?,;:]$/.test(trimmed);
    
    // 如果以标点符号结尾，认为是完整句子
    if (endsWithPunctuation) {
      return false;
    }

    // 如果文本较短（少于16个字符），且不以标点符号结尾，可能是不完整句子（统一使用SemanticRepairScorer的标准：16字符）
    // 但也要排除一些特殊情况（如单个词、数字等）
    if (trimmed.length < 16) {
      // 检查是否包含常见的不完整句子模式
      // 例如：以"的"、"了"、"在"等结尾，但没有后续内容
      const incompletePatterns = [
        /的$/, /了$/, /在$/, /是$/, /有$/, /会$/, /能$/, /要$/, /我们$/, /这个$/, /那个$/,
        /问题$/, /方法$/, /系统$/, /服务$/, /结果$/, /原因$/, /效果$/
      ];
      
      for (const pattern of incompletePatterns) {
        if (pattern.test(trimmed)) {
          return true;
        }
      }
    }

    // 如果文本较长但不以标点符号结尾，也可能是不完整句子
    // 但这种情况比较复杂，暂时不标记为不完整
    return false;
  }
}

