/**
 * PostProcess合并处理模块
 * 负责处理文本合并相关的逻辑
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AggregationStageResult } from './aggregation-stage';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import logger from '../../logger';

export interface MergeHandlerResult {
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

export class PostProcessMergeHandler {
  /**
   * 处理合并相关的逻辑
   */
  process(
    job: JobAssignMessage,
    aggregationResult: AggregationStageResult
  ): MergeHandlerResult {
    // 如果这个 utterance 被合并但不是最后一个，返回空结果
    if (aggregationResult.action === 'MERGE' && !aggregationResult.isLastInMergedGroup) {
      const sequentialExecutor = getSequentialExecutor();
      const sessionId = job.session_id || '';
      const utteranceIndex = job.utterance_index || 0;
      
      // 取消所有后续服务类型的任务（NMT、TTS、Semantic Repair）
      const serviceTypes: Array<'NMT' | 'TTS' | 'SEMANTIC_REPAIR'> = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
      for (const serviceType of serviceTypes) {
        sequentialExecutor.cancelTask(sessionId, utteranceIndex, 'Task merged into later utterance', serviceType);
      }
      
      logger.info(
        {
          jobId: job.job_id,
          utteranceIndex: job.utterance_index,
          action: aggregationResult.action,
          isLastInMergedGroup: aggregationResult.isLastInMergedGroup,
          aggregatedTextLength: aggregationResult.aggregatedText.length,
          aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 50),
        },
        'PostProcessCoordinator: Utterance merged but not last in group, cancelled sequential executor tasks (NMT/TTS/SemanticRepair), returning empty result'
      );
      return {
        shouldReturn: true,
        result: {
          shouldSend: true,
          aggregatedText: '',
          translatedText: '',
          ttsAudio: '',
          ttsFormat: 'opus',
          action: aggregationResult.action,
          metrics: aggregationResult.metrics,
        },
      };
    }

    // 处理向前合并的结果
    if (aggregationResult.mergedFromUtteranceIndex !== undefined || aggregationResult.mergedFromPendingUtteranceIndex !== undefined) {
      const sequentialExecutor = getSequentialExecutor();
      const sessionId = job.session_id || '';
      
      // 取消被合并的前一个utterance的任务
      if (aggregationResult.mergedFromUtteranceIndex !== undefined) {
        const previousUtteranceIndex = aggregationResult.mergedFromUtteranceIndex;
        const serviceTypes: Array<'NMT' | 'TTS' | 'SEMANTIC_REPAIR'> = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
        for (const serviceType of serviceTypes) {
          sequentialExecutor.cancelTask(
            sessionId,
            previousUtteranceIndex,
            `Previous utterance text merged into current utterance (${job.utterance_index})`,
            serviceType
          );
        }
        logger.info(
          {
            jobId: job.job_id,
            currentUtteranceIndex: job.utterance_index,
            previousUtteranceIndex,
            sessionId,
            reason: 'Previous utterance text merged into current, cancelled previous utterance GPU tasks',
          },
          'PostProcessCoordinator: Previous utterance text merged, cancelled previous utterance GPU tasks'
        );
      }
      
      // 取消被合并的待合并文本的任务
      if (aggregationResult.mergedFromPendingUtteranceIndex !== undefined) {
        const pendingUtteranceIndex = aggregationResult.mergedFromPendingUtteranceIndex;
        const serviceTypes: Array<'NMT' | 'TTS' | 'SEMANTIC_REPAIR'> = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
        for (const serviceType of serviceTypes) {
          sequentialExecutor.cancelTask(
            sessionId,
            pendingUtteranceIndex,
            `Pending utterance text merged into current utterance (${job.utterance_index})`,
            serviceType
          );
        }
        logger.info(
          {
            jobId: job.job_id,
            currentUtteranceIndex: job.utterance_index,
            pendingUtteranceIndex,
            sessionId,
            reason: 'Pending utterance text merged into current, cancelled pending utterance GPU tasks',
          },
          'PostProcessCoordinator: Pending utterance text merged, cancelled pending utterance GPU tasks'
        );
      }
    }

    return { shouldReturn: false };
  }
}
