/**
 * PostProcess文本过滤模块
 * 负责处理文本长度过滤、空文本处理等逻辑
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AggregationStageResult } from './aggregation-stage';
import logger from '../../logger';

export interface TextFilterResult {
  shouldReturn: boolean;
  result?: {
    shouldSend: boolean;
    aggregatedText: string;
    translatedText: string;
    ttsAudio: string;
    ttsFormat: string;
    action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
    metrics?: {
      dedupCount?: number;
      dedupCharsRemoved?: number;
    };
    reason?: string;
  };
}

export class PostProcessTextFilter {
  /**
   * 处理文本过滤逻辑
   */
  process(
    job: JobAssignMessage,
    aggregationResult: AggregationStageResult
  ): TextFilterResult {
    if (aggregationResult.shouldDiscard) {
      // < 6字符：直接丢弃
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          aggregatedTextLength: aggregationResult.aggregatedText.length,
          reason: 'Text too short (< 6 chars), discarding (>= 20 chars will be sent to semantic repair)',
        },
        'PostProcessCoordinator: Text too short, discarding'
      );
      return {
        shouldReturn: true,
        result: {
          shouldSend: false,
          aggregatedText: '',
          translatedText: '',
          ttsAudio: '',
          ttsFormat: 'opus',
          action: aggregationResult.action,
          metrics: aggregationResult.metrics,
          reason: 'Text too short (< 6 chars), discarded (>= 20 chars will be sent to semantic repair)',
        },
      };
    }

    if (aggregationResult.shouldWaitForMerge) {
      // 6-20字符：等待与下一句合并
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          aggregatedTextLength: aggregationResult.aggregatedText.length,
          reason: 'Text length 6-20 chars, waiting for merge with next utterance',
        },
        'PostProcessCoordinator: Text length 6-20 chars, waiting for merge'
      );
      return {
        shouldReturn: true,
        result: {
          shouldSend: false,
          aggregatedText: '',
          translatedText: '',
          ttsAudio: '',
          ttsFormat: 'opus',
          action: aggregationResult.action,
          metrics: aggregationResult.metrics,
          reason: 'Text length 6-20 chars, waiting for merge',
        },
      };
    }

    // 如果聚合后的文本为空，直接返回
    if (!aggregationResult.aggregatedText || aggregationResult.aggregatedText.trim().length === 0) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR), skipping post-process',
          action: aggregationResult.action,
        },
        'PostProcessCoordinator: Aggregated text is empty, returning shouldSend=false to avoid duplicate output'
      );
      return {
        shouldReturn: true,
        result: {
          shouldSend: false,
          aggregatedText: '',
          translatedText: '',
          ttsAudio: '',
          ttsFormat: 'opus',
          action: aggregationResult.action,
          metrics: aggregationResult.metrics,
          reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR)',
        },
      };
    }

    return { shouldReturn: false };
  }
}
