/**
 * Node Agent Result Sender
 * 处理结果发送相关的逻辑。
 */

import WebSocket from 'ws';
import logger from '../logger';
import { JobAssignMessage, JobResultMessage } from '../../../../shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { AggregatorMiddleware } from './aggregator-middleware';
import { DeduplicationHandler } from './aggregator-middleware-deduplication';

export class ResultSender {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private dedupStage: any = null;  // 用于在成功发送后记录job_id（新架构中不再使用）
  /** 实际发送 job_result 的递增序号，用于 DUP_SEND 定位 */
  private sendSeq = 0;

  constructor(
    private aggregatorMiddleware: AggregatorMiddleware,
    dedupStage?: any,
    postProcessCoordinator?: any  // 保留参数以兼容，但不再使用
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

    const asrTextTrimmed = (finalResult.text_asr || '').trim();
    const isEmpty = asrTextTrimmed.length === 0;
    const extraReason = (finalResult.extra as any)?.reason;
    const isNoTextAssigned = extraReason === 'NO_TEXT_ASSIGNED';

    // 检查是否是音频被缓冲的情况（不应该发送任何结果）
    const isAudioBuffered = (finalResult.extra as any)?.audioBuffered === true;
    if (isAudioBuffered) {
      logger.info(
        {
          jobId: job.job_id,
          traceId: job.trace_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: 'Audio buffered, not sending job_result (will send when actual result is ready)',
        },
        'NodeAgent: Audio buffered, skipping job_result send (will send when actual result is ready)'
      );
      return;
    }

    if (isEmpty) {
      if (!isNoTextAssigned) {
        if (!(finalResult.extra as any)) (finalResult.extra as any) = {};
        (finalResult.extra as any).reason = 'ASR_EMPTY';
      }
    }

    // 如果 JobPipeline 决定不发送（去重检查失败），不发送任何结果
    // 决策：移除空结果保活机制 - 去重过滤的结果也不发送空结果
    if (!shouldSend) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: reason || 'JobPipeline filtered result (duplicate)',
        },
        'NodeAgent: Job filtered by JobPipeline, skipping job_result send'
      );
      return;
    }

    // 有实际ASR结果，正常发送
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

    // 构建并发送（发送顺序 = handleJob 完成顺序 = job_assign 接收顺序）
    const extra = finalResult.extra || {};
    if (isNoTextAssigned && !extra.reason) {
      extra.reason = 'NO_TEXT_ASSIGNED';
    }
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
      tts_format: finalResult.tts_format || 'opus',
      extra,
      processing_time_ms: Date.now() - startTime,
      trace_id: job.trace_id,
      asr_quality_level: finalResult.asr_quality_level,
      reason_codes: finalResult.reason_codes,
      quality_score: finalResult.quality_score,
      rerun_count: finalResult.rerun_count,
      segments_meta: finalResult.segments_meta,
    };

    this.sendSeq += 1;
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        responseLength: JSON.stringify(response).length,
        sendSeq: this.sendSeq,
        reason: reason ?? 'ok',
        isEmptyJob: isEmpty,
        shouldSend,
      },
      'Sending job_result to scheduler'
    );

    let sendSuccess = false;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(response));
        sendSuccess = true;
        logger.info(
          { jobId: job.job_id, sessionId: job.session_id, utteranceIndex: job.utterance_index, processingTimeMs: Date.now() - startTime },
          'Job result sent successfully'
        );
      } else {
        logger.error(
          { jobId: job.job_id, sessionId: job.session_id, utteranceIndex: job.utterance_index, wsState: this.ws?.readyState },
          'ResultSender: Failed to send job result - WebSocket not open'
        );
      }
    } catch (error: any) {
      logger.error(
        { jobId: job.job_id, sessionId: job.session_id, utteranceIndex: job.utterance_index, error: error?.message || error },
        'ResultSender: Exception while sending job result'
      );
    }

    if (sendSuccess && finalResult.text_asr && this.aggregatorMiddleware) {
      this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());
    }
    if (!isEmpty && this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
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

    // 详细记录错误信息，包括错误类型、消息、堆栈等
    const errorDetails: any = {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      traceId: job.trace_id,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorStack: error instanceof Error ? error.stack : undefined,
    };

    // 检查是否是 GPU lease 相关错误
    if (error instanceof Error) {
      if (error.message.includes('GPU lease')) {
        errorDetails.errorType = 'GPU_LEASE_ERROR';
        if (error.message.includes('timeout')) {
          errorDetails.gpuLeaseStatus = 'TIMEOUT';
        } else if (error.message.includes('skipped')) {
          errorDetails.gpuLeaseStatus = 'SKIPPED';
        } else if (error.message.includes('fallback')) {
          errorDetails.gpuLeaseStatus = 'FALLBACK_CPU';
        }
      }
    }

    logger.error(errorDetails, 'Failed to process job - detailed error information');

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

    // 其他错误：统一 PROCESSING_ERROR，message 即抛错内容（语义修复等已含 SEM_REPAIR_* 前缀，调度可按需解析）
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
      trace_id: job.trace_id,
    };

    this.ws.send(JSON.stringify(errorResponse));
  }
}
