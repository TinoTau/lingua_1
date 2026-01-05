"use strict";
// 流水线编排器 - 协调多个服务完成完整流程
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOrchestrator = void 0;
const logger_1 = __importDefault(require("../logger"));
const session_context_manager_1 = require("./session-context-manager");
const audio_aggregator_1 = require("./audio-aggregator");
const pipeline_orchestrator_asr_1 = require("./pipeline-orchestrator-asr");
const gpu_arbiter_1 = require("../gpu-arbiter");
const pipeline_orchestrator_audio_processor_1 = require("./pipeline-orchestrator-audio-processor");
const pipeline_orchestrator_asr_result_processor_1 = require("./pipeline-orchestrator-asr-result-processor");
const pipeline_orchestrator_result_builder_1 = require("./pipeline-orchestrator-result-builder");
class PipelineOrchestrator {
    constructor(taskRouter, aggregatorManager, mode = 'offline', aggregatorMiddleware) {
        this.taskRouter = taskRouter;
        this.aggregatorManager = null;
        this.aggregatorMiddleware = null;
        // Gate-A: 初始化 Session Context Manager
        this.sessionContextManager = new session_context_manager_1.SessionContextManager();
        this.sessionContextManager.setTaskRouter(taskRouter);
        // S1: 初始化 AggregatorManager（用于ASR handler）
        this.aggregatorManager = aggregatorManager || null;
        // 初始化 ASR Handler
        this.asrHandler = new pipeline_orchestrator_asr_1.PipelineOrchestratorASRHandler(taskRouter, aggregatorManager);
        // 设置 AggregatorMiddleware（用于在 ASR 之后、NMT 之前进行文本聚合）
        this.aggregatorMiddleware = aggregatorMiddleware || null;
        if (this.aggregatorMiddleware) {
            logger_1.default.info({}, 'PipelineOrchestrator: AggregatorMiddleware initialized for pre-NMT aggregation');
        }
        // 初始化音频聚合器（用于在ASR之前聚合音频）
        this.audioAggregator = new audio_aggregator_1.AudioAggregator();
        logger_1.default.info({}, 'PipelineOrchestrator: AudioAggregator initialized for pre-ASR audio aggregation');
        // 初始化模块化处理器
        this.audioProcessor = new pipeline_orchestrator_audio_processor_1.PipelineOrchestratorAudioProcessor(this.audioAggregator);
        this.asrResultProcessor = new pipeline_orchestrator_asr_result_processor_1.PipelineOrchestratorASRResultProcessor(this.aggregatorMiddleware);
        this.resultBuilder = new pipeline_orchestrator_result_builder_1.PipelineOrchestratorResultBuilder();
    }
    /**
     * Gate-B: 获取 TaskRouter 实例（用于获取 Rerun 指标）
     */
    getTaskRouter() {
        return this.taskRouter;
    }
    /**
     * 处理完整任务（ASR -> NMT -> TTS）
     * @param asrCompletedCallback ASR 完成时的回调，用于释放 ASR 服务容量
     */
    async processJob(job, partialCallback, asrCompletedCallback) {
        const startTime = Date.now();
        try {
            // 1. ASR 任务
            logger_1.default.debug({ jobId: job.job_id }, 'Starting ASR task');
            // S1: 构建prompt（如果启用）
            const contextText = this.asrHandler.buildPrompt(job) || job.context_text;
            // 处理音频：聚合和格式转换
            const audioProcessResult = await this.audioProcessor.processAudio(job);
            if (audioProcessResult?.shouldReturnEmpty) {
                return this.resultBuilder.buildEmptyResult();
            }
            if (!audioProcessResult) {
                throw new Error('Failed to process audio');
            }
            const audioForASR = audioProcessResult.audioForASR;
            const audioFormatForASR = audioProcessResult.audioFormatForASR;
            const asrTask = {
                audio: audioForASR,
                audio_format: audioFormatForASR,
                sample_rate: job.sample_rate || 16000,
                src_lang: job.src_lang,
                enable_streaming: job.enable_streaming_asr || false,
                context_text: contextText, // S1: 使用构建的prompt或原始context_text
                job_id: job.job_id, // 传递 job_id 用于任务取消
                utterance_index: job.utterance_index, // 传递 utterance_index 用于日志和调试
                // EDGE-4: Padding 配置（从 job 中提取，如果调度服务器传递了该参数）
                padding_ms: job.padding_ms,
                // P0.5-SH-4: 传递重跑次数（从 job 中提取，如果调度服务器传递了该参数）
                rerun_count: job.rerun_count || 0,
            }; // 添加session_id用于日志
            asrTask.session_id = job.session_id;
            let asrResult;
            if (job.enable_streaming_asr && partialCallback) {
                // 流式 ASR 处理
                asrResult = await this.asrHandler.processASRStreaming(asrTask, partialCallback);
            }
            else {
                // GPU仲裁：获取GPU租约
                asrResult = await (0, gpu_arbiter_1.withGpuLease)('ASR', async () => {
                    return await this.taskRouter.routeASRTask(asrTask);
                }, {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    stage: 'ASR',
                });
            }
            // 记录 ASR 所有生成结果
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                asrText: asrResult.text,
                asrTextLength: asrResult.text?.length || 0,
                segmentsCount: asrResult.segments?.length || 0,
                qualityScore: asrResult.badSegmentDetection?.qualityScore,
                languageProbability: asrResult.language_probability,
            }, 'PipelineOrchestrator: ASR result received');
            // Gate-A: 检查是否需要重置上下文
            if (asrResult.shouldResetContext) {
                const sessionId = job.session_id || job.job_id || 'unknown';
                const resetRequest = {
                    sessionId,
                    reason: 'consecutive_low_quality',
                    jobId: job.job_id,
                };
                logger_1.default.info({
                    sessionId,
                    jobId: job.job_id,
                    qualityScore: asrResult.badSegmentDetection?.qualityScore,
                }, 'Gate-A: Detected shouldResetContext flag, triggering context reset');
                // 执行上下文重置（异步，不阻塞主流程）
                this.sessionContextManager.resetContext(resetRequest, this.taskRouter)
                    .then((resetResult) => {
                    logger_1.default.info({
                        sessionId,
                        jobId: job.job_id,
                        resetResult,
                    }, 'Gate-A: Context reset completed');
                })
                    .catch((error) => {
                    logger_1.default.error({
                        sessionId,
                        jobId: job.job_id,
                        error: error.message,
                    }, 'Gate-A: Context reset failed');
                });
            }
            // ASR 完成后，立即通知 InferenceService 从 currentJobs 中移除任务
            // 这样可以让 ASR 服务更快地处理下一个任务，避免任务堆积
            if (asrCompletedCallback) {
                asrCompletedCallback(true);
            }
            // 处理ASR结果：空文本检查、无意义文本检查、文本聚合
            const asrResultProcessResult = this.asrResultProcessor.processASRResult(job, asrResult);
            if (asrResultProcessResult.shouldReturnEmpty) {
                if (asrResultProcessResult.textForNMT) {
                    // 无意义文本
                    return this.resultBuilder.buildMeaninglessTextResult(asrResultProcessResult.textForNMT, asrResult);
                }
                else {
                    // 空文本
                    return this.resultBuilder.buildEmptyResult(asrResult);
                }
            }
            const textForNMT = asrResultProcessResult.textForNMT;
            // 构建结果
            const result = this.resultBuilder.buildResult(textForNMT, asrResult, asrTask.rerun_count);
            const processingTime = Date.now() - startTime;
            logger_1.default.info({ jobId: job.job_id, processingTime }, 'Pipeline orchestration completed');
            return result;
        }
        catch (error) {
            logger_1.default.error({ error, jobId: job.job_id }, 'Pipeline orchestration failed');
            throw error;
        }
    }
    /**
     * 处理仅 ASR 任务
     */
    async processASROnly(job) {
        return await this.asrHandler.processASROnly(job);
    }
}
exports.PipelineOrchestrator = PipelineOrchestrator;
