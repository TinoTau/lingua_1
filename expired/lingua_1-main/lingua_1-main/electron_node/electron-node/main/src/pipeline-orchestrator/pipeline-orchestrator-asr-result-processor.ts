/**
 * Pipeline ASR结果处理模块
 * 负责处理ASR结果、空文本检查、无意义文本检查等逻辑
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult } from '../task-router/types';
import { AggregatorMiddleware } from '../agent/aggregator-middleware';
import { isMeaninglessWord, isEmptyText } from '../utils/text-validator';
import logger from '../logger';

export interface ASRResultProcessorResult {
  textForNMT: string;
  shouldProcessNMT: boolean;
  shouldReturnEmpty: boolean;
  aggregationResult?: {
    action?: string;
    metrics?: {
      dedupCharsRemoved?: number;
    };
  };
}

export class PipelineOrchestratorASRResultProcessor {
  constructor(private aggregatorMiddleware: AggregatorMiddleware | null) {}

  /**
   * 处理ASR结果
   */
  processASRResult(
    job: JobAssignMessage,
    asrResult: ASRResult
  ): ASRResultProcessorResult {
    // 检查 ASR 结果是否为空或无意义（防止空文本进入 NMT/TTS）
    const asrTextTrimmed = (asrResult.text || '').trim();
    if (isEmptyText(asrTextTrimmed)) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          asrText: asrResult.text,
        },
        'PipelineOrchestrator: ASR result is empty, returning empty result to scheduler (no NMT/TTS)'
      );
      return {
        textForNMT: '',
        shouldProcessNMT: false,
        shouldReturnEmpty: true,
      };
    }

    // 检查是否为无意义文本（如 "The", "A", "An" 等）
    if (isMeaninglessWord(asrTextTrimmed)) {
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
        textForNMT: asrResult.text,
        shouldProcessNMT: false,
        shouldReturnEmpty: true,
      };
    }

    // AggregatorMiddleware: 在 ASR 之后、NMT 之前进行文本聚合
    let textForNMT = asrTextTrimmed;
    let shouldProcessNMT = true;
    let aggregationResult: any = undefined;
    
    if (this.aggregatorMiddleware) {
      const middlewareResult = this.aggregatorMiddleware.processASRResult(job, {
        text: asrTextTrimmed,
        segments: asrResult.segments,
        language_probability: asrResult.language_probability,
        language_probabilities: asrResult.language_probabilities,
        badSegmentDetection: asrResult.badSegmentDetection,
      });
      
      if (middlewareResult.shouldProcess) {
        textForNMT = middlewareResult.aggregatedText;
        shouldProcessNMT = true;
        aggregationResult = {
          action: middlewareResult.action,
          metrics: middlewareResult.metrics,
        };
        
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
            action: middlewareResult.action,
            dedupCharsRemoved: middlewareResult.metrics?.dedupCharsRemoved || 0,
            textChanged: textForNMT !== asrTextTrimmed,
          },
          'PipelineOrchestrator: Text aggregated after ASR, ready for NMT'
        );
      } else {
        // Aggregator 决定不处理（可能是重复文本）
        shouldProcessNMT = false;
        aggregationResult = {
          action: middlewareResult.action,
        };
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            originalASRText: asrTextTrimmed,
            originalASRTextLength: asrTextTrimmed.length,
            aggregatedText: middlewareResult.aggregatedText,
            reason: 'Aggregator filtered duplicate text',
            action: middlewareResult.action,
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

    if (!shouldProcessNMT) {
      // Aggregator 决定不处理，返回空结果
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

    return {
      textForNMT,
      shouldProcessNMT,
      shouldReturnEmpty: !shouldProcessNMT,
      aggregationResult,
    };
  }
}
