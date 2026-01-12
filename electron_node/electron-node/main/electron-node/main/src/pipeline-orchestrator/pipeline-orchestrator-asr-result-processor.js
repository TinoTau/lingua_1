"use strict";
/**
 * Pipeline ASR结果处理模块
 * 负责处理ASR结果、空文本检查、无意义文本检查等逻辑
 *
 * 注意：文本聚合逻辑已移除，现在由 PostProcessCoordinator 的 AggregationStage 统一处理
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOrchestratorASRResultProcessor = void 0;
const text_validator_1 = require("../utils/text-validator");
const logger_1 = __importDefault(require("../logger"));
class PipelineOrchestratorASRResultProcessor {
    constructor() { }
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
        // 注意：文本聚合逻辑已移除，现在由 PostProcessCoordinator 的 AggregationStage 统一处理
        // PipelineOrchestrator 只负责 ASR 任务编排，不做文本聚合
        const textForNMT = asrTextTrimmed;
        const shouldProcessNMT = true;
        logger_1.default.debug({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrText: asrTextTrimmed,
            note: 'Text aggregation is now handled by PostProcessCoordinator.AggregationStage',
        }, 'PipelineOrchestrator: Using original ASR text, aggregation will be handled by PostProcessCoordinator');
        return {
            textForNMT,
            shouldProcessNMT,
            shouldReturnEmpty: false,
        };
    }
}
exports.PipelineOrchestratorASRResultProcessor = PipelineOrchestratorASRResultProcessor;
