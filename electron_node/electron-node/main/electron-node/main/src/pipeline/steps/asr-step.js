"use strict";
/**
 * runAsrStep - ASR 步骤
 * 处理音频聚合、ASR识别、Gate-A上下文重置
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAsrStep = runAsrStep;
const audio_aggregator_1 = require("../../pipeline-orchestrator/audio-aggregator");
const pipeline_orchestrator_audio_processor_1 = require("../../pipeline-orchestrator/pipeline-orchestrator-audio-processor");
const pipeline_orchestrator_asr_result_processor_1 = require("../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor");
const pipeline_orchestrator_asr_1 = require("../../pipeline-orchestrator/pipeline-orchestrator-asr");
const gpu_arbiter_1 = require("../../gpu-arbiter");
const logger_1 = __importDefault(require("../../logger"));
async function runAsrStep(job, ctx, services, options) {
    // 初始化音频聚合器和处理器
    const audioAggregator = new audio_aggregator_1.AudioAggregator();
    const audioProcessor = new pipeline_orchestrator_audio_processor_1.PipelineOrchestratorAudioProcessor(audioAggregator);
    const asrResultProcessor = new pipeline_orchestrator_asr_result_processor_1.PipelineOrchestratorASRResultProcessor();
    const asrHandler = new pipeline_orchestrator_asr_1.PipelineOrchestratorASRHandler(services.taskRouter, services.aggregatorManager);
    // 构建 prompt（如果启用）
    const contextText = asrHandler.buildPrompt(job) || job.context_text;
    // 处理音频：聚合和格式转换
    const audioProcessResult = await audioProcessor.processAudio(job);
    if (audioProcessResult?.shouldReturnEmpty) {
        logger_1.default.info({ jobId: job.job_id, sessionId: job.session_id }, 'runAsrStep: Audio buffered, returning empty');
        return;
    }
    if (!audioProcessResult) {
        throw new Error('Failed to process audio');
    }
    const audioForASR = audioProcessResult.audioForASR;
    const audioFormatForASR = audioProcessResult.audioFormatForASR;
    // 构建 ASR 任务
    const asrTask = {
        audio: audioForASR,
        audio_format: audioFormatForASR,
        sample_rate: job.sample_rate || 16000,
        src_lang: job.src_lang,
        enable_streaming: job.enable_streaming_asr || false,
        context_text: contextText,
        job_id: job.job_id,
        utterance_index: job.utterance_index,
        padding_ms: job.padding_ms,
        rerun_count: job.rerun_count || 0,
    };
    asrTask.session_id = job.session_id;
    // 调用 ASR 服务
    let asrResult;
    if (job.enable_streaming_asr && options?.partialCallback) {
        // 流式 ASR
        asrResult = await asrHandler.processASRStreaming(asrTask, options.partialCallback);
    }
    else {
        // 非流式 ASR（使用 GPU 租约）
        asrResult = await (0, gpu_arbiter_1.withGpuLease)('ASR', async () => {
            return await services.taskRouter.routeASRTask(asrTask);
        }, {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            stage: 'ASR',
        });
    }
    // 更新 JobContext
    ctx.asrText = asrResult.text;
    ctx.asrResult = asrResult;
    ctx.asrSegments = asrResult.segments;
    ctx.languageProbabilities = asrResult.language_probabilities;
    ctx.qualityScore = asrResult.badSegmentDetection?.qualityScore;
    ctx.rerunCount = job.rerun_count || 0;
    logger_1.default.info({
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        asrTextLength: ctx.asrText?.length || 0,
        qualityScore: ctx.qualityScore,
    }, 'runAsrStep: ASR completed');
    // Gate-A: 检查是否需要重置上下文
    if (asrResult.shouldResetContext && services.sessionContextManager) {
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
        // 异步重置上下文（不阻塞主流程）
        services.sessionContextManager
            .resetContext(resetRequest, services.taskRouter)
            .then((resetResult) => {
            logger_1.default.info({ sessionId, jobId: job.job_id, resetResult }, 'Gate-A: Context reset completed');
        })
            .catch((error) => {
            logger_1.default.error({ sessionId, jobId: job.job_id, error: error.message }, 'Gate-A: Context reset failed');
        });
    }
    // 处理 ASR 结果：空文本检查、无意义文本检查
    const asrResultProcessResult = asrResultProcessor.processASRResult(job, asrResult);
    if (asrResultProcessResult.shouldReturnEmpty) {
        logger_1.default.info({ jobId: job.job_id }, 'runAsrStep: ASR result is empty or meaningless, skipping further processing');
        // 保持 ctx.asrText 为空，后续步骤会跳过
    }
    // ASR 完成回调
    options?.asrCompletedCallback?.(true);
}
