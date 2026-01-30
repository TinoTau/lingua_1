/**
 * AggregationStage - 文本聚合阶段
 * 职责：调用 AggregatorManager.processUtterance()，决定 MERGE / NEW_STREAM / COMMIT
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../../inference/inference-service';
import { AggregatorManager } from '../../aggregator/aggregator-manager';
import { Mode } from '../../aggregator/aggregator-decision';
import { TextForwardMergeManager } from './text-forward-merge-manager';
import { DeduplicationHandler } from '../aggregator-middleware-deduplication';
import logger from '../../logger';

export interface AggregationStageResult {
  /** 给下游（语义修复、NMT、TTS）的文本：SEND 时为合并长句，否则为空 */
  aggregatedText: string;
  /** 仅用于 job_result.text_asr：本 job 的本段（避免每条 result 带累积全文） */
  segmentForJobResult?: string;
  aggregationChanged: boolean;  // 文本是否被聚合（与原始 ASR 文本不同）
  action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  isFirstInMergedGroup?: boolean;  // 是否是合并组中的第一个 utterance（已废弃，保留用于兼容）
  isLastInMergedGroup?: boolean;  // 是否是合并组中的最后一个 utterance（新逻辑：合并到最后一个）
  shouldDiscard?: boolean;  // 是否应该丢弃（< 6字符）
  shouldWaitForMerge?: boolean;  // 是否应该等待合并（6-20字符或20-40字符）
  shouldSendToSemanticRepair?: boolean;  // 是否应该发送给语义修复（> 20字符或手动发送）
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
    private deduplicationHandler: DeduplicationHandler | null = null
  ) { }

  /**
   * 执行文本聚合
   * @param lastCommittedText 上一个已提交的文本（必需参数，调用方必须传递，没有数据时传递null）
   */
  process(
    job: JobAssignMessage,
    result: JobResult,
    lastCommittedText: string | null
  ): AggregationStageResult {
    // 如果未启用 Aggregator，直接返回原始文本；仍设 segmentForJobResult 供翻译用本段
    if (!this.aggregatorManager) {
      return {
        aggregatedText: result.text_asr || '',
        segmentForJobResult: result.text_asr || '',
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
        segmentForJobResult: result.text_asr || '',
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
        segmentForJobResult: '',
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
    // is_pause_triggered 已废弃（pause finalize 已删除），不再使用
    const isTimeoutTriggered = (job as any).is_timeout_triggered || (job as any).isTimeoutTriggered || false;

    const aggregatorResult = this.aggregatorManager.processUtterance(
      job.session_id,
      asrTextTrimmed,
      segments,
      langProbs,
      result.quality_score,
      true,  // isFinal: P0 只处理 final 结果
      isManualCut,  // 从 job 中提取
      mode,
      isTimeoutTriggered
    );

    // 获取聚合后的文本
    let aggregatedText = asrTextTrimmed;
    let isFirstInMergedGroup = false;  // 保留用于兼容
    let isLastInMergedGroup = false;  // 新逻辑：是否是合并组中的最后一个

    // 新逻辑：只有合并组中的最后一个 utterance 才返回聚合后的文本
    // 其他被合并的 utterance（job 0, 1, 2）返回空文本，直接提交给调度服务器核销
    if (aggregatorResult.action === 'MERGE') {
      // MERGE 操作：检查是否是合并组中的最后一个
      // 如果有文本且是最后一个，说明已经提交，返回聚合后的文本
      if (aggregatorResult.isLastInMergedGroup === true && aggregatorResult.text) {
        // 这是合并组中的最后一个 utterance（例如 job3），且已提交，返回聚合后的文本
        aggregatedText = aggregatorResult.text;
        isLastInMergedGroup = true;
        logger.info(
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            isLastInMergedGroup: true,
            aggregatedTextLength: aggregatedText.length,
            aggregatedTextPreview: aggregatedText.substring(0, 100),
            originalTextLength: asrTextTrimmed.length,
            originalTextPreview: asrTextTrimmed.substring(0, 50),
            hasText: !!aggregatorResult.text,
          },
          'AggregationStage: MERGE action, last in merged group, returning aggregated text'
        );
      } else {
        // 这不是合并组中的最后一个 utterance（例如 job 0, 1, 2），返回空文本
        aggregatedText = '';
        isLastInMergedGroup = false;
        logger.info(
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
            hasText: !!aggregatorResult.text,
            originalTextLength: asrTextTrimmed.length,
            originalTextPreview: asrTextTrimmed.substring(0, 50),
            textPreview: aggregatorResult.text?.substring(0, 50),
          },
          'AggregationStage: MERGE action, not last in merged group, returning empty text (will be sent to scheduler for cancellation)'
        );
      }
    } else {
      // NEW_STREAM：返回原始 ASR 文本
      // 如果 aggregatorResult.text 与 asrTextTrimmed 不同，说明可能有问题
      if (aggregatorResult.text && aggregatorResult.text !== asrTextTrimmed) {
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
      aggregatedText = asrTextTrimmed;
      isFirstInMergedGroup = false;
      isLastInMergedGroup = false;
    }

    // 新逻辑：去重和向前合并
    // 1. 首先使用DeduplicationHandler进行Drop判定（完全重复、子串重复、高相似度）
    // 2. 然后使用TextForwardMergeManager进行Trim（边界重叠裁剪）和Gate决策（SEND/HOLD/DROP）

    let textAfterDeduplication = aggregatedText;

    // 使用DeduplicationHandler进行去重（如果提供了）
    if (this.deduplicationHandler && aggregatedText && aggregatedText.trim().length > 0) {
      const duplicateCheck = this.deduplicationHandler.isDuplicate(
        job.session_id,
        aggregatedText,
        job.job_id,
        job.utterance_index
      );

      if (duplicateCheck.isDuplicate) {
        // 完全重复/子串重复/高相似度，返回空文本（DROP）
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedText: aggregatedText.substring(0, 50),
            aggregatedTextLength: aggregatedText.length,
            reason: duplicateCheck.reason,
          },
          'AggregationStage: Duplicate text detected by DeduplicationHandler, filtering (DROP)'
        );
        return {
          aggregatedText: '',
          segmentForJobResult: '',
          aggregationChanged: true,
          action: aggregatorResult.action,
          shouldDiscard: true,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: false,
          metrics: aggregatorResult.metrics,
        };
      }
      // 注意：不再处理 deduplicatedText，边界重叠裁剪由 dedupMergePrecise 统一处理
    }

    // 获取previousText用于TextForwardMergeManager（边界重叠裁剪）
    // 注意：Trim（边界裁剪）使用 lastCommittedText，Drop 判定在 DeduplicationHandler 内部使用 lastSentText
    // 直接使用参数，调用方必须传递（没有数据时传递null）
    const previousText: string | null = lastCommittedText;

    // 添加调试日志：记录previousText，用于排查Trim问题
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedText: aggregatedText.substring(0, 50),
        aggregatedTextLength: aggregatedText.length,
        previousText: previousText ? previousText.substring(0, 50) : null,
        previousTextLength: previousText ? previousText.length : 0,
        hasPreviousText: !!previousText,
      },
      'AggregationStage: Before forward merge (Trim + Gate), checking previousText for boundary overlap'
    );

    // 获取 lastSentText 用于日志输出
    let lastSentText: string | null = null;
    if (this.deduplicationHandler) {
      lastSentText = this.deduplicationHandler.getLastSentText(job.session_id) || null;
    }

    // 使用向前合并管理器处理文本（边界重叠裁剪）
    const forwardMergeResult = this.forwardMergeManager.processText(
      job.session_id,
      textAfterDeduplication,
      previousText,
      job.job_id,
      job.utterance_index || 0,
      isManualCut,  // 传递手动发送标志
      lastSentText  // 传递 lastSentText 用于日志输出
    );

    // 下游（语义修复、NMT、TTS）按原逻辑接收「合并长句」，保证修复/翻译质量；job_result 仅带本 job 的本段。
    // aggregatedText：SEND 时为合并长句（processedText），供语义修复使用；HOLD/丢弃时为空。
    // segmentForJobResult：本 job 的本段，仅用于 buildJobResult 的 text_asr 与 NMT 输入；由 TextForwardMergeManager 必填。
    const segmentForJobResult = forwardMergeResult.shouldDiscard
      ? ''
      : (forwardMergeResult.segmentForCurrentJob ?? '');
    if (!forwardMergeResult.shouldDiscard && forwardMergeResult.segmentForCurrentJob === undefined) {
      logger.warn(
        { jobId: job.job_id, sessionId: job.session_id },
        'AggregationStage: segmentForCurrentJob missing from forwardMergeResult, using empty string'
      );
    }
    const finalAggregatedText = forwardMergeResult.shouldDiscard
      ? ''
      : (forwardMergeResult.shouldSendToSemanticRepair ? forwardMergeResult.processedText : '');

    const aggregationChanged = finalAggregatedText.trim() !== asrTextTrimmed.trim();

    // 优化：检测不完整句子（对本段做检测，若本段被切分则告警）
    const isIncompleteSentence = this.detectIncompleteSentence(segmentForJobResult);
    if (isIncompleteSentence) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          segmentForJobResult: segmentForJobResult.substring(0, 100),
          note: 'Detected incomplete sentence (segment), may be caused by audio split in the middle',
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
        isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
        hasText: !!aggregatorResult.text,
        textLength: aggregatorResult.text?.length || 0,
        originalTextLength: asrTextTrimmed.length,
        aggregatedTextLength: finalAggregatedText.length,
        originalTextPreview: asrTextTrimmed.substring(0, 50),
        aggregatedTextPreview: finalAggregatedText.substring(0, 50),
        segmentForJobResultPreview: segmentForJobResult.substring(0, 50),
        aggregatorTextPreview: aggregatorResult.text?.substring(0, 50),
        shouldDiscard: forwardMergeResult.shouldDiscard,
        shouldWaitForMerge: forwardMergeResult.shouldWaitForMerge,
        shouldSendToSemanticRepair: forwardMergeResult.shouldSendToSemanticRepair,
        deduped: totalDedupCount > 0 || forwardMergeResult.deduped,
        dedupChars: totalDedupChars,
        forwardMergeDeduped: forwardMergeResult.deduped,
        forwardMergeDedupChars: forwardMergeResult.dedupChars,
      },
      'AggregationStage: Processing completed with forward merge'
    );

    return {
      aggregatedText: finalAggregatedText,
      segmentForJobResult,
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

    // 如果文本较短（少于20个字符），且不以标点符号结尾，可能是不完整句子（统一使用20字符标准）
    // 但也要排除一些特殊情况（如单个词、数字等）
    if (trimmed.length < 20) {
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

