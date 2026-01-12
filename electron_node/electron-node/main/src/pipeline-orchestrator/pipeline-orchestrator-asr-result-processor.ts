/**
 * Pipeline ASR结果处理模块
 * 负责处理ASR结果、空文本检查、无意义文本检查等逻辑
 * 
 * 注意：文本聚合逻辑已移除，现在由 PostProcessCoordinator 的 AggregationStage 统一处理
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult } from '../task-router/types';
import { isMeaninglessWord, isEmptyText } from '../utils/text-validator';
import logger from '../logger';

export interface ASRResultProcessorResult {
  textForNMT: string;
  shouldProcessNMT: boolean;
  shouldReturnEmpty: boolean;
}

export class PipelineOrchestratorASRResultProcessor {
  constructor() {}

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

    // 注意：文本聚合逻辑已移除，现在由 PostProcessCoordinator 的 AggregationStage 统一处理
    // PipelineOrchestrator 只负责 ASR 任务编排，不做文本聚合
    const textForNMT = asrTextTrimmed;
    const shouldProcessNMT = true;

    logger.debug(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        asrText: asrTextTrimmed,
        note: 'Text aggregation is now handled by PostProcessCoordinator.AggregationStage',
      },
      'PipelineOrchestrator: Using original ASR text, aggregation will be handled by PostProcessCoordinator'
    );

    return {
      textForNMT,
      shouldProcessNMT,
      shouldReturnEmpty: false,
    };
  }
}
