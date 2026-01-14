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
    // 将解码后的 PCM16 音频存储到 JobContext（供后续步骤使用，如 Embedding）
    // audioForASR 是 base64 编码的 PCM16 字符串
    ctx.audio = Buffer.from(audioForASR, 'base64');
    ctx.audioFormat = 'pcm16';
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
    const asrStartTime = Date.now();
    try {
        if (job.enable_streaming_asr && options?.partialCallback) {
            // 流式 ASR
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                stage: 'ASR',
                mode: 'streaming',
            }, 'runAsrStep: Starting streaming ASR');
            asrResult = await asrHandler.processASRStreaming(asrTask, options.partialCallback);
        }
        else {
            // 非流式 ASR（使用 GPU 租约）
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                stage: 'ASR',
                mode: 'non-streaming',
                audioLength: audioForASR.length,
                audioFormat: audioFormatForASR,
            }, 'runAsrStep: Starting non-streaming ASR with GPU lease');
            asrResult = await (0, gpu_arbiter_1.withGpuLease)('ASR', async () => {
                return await services.taskRouter.routeASRTask(asrTask);
            }, {
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                stage: 'ASR',
            });
        }
        const asrDuration = Date.now() - asrStartTime;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            stage: 'ASR',
            durationMs: asrDuration,
            asrTextLength: asrResult.text?.length || 0,
            asrTextPreview: asrResult.text?.substring(0, 50),
            segmentCount: asrResult.segments?.length || 0,
            qualityScore: asrResult.badSegmentDetection?.qualityScore,
        }, 'runAsrStep: ASR completed successfully');
    }
    catch (error) {
        const asrDuration = Date.now() - asrStartTime;
        logger_1.default.error({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            stage: 'ASR',
            durationMs: asrDuration,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : typeof error,
            isGpuLeaseError: error instanceof Error && error.message.includes('GPU lease'),
        }, 'runAsrStep: ASR failed');
        throw error;
    }
    // 更新 JobContext
    ctx.asrText = asrResult.text;
    ctx.asrResult = asrResult;
    ctx.asrSegments = asrResult.segments;
    ctx.languageProbabilities = asrResult.language_probabilities;
    ctx.qualityScore = asrResult.badSegmentDetection?.qualityScore;
    ctx.rerunCount = job.rerun_count || 0;
    // 双向模式：根据检测到的语言自动确定目标语言
    // 只使用 lang_a 和 lang_b，不考虑回退
    if (job.lang_a && job.lang_b) {
        const detectedLang = determineDetectedLanguage(asrResult.language_probabilities, job.lang_a, job.lang_b);
        if (detectedLang) {
            // 存储检测到的源语言
            ctx.detectedSourceLang = detectedLang;
            // 如果检测到的是 lang_a，则目标语言是 lang_b；反之亦然
            ctx.detectedTargetLang = detectedLang === job.lang_a ? job.lang_b : job.lang_a;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                detectedLang,
                sourceLang: ctx.detectedSourceLang,
                targetLang: ctx.detectedTargetLang,
                langA: job.lang_a,
                langB: job.lang_b,
            }, 'runAsrStep: Two-way mode - determined source and target language from detected language');
        }
        else {
            // 如果无法确定检测到的语言，使用默认值
            // 默认源语言为 lang_a，目标语言为 lang_b
            ctx.detectedSourceLang = job.lang_a;
            ctx.detectedTargetLang = job.lang_b;
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                languageProbabilities: asrResult.language_probabilities,
                langA: job.lang_a,
                langB: job.lang_b,
            }, 'runAsrStep: Two-way mode - could not determine detected language, using default source and target language');
        }
    }
    else {
        logger_1.default.error({
            jobId: job.job_id,
            sessionId: job.session_id,
            langA: job.lang_a,
            langB: job.lang_b,
        }, 'runAsrStep: Missing lang_a or lang_b, cannot determine source and target language');
    }
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
/**
 * 确定检测到的语言（双向模式）
 * 从语言概率中找出最可能是 lang_a 或 lang_b 的语言
 */
function determineDetectedLanguage(languageProbabilities, langA, langB) {
    if (!languageProbabilities || !langA || !langB) {
        return null;
    }
    // 获取概率最高的语言
    let maxProb = 0;
    let detectedLang = null;
    for (const [lang, prob] of Object.entries(languageProbabilities)) {
        if (prob > maxProb) {
            maxProb = prob;
            detectedLang = lang;
        }
    }
    // 检查检测到的语言是否是 lang_a 或 lang_b
    if (detectedLang === langA || detectedLang === langB) {
        return detectedLang;
    }
    // 如果检测到的语言不在 lang_a 或 lang_b 中，尝试匹配（处理语言代码变体）
    // 例如：'zh-CN' vs 'zh', 'en-US' vs 'en'
    const normalizeLang = (lang) => lang.split('-')[0].toLowerCase();
    const normalizedDetected = normalizeLang(detectedLang || '');
    const normalizedLangA = normalizeLang(langA);
    const normalizedLangB = normalizeLang(langB);
    if (normalizedDetected === normalizedLangA) {
        return langA;
    }
    if (normalizedDetected === normalizedLangB) {
        return langB;
    }
    return null;
}
