"use strict";
/**
 * Node Agent Result Sender
 * 处理结果发送相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultSender = void 0;
const ws_1 = __importDefault(require("ws"));
const logger_1 = __importDefault(require("../logger"));
const model_manager_1 = require("../model-manager/model-manager");
class ResultSender {
    constructor(aggregatorMiddleware, dedupStage, postProcessCoordinator // 保留参数以兼容，但不再使用
    ) {
        this.aggregatorMiddleware = aggregatorMiddleware;
        this.ws = null;
        this.nodeId = null;
        this.dedupStage = null; // 用于在成功发送后记录job_id（新架构中不再使用）
        this.dedupStage = dedupStage || null;
    }
    /**
     * 更新连接信息
     */
    updateConnection(ws, nodeId) {
        this.ws = ws;
        this.nodeId = nodeId;
    }
    /**
     * 发送job结果
     */
    sendJobResult(job, finalResult, startTime, shouldSend = true, reason) {
        // 详细检查连接状态
        const wsState = this.ws?.readyState;
        const wsStateName = wsState === ws_1.default.OPEN ? 'OPEN' :
            wsState === ws_1.default.CLOSING ? 'CLOSING' :
                wsState === ws_1.default.CLOSED ? 'CLOSED' :
                    wsState === ws_1.default.CONNECTING ? 'CONNECTING' : 'UNKNOWN';
        if (!this.ws || wsState !== ws_1.default.OPEN || !this.nodeId) {
            logger_1.default.warn({
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
        // 检查是否是"核销"情况：所有结果都归并到其他job
        const isConsolidated = finalResult.extra?.is_consolidated === true;
        const consolidatedToJobIds = finalResult.extra?.consolidated_to_job_ids;
        // 检查是否是"空容器核销"情况：NO_TEXT_ASSIGNED
        const extraReason = finalResult.extra?.reason;
        const isNoTextAssigned = extraReason === 'NO_TEXT_ASSIGNED';
        // 决策：移除空结果保活机制 - 只在有实际结果时发送
        // 例外1：如果是"核销"情况（所有结果都归并到其他job），发送空结果核销当前job
        // 例外2：如果是"空容器核销"情况（NO_TEXT_ASSIGNED），发送空结果核销当前job
        if (isEmpty && !isConsolidated && !isNoTextAssigned) {
            logger_1.default.info({
                jobId: job.job_id,
                traceId: job.trace_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'ASR result is empty, not sending job_result (audio may be cached for streaming merge)',
            }, 'NodeAgent: ASR result is empty, skipping job_result send (will send when actual result is ready)');
            return;
        }
        // 如果是"核销"情况，发送空结果核销当前job
        if (isEmpty && (isConsolidated || isNoTextAssigned)) {
            logger_1.default.info({
                jobId: job.job_id,
                traceId: job.trace_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                consolidatedToJobIds,
                reason: isNoTextAssigned
                    ? 'Empty container detected (NO_TEXT_ASSIGNED), sending empty result to acknowledge job'
                    : 'All ASR results consolidated to other jobs, sending empty result to acknowledge current job',
            }, isNoTextAssigned
                ? 'NodeAgent: Sending empty job_result to acknowledge empty container job (NO_TEXT_ASSIGNED)'
                : 'NodeAgent: Sending empty job_result to acknowledge job (all results consolidated to other jobs)');
            // 继续执行，发送空结果（不记录到去重逻辑，因为这是正常的核销）
        }
        // 如果 JobPipeline 决定不发送（去重检查失败），不发送任何结果
        // 决策：移除空结果保活机制 - 去重过滤的结果也不发送空结果
        if (!shouldSend) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: reason || 'JobPipeline filtered result (duplicate)',
            }, 'NodeAgent: Job filtered by JobPipeline, skipping job_result send');
            return;
        }
        // 有实际ASR结果，正常发送
        logger_1.default.info({
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            textAsr: finalResult.text_asr?.substring(0, 50),
            textAsrLength: finalResult.text_asr?.length || 0,
            textTranslated: finalResult.text_translated?.substring(0, 100),
            textTranslatedLength: finalResult.text_translated?.length || 0,
            ttsAudioLength: finalResult.tts_audio?.length || 0,
        }, 'Job processing completed successfully');
        // 对齐协议规范：job_result 消息格式
        // 关键修复：如果extraReason是NO_TEXT_ASSIGNED，确保extra中包含reason字段
        const extra = finalResult.extra || {};
        if (isNoTextAssigned && !extra.reason) {
            extra.reason = 'NO_TEXT_ASSIGNED';
        }
        const response = {
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
            tts_format: finalResult.tts_format || 'opus', // 强制使用 opus 格式
            extra: extra,
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
            const normalizeText = (text) => {
                return text.replace(/\s+/g, ' ').trim();
            };
            const normalizedCurrent = normalizeText(finalResult.text_asr);
            const normalizedLast = normalizeText(lastSentText);
            if (normalizedCurrent === normalizedLast && normalizedCurrent.length > 0) {
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    text: finalResult.text_asr.substring(0, 50),
                    normalizedText: normalizedCurrent.substring(0, 50),
                }, 'Skipping duplicate job result (same as last sent after normalization)');
                // 修复：即使因为文本重复而不发送，也要记录job_id，确保后续的重复job能被正确过滤
                // 这样可以防止调度服务器重试时导致重复发送
                if (this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
                    this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
                    logger_1.default.debug({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                    }, 'ResultSender: Job_id marked as sent (text duplicate, but recorded for deduplication)');
                }
                return; // 不发送重复的结果
            }
        }
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            responseLength: JSON.stringify(response).length,
            textAsrLength: finalResult.text_asr?.length || 0,
            ttsAudioLength: finalResult.tts_audio?.length || 0,
        }, 'Sending job_result to scheduler');
        this.ws.send(JSON.stringify(response));
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            processingTimeMs: Date.now() - startTime,
        }, 'Job result sent successfully');
        // 更新最后发送的文本（在成功发送后）
        // 使用 AggregatorMiddleware 记录最后发送的文本
        if (finalResult.text_asr && this.aggregatorMiddleware) {
            const textToRecord = finalResult.text_asr.trim();
            this.aggregatorMiddleware.setLastSentText(job.session_id, textToRecord);
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                textLength: textToRecord.length,
                textPreview: textToRecord.substring(0, 50),
                source: 'AggregatorMiddleware',
            }, 'ResultSender: Updated lastSentText via AggregatorMiddleware');
        }
        // 在成功发送后记录job_id，避免发送失败后重试时被误判为重复
        // 决策：移除空结果保活机制
        // - 实际结果（有ASR文本）：记录job_id
        // - 核销空结果（所有结果归并到其他job）：不记录job_id（因为这是正常的核销，不是重复）
        if (!isEmpty && this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
            // 只有实际结果才记录job_id
            this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                textAsrLength: finalResult.text_asr?.length || 0,
            }, 'ResultSender: Job_id marked as sent (actual result)');
        }
        else if (isEmpty && isConsolidated) {
            // 核销空结果不记录job_id（这是正常的核销，不是重复）
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                consolidatedToJobIds,
                reason: 'Empty result sent for consolidation acknowledgment, not marking job_id (normal acknowledgment)',
            }, 'ResultSender: Empty result sent for consolidation, job_id not marked');
        }
    }
    /**
     * 发送错误结果
     */
    sendErrorResult(job, error, startTime) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId) {
            return;
        }
        // 详细记录错误信息，包括错误类型、消息、堆栈等
        const errorDetails = {
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
                }
                else if (error.message.includes('skipped')) {
                    errorDetails.gpuLeaseStatus = 'SKIPPED';
                }
                else if (error.message.includes('fallback')) {
                    errorDetails.gpuLeaseStatus = 'FALLBACK_CPU';
                }
            }
        }
        logger_1.default.error(errorDetails, 'Failed to process job - detailed error information');
        // 检查是否是 ModelNotAvailableError
        if (error instanceof model_manager_1.ModelNotAvailableError) {
            // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
            // 注意：根据新架构，使用 service_id 而不是 model_id
            const errorResponse = {
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
        const errorResponse = {
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
exports.ResultSender = ResultSender;
