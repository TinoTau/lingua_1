"use strict";
// 流水线编排器 - 协调多个服务完成完整流程
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOrchestrator = void 0;
const logger_1 = __importDefault(require("../logger"));
// Gate-A: Session Context Manager
const session_context_manager_1 = require("./session-context-manager");
class PipelineOrchestrator {
    constructor(taskRouter) {
        this.taskRouter = taskRouter;
        // Gate-A: 初始化 Session Context Manager
        this.sessionContextManager = new session_context_manager_1.SessionContextManager();
        this.sessionContextManager.setTaskRouter(taskRouter);
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
            const asrTask = {
                audio: job.audio,
                audio_format: job.audio_format || 'pcm16',
                sample_rate: job.sample_rate || 16000,
                src_lang: job.src_lang,
                enable_streaming: job.enable_streaming_asr || false,
                context_text: job.context_text,
                job_id: job.job_id, // 传递 job_id 用于任务取消
                // EDGE-4: Padding 配置（从 job 中提取，如果调度服务器传递了该参数）
                padding_ms: job.padding_ms,
                // P0.5-SH-4: 传递重跑次数（从 job 中提取，如果调度服务器传递了该参数）
                rerun_count: job.rerun_count || 0,
            };
            let asrResult;
            if (job.enable_streaming_asr && partialCallback) {
                // 流式 ASR 处理
                asrResult = await this.processASRStreaming(asrTask, partialCallback);
            }
            else {
                asrResult = await this.taskRouter.routeASRTask(asrTask);
            }
            logger_1.default.debug({ jobId: job.job_id, text: asrResult.text }, 'ASR task completed');
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
            // 检查 ASR 结果是否为空或无意义（防止空文本进入 NMT/TTS）
            // 重要：ASR 服务已经过滤了空文本，但节点端也应该检查以确保安全
            const asrTextTrimmed = (asrResult.text || '').trim();
            if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
                logger_1.default.warn({ jobId: job.job_id, asrText: asrResult.text }, 'ASR result is empty, skipping NMT and TTS');
                // 返回空结果，不进行翻译和 TTS
                return {
                    text_asr: '',
                    text_translated: '',
                    tts_audio: '',
                    tts_format: 'pcm16',
                    extra: {
                        emotion: undefined,
                        speech_rate: undefined,
                        voice_style: undefined,
                        language_probability: asrResult.language_probability, // 新增：即使 ASR 为空，也传递语言概率信息
                        language_probabilities: asrResult.language_probabilities, // 新增
                    },
                };
            }
            // 检查是否为无意义文本（如 "The", "A", "An" 等）
            // 这些通常是 NMT 对空文本的默认翻译
            const meaninglessWords = ['the', 'a', 'an', 'this', 'that', 'it'];
            if (meaninglessWords.includes(asrTextTrimmed.toLowerCase())) {
                logger_1.default.warn({ jobId: job.job_id, asrText: asrResult.text }, 'ASR result is meaningless word, skipping NMT and TTS');
                return {
                    text_asr: asrResult.text,
                    text_translated: '',
                    tts_audio: '',
                    tts_format: 'pcm16',
                    extra: {
                        emotion: undefined,
                        speech_rate: undefined,
                        voice_style: undefined,
                        language_probability: asrResult.language_probability, // 新增
                        language_probabilities: asrResult.language_probabilities, // 新增
                    },
                };
            }
            // 2. NMT 任务（异步处理，不阻塞 ASR 服务）
            logger_1.default.debug({ jobId: job.job_id }, 'Starting NMT task');
            // 关键修复：context_text 应该是上一个utterance的文本，而不是当前文本
            // 如果使用当前文本作为上下文，会导致NMT输入重复（context_text + text = text + text）
            // 暂时不传递上下文，或者需要从其他地方获取上一个utterance的文本
            const nmtTask = {
                text: asrTextTrimmed,
                src_lang: job.src_lang,
                tgt_lang: job.tgt_lang,
                context_text: undefined, // 不传递上下文，避免重复翻译（TODO: 如果需要上下文，应该传递上一个utterance的文本）
                job_id: job.job_id, // 传递 job_id 用于任务取消
            };
            const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
            logger_1.default.debug({ jobId: job.job_id, text: nmtResult.text }, 'NMT task completed');
            // 检查 NMT 结果是否为空或无意义
            const nmtTextTrimmed = (nmtResult.text || '').trim();
            if (!nmtTextTrimmed || nmtTextTrimmed.length === 0) {
                logger_1.default.warn({ jobId: job.job_id, asrText: asrResult.text, nmtText: nmtResult.text }, 'NMT result is empty, skipping TTS');
                return {
                    text_asr: asrResult.text,
                    text_translated: '',
                    tts_audio: '',
                    tts_format: 'pcm16',
                    extra: {
                        emotion: undefined,
                        speech_rate: undefined,
                        voice_style: undefined,
                        language_probability: asrResult.language_probability, // 新增
                        language_probabilities: asrResult.language_probabilities, // 新增
                    },
                };
            }
            // 检查 NMT 结果是否为无意义单词
            if (meaninglessWords.includes(nmtTextTrimmed.toLowerCase())) {
                logger_1.default.warn({ jobId: job.job_id, asrText: asrResult.text, nmtText: nmtResult.text }, 'NMT result is meaningless word, skipping TTS');
                return {
                    text_asr: asrResult.text,
                    text_translated: nmtResult.text,
                    tts_audio: '',
                    tts_format: 'pcm16',
                    extra: {
                        emotion: undefined,
                        speech_rate: undefined,
                        voice_style: undefined,
                    },
                };
            }
            // 3. TTS 任务
            logger_1.default.debug({ jobId: job.job_id }, 'Starting TTS task');
            const ttsTask = {
                text: nmtTextTrimmed,
                lang: job.tgt_lang,
                voice_id: job.voice_id,
                speaker_id: job.speaker_id,
                sample_rate: job.sample_rate || 16000,
                job_id: job.job_id, // 传递 job_id 用于任务取消
            };
            const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
            logger_1.default.debug({ jobId: job.job_id }, 'TTS task completed');
            // 4. 返回结果
            // OBS-2: 计算 ASR 质量级别
            let asrQualityLevel;
            if (asrResult.badSegmentDetection) {
                const qualityScore = asrResult.badSegmentDetection.qualityScore;
                if (qualityScore >= 0.7) {
                    asrQualityLevel = 'good';
                }
                else if (qualityScore >= 0.4) {
                    asrQualityLevel = 'suspect';
                }
                else {
                    asrQualityLevel = 'bad';
                }
            }
            // OBS-2: 计算 segments_meta
            let segmentsMeta;
            if (asrResult.segments && asrResult.segments.length > 0) {
                const segments = asrResult.segments;
                let maxGap = 0;
                let totalDuration = 0;
                for (let i = 0; i < segments.length; i++) {
                    const segment = segments[i];
                    if (segment.end && segment.start) {
                        const duration = segment.end - segment.start;
                        totalDuration += duration;
                        // 计算与前一个 segment 的间隔
                        if (i > 0 && segments[i - 1].end !== undefined) {
                            const prevEnd = segments[i - 1].end;
                            const gap = segment.start - prevEnd;
                            if (gap > maxGap) {
                                maxGap = gap;
                            }
                        }
                    }
                }
                segmentsMeta = {
                    count: segments.length,
                    max_gap: maxGap,
                    avg_duration: segments.length > 0 ? totalDuration / segments.length : 0,
                };
            }
            const result = {
                text_asr: asrResult.text,
                text_translated: nmtResult.text,
                tts_audio: ttsResult.audio,
                tts_format: ttsResult.audio_format,
                extra: {
                    emotion: undefined,
                    speech_rate: undefined,
                    voice_style: undefined,
                    language_probability: asrResult.language_probability, // 新增：检测到的语言的概率
                    language_probabilities: asrResult.language_probabilities, // 新增：所有语言的概率信息
                },
                // OBS-2: ASR 质量信息
                asr_quality_level: asrQualityLevel,
                reason_codes: asrResult.badSegmentDetection?.reasonCodes,
                quality_score: asrResult.badSegmentDetection?.qualityScore,
                rerun_count: asrTask.rerun_count,
                segments_meta: segmentsMeta,
            };
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
     * 处理流式 ASR
     */
    async processASRStreaming(task, partialCallback) {
        // 对于流式 ASR，我们需要通过 WebSocket 连接
        // 这里简化处理，实际应该使用 WebSocket 客户端
        // 暂时回退到非流式处理
        logger_1.default.warn({}, 'Streaming ASR not fully implemented, falling back to non-streaming');
        return await this.taskRouter.routeASRTask({
            ...task,
            enable_streaming: false,
        });
    }
    /**
     * 处理仅 ASR 任务
     */
    async processASROnly(job) {
        const asrTask = {
            audio: job.audio,
            audio_format: job.audio_format || 'pcm16',
            sample_rate: job.sample_rate || 16000,
            src_lang: job.src_lang,
            enable_streaming: job.enable_streaming_asr || false,
            context_text: job.context_text,
            job_id: job.job_id, // 传递 job_id 用于任务取消
        };
        const asrResult = await this.taskRouter.routeASRTask(asrTask);
        return { text_asr: asrResult.text };
    }
    /**
     * 处理仅 NMT 任务
     */
    async processNMTOnly(text, srcLang, tgtLang, contextText) {
        const nmtTask = {
            text,
            src_lang: srcLang,
            tgt_lang: tgtLang,
            context_text: contextText,
        };
        const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
        return { text_translated: nmtResult.text };
    }
    /**
     * 处理仅 TTS 任务
     */
    async processTTSOnly(text, lang, voiceId, speakerId, sampleRate) {
        const ttsTask = {
            text,
            lang,
            voice_id: voiceId,
            speaker_id: speakerId,
            sample_rate: sampleRate || 16000,
        };
        const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
        return {
            tts_audio: ttsResult.audio,
            tts_format: ttsResult.audio_format,
        };
    }
}
exports.PipelineOrchestrator = PipelineOrchestrator;
