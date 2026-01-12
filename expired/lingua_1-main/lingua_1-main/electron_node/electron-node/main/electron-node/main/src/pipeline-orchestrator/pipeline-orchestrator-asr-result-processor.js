"use strict";
/**
 * Pipeline ASR结果处理模块
 * 负责处理ASR结果、空文本检查、无意义文本检查等逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOrchestratorASRResultProcessor = void 0;
const text_validator_1 = require("../utils/text-validator");
const logger_1 = __importDefault(require("../logger"));
class PipelineOrchestratorASRResultProcessor {
    constructor(aggregatorMiddleware) {
        this.aggregatorMiddleware = aggregatorMiddleware;
    }
    /**
     * 处理ASR结果
     */
    processASRResult(job, asrResult) {
        // 检查 ASR 结果是否为空或无意义（防止空文本进入 NMT/TTS）
        const asrTextTrimmed = (asrResult.text || '').trim();
        if ((0, text_validator_1.isEmptyText)(asrTextTrimmed)) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrResult.text,
            }, 'PipelineOrchestrator: ASR result is empty, returning empty result to scheduler (no NMT/TTS)');
            return {
                textForNMT: '',
                shouldProcessNMT: false,
                shouldReturnEmpty: true,
            };
        }
        // 检查是否为无意义文本（如 "The", "A", "An" 等）
        if ((0, text_validator_1.isMeaninglessWord)(asrTextTrimmed)) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrResult.text,
            }, 'PipelineOrchestrator: ASR result is meaningless word, returning empty result to scheduler (no NMT/TTS)');
            return {
                textForNMT: asrResult.text,
                shouldProcessNMT: false,
                shouldReturnEmpty: true,
            };
        }
        // AggregatorMiddleware: 在 ASR 之后、NMT 之前进行文本聚合
        let textForNMT = asrTextTrimmed;
        let shouldProcessNMT = true;
        let aggregationResult = undefined;
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
                logger_1.default.info({
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
                }, 'PipelineOrchestrator: Text aggregated after ASR, ready for NMT');
            }
            else {
                // Aggregator 决定不处理（可能是重复文本）
                shouldProcessNMT = false;
                aggregationResult = {
                    action: middlewareResult.action,
                };
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    originalASRText: asrTextTrimmed,
                    originalASRTextLength: asrTextTrimmed.length,
                    aggregatedText: middlewareResult.aggregatedText,
                    reason: 'Aggregator filtered duplicate text',
                    action: middlewareResult.action,
                }, 'PipelineOrchestrator: Aggregator filtered text, returning empty result to scheduler (no NMT/TTS)');
            }
        }
        else {
            // 没有 AggregatorMiddleware，使用原始 ASR 文本
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrTextTrimmed,
                note: 'No AggregatorMiddleware, using original ASR text for NMT',
            }, 'PipelineOrchestrator: Using original ASR text for NMT');
        }
        if (!shouldProcessNMT) {
            // Aggregator 决定不处理，返回空结果
            textForNMT = '';
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrTextTrimmed,
                aggregatedText: textForNMT,
                reason: 'Aggregator filtered duplicate text, returning empty result to scheduler (no NMT/TTS)',
            }, 'PipelineOrchestrator: Aggregator filtered duplicate text, returning empty result (no NMT/TTS)');
        }
        else {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrTextTrimmed,
                aggregatedText: textForNMT,
            }, 'PipelineOrchestrator: Passing aggregated text to PostProcess for NMT/TTS');
        }
        return {
            textForNMT,
            shouldProcessNMT,
            shouldReturnEmpty: !shouldProcessNMT,
            aggregationResult,
        };
    }
}
exports.PipelineOrchestratorASRResultProcessor = PipelineOrchestratorASRResultProcessor;
