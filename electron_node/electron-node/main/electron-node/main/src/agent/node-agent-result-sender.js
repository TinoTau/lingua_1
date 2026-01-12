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
    constructor(aggregatorMiddleware, dedupStage, postProcessCoordinator) {
        this.aggregatorMiddleware = aggregatorMiddleware;
        this.ws = null;
        this.nodeId = null;
        this.dedupStage = null; // 用于在成功发送后记录job_id
        this.postProcessCoordinator = null; // 用于获取DeduplicationHandler
        this.dedupStage = dedupStage || null;
        this.postProcessCoordinator = postProcessCoordinator || null;
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
        if (isEmpty) {
            // 修复：即使ASR结果为空，也发送job_result（空结果）给调度服务器
            logger_1.default.info({
                jobId: job.job_id,
                traceId: job.trace_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'ASR result is empty, but sending empty job_result to scheduler to prevent timeout',
            }, 'NodeAgent: ASR result is empty, sending empty job_result to scheduler to prevent timeout');
        }
        else {
            logger_1.default.info({
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                textAsr: finalResult.text_asr?.substring(0, 50),
                textAsrLength: finalResult.text_asr?.length || 0,
                textTranslated: finalResult.text_translated?.substring(0, 100),
                textTranslatedLength: finalResult.text_translated?.length || 0,
                ttsAudioLength: finalResult.tts_audio?.length || 0,
            }, 'Job processing completed successfully');
        }
        // 如果PostProcessCoordinator决定不发送，发送空结果
        if (!shouldSend) {
            const emptyResponse = {
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
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
            }, 'Empty job_result sent to scheduler (filtered by PostProcessCoordinator) to prevent timeout');
            return;
        }
        // 对齐协议规范：job_result 消息格式
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
        // 优先使用PostProcessCoordinator的DeduplicationHandler，否则使用AggregatorMiddleware
        if (finalResult.text_asr) {
            const textToRecord = finalResult.text_asr.trim();
            if (this.postProcessCoordinator) {
                this.postProcessCoordinator.setLastSentText(job.session_id, textToRecord);
                logger_1.default.debug({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    textLength: textToRecord.length,
                    textPreview: textToRecord.substring(0, 50),
                    source: 'PostProcessCoordinator.DeduplicationHandler',
                }, 'ResultSender: Updated lastSentText via PostProcessCoordinator');
            }
            else if (this.aggregatorMiddleware) {
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
        }
        // 在成功发送后记录job_id，避免发送失败后重试时被误判为重复
        if (this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
            this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
        }
    }
    /**
     * 发送错误结果
     */
    sendErrorResult(job, error, startTime) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId) {
            return;
        }
        logger_1.default.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Failed to process job');
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
