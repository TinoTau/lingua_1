/**
 * Node Agent Result Sender
 * 处理结果发送相关的逻辑
 */

import WebSocket from 'ws';
import logger from '../logger';
import { JobAssignMessage, JobResultMessage } from '../../../../shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { AggregatorMiddleware } from './aggregator-middleware';

export class ResultSender {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private dedupStage: any = null;  // 用于在成功发送后记录job_id

  constructor(
    private aggregatorMiddleware: AggregatorMiddleware,
    dedupStage?: any
  ) {
    this.dedupStage = dedupStage || null;
  }

  /**
   * 更新连接信息
   */
  updateConnection(ws: WebSocket | null, nodeId: string | null): void {
    this.ws = ws;
    this.nodeId = nodeId;
  }

  /**
   * 发送job结果
   */
  sendJobResult(
    job: JobAssignMessage,
    finalResult: JobResult,
    startTime: number,
    shouldSend: boolean = true,
    reason?: string
  ): void {
    // 详细检查连接状态
    const wsState = this.ws?.readyState;
    const wsStateName = wsState === WebSocket.OPEN ? 'OPEN' : 
                        wsState === WebSocket.CLOSING ? 'CLOSING' : 
                        wsState === WebSocket.CLOSED ? 'CLOSED' : 
                        wsState === WebSocket.CONNECTING ? 'CONNECTING' : 'UNKNOWN';
    
    if (!this.ws || wsState !== WebSocket.OPEN || !this.nodeId) {
      logger.warn({ 
        jobId: job.job_id, 
        traceId: job.trace_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        wsState, 
        wsStateName,
        nodeId: this.nodeId,
        hasWs: !!this.ws,
        note: 'Cannot send result: WebSocket not ready. Connection may have been closed during job processing.'
      }, 'Cannot send result: WebSocket not ready');
      return;
    }

    // 检查ASR结果是否为空
    const asrTextTrimmed = (finalResult.text_asr || '').trim();
    const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;

    if (isEmpty) {
      // 修复：即使ASR结果为空，也发送job_result（空结果）给调度服务器
      logger.info(
        { 
          jobId: job.job_id, 
          traceId: job.trace_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: 'ASR result is empty, but sending empty job_result to scheduler to prevent timeout',
        },
        'NodeAgent: ASR result is empty, sending empty job_result to scheduler to prevent timeout'
      );
    } else {
      logger.info(
        {
          jobId: job.job_id,
          utteranceIndex: job.utterance_index,
          textAsr: finalResult.text_asr?.substring(0, 50),
          textAsrLength: finalResult.text_asr?.length || 0,
          textTranslated: finalResult.text_translated?.substring(0, 100),
          textTranslatedLength: finalResult.text_translated?.length || 0,
          ttsAudioLength: finalResult.tts_audio?.length || 0,
        },
        'Job processing completed successfully'
      );
    }

    // 如果PostProcessCoordinator决定不发送，发送空结果
    if (!shouldSend) {
      const emptyResponse: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        attempt_id: job.attempt_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: true,
        text_asr: '',
        text_translated: '',
        tts_audio: '',
        tts_format: 'opus',
        processing_time_ms: Date.now() - startTime,
        trace_id: job.trace_id,
        extra: {
          filtered: true,
          reason: reason || 'PostProcessCoordinator filtered result',
        },
      };
      
      this.ws.send(JSON.stringify(emptyResponse));
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
        },
        'Empty job_result sent to scheduler (filtered by PostProcessCoordinator) to prevent timeout'
      );
      return;
    }

    // 对齐协议规范：job_result 消息格式
    const response: JobResultMessage = {
      type: 'job_result',
      job_id: job.job_id,
      attempt_id: job.attempt_id,
      node_id: this.nodeId,
      session_id: job.session_id,
      utterance_index: job.utterance_index,
      success: true,
      text_asr: finalResult.text_asr,
      text_translated: finalResult.text_translated,
      tts_audio: finalResult.tts_audio,
      tts_format: finalResult.tts_format || 'opus',  // 强制使用 opus 格式
      extra: finalResult.extra,
      processing_time_ms: Date.now() - startTime,
      trace_id: job.trace_id, // Added: propagate trace_id
      // OBS-2: 透传 ASR 质量信息
      asr_quality_level: finalResult.asr_quality_level,
      reason_codes: finalResult.reason_codes,
      quality_score: finalResult.quality_score,
      rerun_count: finalResult.rerun_count,
      segments_meta: finalResult.segments_meta,
    };

    // 检查是否与上次发送的文本完全相同（防止重复发送）
    // 优化：使用更严格的文本比较
    const lastSentText = this.aggregatorMiddleware.getLastSentText(job.session_id);
    if (lastSentText && finalResult.text_asr) {
      const normalizeText = (text: string): string => {
        return text.replace(/\s+/g, ' ').trim();
      };

      const normalizedCurrent = normalizeText(finalResult.text_asr);
      const normalizedLast = normalizeText(lastSentText);

      if (normalizedCurrent === normalizedLast && normalizedCurrent.length > 0) {
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            text: finalResult.text_asr.substring(0, 50),
            normalizedText: normalizedCurrent.substring(0, 50),
          },
          'Skipping duplicate job result (same as last sent after normalization)'
        );
        
        // 修复：即使因为文本重复而不发送，也要记录job_id，确保后续的重复job能被正确过滤
        // 这样可以防止调度服务器重试时导致重复发送
        if (this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
          this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
          logger.debug(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
            },
            'ResultSender: Job_id marked as sent (text duplicate, but recorded for deduplication)'
          );
        }
        
        return;  // 不发送重复的结果
      }
    }

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        responseLength: JSON.stringify(response).length,
        textAsrLength: finalResult.text_asr?.length || 0,
        ttsAudioLength: finalResult.tts_audio?.length || 0,
      },
      'Sending job_result to scheduler'
    );
    this.ws.send(JSON.stringify(response));
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        processingTimeMs: Date.now() - startTime,
      },
      'Job result sent successfully'
    );

    // 更新最后发送的文本（在成功发送后）
    if (finalResult.text_asr) {
      this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());
    }
    
    // 在成功发送后记录job_id，避免发送失败后重试时被误判为重复
    if (this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
      this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
    }
  }

  /**
   * 发送错误结果
   */
  sendErrorResult(
    job: JobAssignMessage,
    error: any,
    startTime: number
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) {
      return;
    }

    logger.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Failed to process job');

    // 检查是否是 ModelNotAvailableError
    if (error instanceof ModelNotAvailableError) {
      // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
      // 注意：根据新架构，使用 service_id 而不是 model_id
      const errorResponse: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        attempt_id: job.attempt_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: false,
        processing_time_ms: Date.now() - startTime,
        error: {
          code: 'MODEL_NOT_AVAILABLE',
          message: `Service ${error.modelId}@${error.version} is not available: ${error.reason}`,
          details: {
            service_id: error.modelId,
            service_version: error.version,
            reason: error.reason,
          },
        },
        trace_id: job.trace_id, // Added: propagate trace_id
      };

      this.ws.send(JSON.stringify(errorResponse));
      return;
    }

    // 其他错误
    const errorResponse: JobResultMessage = {
      type: 'job_result',
      job_id: job.job_id,
      attempt_id: job.attempt_id,
      node_id: this.nodeId,
      session_id: job.session_id,
      utterance_index: job.utterance_index,
      success: false,
      processing_time_ms: Date.now() - startTime,
      error: {
        code: 'PROCESSING_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      trace_id: job.trace_id, // Added: propagate trace_id
    };

    this.ws.send(JSON.stringify(errorResponse));
  }
}
