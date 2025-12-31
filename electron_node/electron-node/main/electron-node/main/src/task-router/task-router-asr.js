"use strict";
/**
 * Task Router ASR Handler
 * 处理ASR路由相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterASRHandler = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
const bad_segment_detector_1 = require("./bad-segment-detector");
const rerun_trigger_1 = require("./rerun-trigger");
class TaskRouterASRHandler {
    constructor(selectServiceEndpoint, startGpuTrackingForService, serviceConnections, updateServiceConnections) {
        this.selectServiceEndpoint = selectServiceEndpoint;
        this.startGpuTrackingForService = startGpuTrackingForService;
        this.serviceConnections = serviceConnections;
        this.updateServiceConnections = updateServiceConnections;
        this.consecutiveLowQualityCount = new Map();
        this.currentCycleServiceEfficiencies = new Map();
        this.jobAbortControllers = new Map();
        this.rerunMetrics = {
            totalReruns: 0,
            successfulReruns: 0,
            failedReruns: 0,
            timeoutReruns: 0,
            qualityImprovements: 0,
        };
        this.loadASRConfig();
    }
    /**
     * 加载 ASR 配置
     */
    loadASRConfig() {
        try {
            const { loadNodeConfig } = require('../node-config');
            const config = loadNodeConfig();
            this.asrConfig = config.asr;
        }
        catch (error) {
            logger_1.default.warn({ error }, 'Failed to load ASR config, using defaults');
            this.asrConfig = undefined;
        }
    }
    /**
     * 获取 ASR 配置（带默认值）
     */
    getASRConfig() {
        if (!this.asrConfig) {
            this.loadASRConfig();
        }
        const defaultConfig = {
            beam_size: 10,
            temperature: 0.0,
            patience: 1.0,
            compression_ratio_threshold: 2.4,
            log_prob_threshold: -1.0,
            no_speech_threshold: 0.6,
        };
        if (!this.asrConfig) {
            return defaultConfig;
        }
        return {
            beam_size: this.asrConfig.beam_size ?? defaultConfig.beam_size,
            temperature: this.asrConfig.temperature ?? defaultConfig.temperature,
            patience: this.asrConfig.patience ?? defaultConfig.patience,
            compression_ratio_threshold: this.asrConfig.compression_ratio_threshold ?? defaultConfig.compression_ratio_threshold,
            log_prob_threshold: this.asrConfig.log_prob_threshold ?? defaultConfig.log_prob_threshold,
            no_speech_threshold: this.asrConfig.no_speech_threshold ?? defaultConfig.no_speech_threshold,
        };
    }
    /**
     * 路由 ASR 任务
     */
    async routeASRTask(task) {
        const taskStartTime = Date.now();
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.ASR);
        if (!endpoint) {
            throw new Error('No available ASR service');
        }
        // GPU 跟踪：在任务开始时启动 GPU 跟踪
        this.startGpuTrackingForService(endpoint.serviceId);
        // 增加连接计数
        this.updateServiceConnections(endpoint.serviceId, 1);
        try {
            // 创建 AbortController 用于支持任务取消
            if (!task.job_id) {
                logger_1.default.warn({}, 'ASR task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000,
            });
            // ASR 服务路由：目前只支持 faster-whisper-vad
            if (endpoint.serviceId !== 'faster-whisper-vad') {
                throw new Error(`Unsupported ASR service: ${endpoint.serviceId}. Only faster-whisper-vad is supported.`);
            }
            const audioFormat = task.audio_format || 'opus';
            const requestUrl = `${endpoint.baseUrl}/utterance`;
            if (!task.audio_format) {
                logger_1.default.warn({
                    serviceId: endpoint.serviceId,
                    jobId: task.job_id,
                    message: 'task.audio_format is missing, defaulting to opus (web client uses opus format)',
                }, 'Missing audio_format in task, using opus as default');
            }
            logger_1.default.info({
                serviceId: endpoint.serviceId,
                baseUrl: endpoint.baseUrl,
                requestUrl,
                audioFormat,
                originalFormat: task.audio_format,
                jobId: task.job_id,
            }, 'Routing ASR task to faster-whisper-vad');
            // 检查音频输入质量（用于调试 Job2 问题）
            let audioDataLength = 0;
            let audioDataPreview = '';
            try {
                if (task.audio) {
                    const audioBuffer = Buffer.from(task.audio, 'base64');
                    audioDataLength = audioBuffer.length;
                    const estimatedDurationMs = Math.round((audioDataLength / 2) / 16);
                    const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
                    let sumSquares = 0;
                    for (let i = 0; i < samples.length; i++) {
                        sumSquares += samples[i] * samples[i];
                    }
                    const rms = Math.sqrt(sumSquares / samples.length);
                    const rmsNormalized = rms / 32768.0;
                    audioDataPreview = `length=${audioDataLength}, duration=${estimatedDurationMs}ms, rms=${rmsNormalized.toFixed(4)}`;
                    logger_1.default.info({
                        serviceId: endpoint.serviceId,
                        jobId: task.job_id,
                        utteranceIndex: task.utterance_index,
                        audioDataLength,
                        estimatedDurationMs,
                        rms: rmsNormalized.toFixed(4),
                        audioFormat,
                        sampleRate: task.sample_rate || 16000,
                        contextTextLength: task.context_text?.length || 0,
                        contextTextPreview: task.context_text ? task.context_text.substring(0, 200) : null,
                    }, 'ASR task: Audio input quality check');
                }
            }
            catch (error) {
                logger_1.default.warn({
                    serviceId: endpoint.serviceId,
                    jobId: task.job_id,
                    utteranceIndex: task.utterance_index,
                    error: error.message,
                }, 'ASR task: Failed to analyze audio input quality');
            }
            const requestBody = {
                job_id: task.job_id || `asr_${Date.now()}`,
                src_lang: task.src_lang,
                tgt_lang: task.src_lang,
                audio: task.audio,
                audio_format: audioFormat,
                sample_rate: task.sample_rate || 16000,
                task: 'transcribe',
                beam_size: task.beam_size || this.getASRConfig().beam_size,
                condition_on_previous_text: false,
                use_context_buffer: false,
                use_text_context: true,
                enable_streaming_asr: task.enable_streaming || false,
                context_text: task.context_text,
                best_of: task.best_of,
                temperature: task.temperature,
                patience: task.patience,
                padding_ms: task.padding_ms,
            };
            let response;
            try {
                response = await httpClient.post('/utterance', requestBody, {
                    signal: abortController.signal,
                });
                logger_1.default.info({
                    serviceId: endpoint.serviceId,
                    requestUrl,
                    status: response.status,
                    jobId: task.job_id,
                }, 'faster-whisper-vad request succeeded');
            }
            catch (axiosError) {
                logger_1.default.error({
                    serviceId: endpoint.serviceId,
                    requestUrl,
                    baseUrl: endpoint.baseUrl,
                    status: axiosError.response?.status,
                    statusText: axiosError.response?.statusText,
                    errorMessage: axiosError.message,
                    errorCode: axiosError.code,
                    jobId: task.job_id,
                    responseData: axiosError.response?.data,
                }, 'faster-whisper-vad request failed');
                throw axiosError;
            }
            const langProb = response.data.language_probability ?? 0;
            let useTextContext = false;
            let conditionOnPreviousText = false;
            // P0.5-CTX-1: 低质量禁用 context
            const tempBadSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)({
                text: response.data.text || '',
                language: response.data.language || task.src_lang,
                language_probability: langProb,
                language_probabilities: response.data.language_probabilities,
                segments: response.data.segments,
            }, response.data.duration ? Math.round(response.data.duration * 1000) : undefined, task.context_text);
            if (tempBadSegmentDetection.qualityScore < 0.4) {
                useTextContext = false;
                conditionOnPreviousText = false;
                logger_1.default.info({
                    jobId: task.job_id,
                    qualityScore: tempBadSegmentDetection.qualityScore,
                }, 'P0.5-CTX-1: Low quality score, disabling context');
            }
            if (langProb < 0.70) {
                useTextContext = false;
                conditionOnPreviousText = false;
            }
            // 构建 ASR 结果
            const asrText = response.data.text || '';
            const asrResult = {
                text: asrText,
                confidence: 1.0,
                language: response.data.language || task.src_lang,
                language_probability: response.data.language_probability,
                language_probabilities: response.data.language_probabilities,
                segments: response.data.segments,
                is_final: true,
            };
            logger_1.default.info({
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                utteranceIndex: task.utterance_index,
                asrTextLength: asrText.length,
                asrTextPreview: asrText.substring(0, 100),
                language: asrResult.language,
                languageProbability: asrResult.language_probability,
                segmentCount: response.data.segments?.length || 0,
                audioDurationMs: response.data.duration ? Math.round(response.data.duration * 1000) : undefined,
                segmentsPreview: response.data.segments?.slice(0, 3).map((seg) => ({
                    text: seg.text?.substring(0, 50) || '',
                    start: seg.start,
                    end: seg.end,
                })) || [],
            }, 'ASR service returned result');
            // CONF-3 + RERUN-1: 基于 segments 时间戳的断裂/异常检测 + 坏段判定
            const audioDurationMs = response.data.duration
                ? Math.round(response.data.duration * 1000)
                : undefined;
            let calculatedAudioDurationMs = audioDurationMs;
            if (!calculatedAudioDurationMs && asrResult.segments && asrResult.segments.length > 0) {
                const lastSegment = asrResult.segments[asrResult.segments.length - 1];
                if (lastSegment && lastSegment.end) {
                    calculatedAudioDurationMs = Math.round(lastSegment.end * 1000);
                    logger_1.default.debug({ jobId: task.job_id, calculatedAudioDurationMs }, 'OBS-1: Calculated audio duration from segments');
                }
            }
            const previousText = task.context_text || undefined;
            const badSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)(asrResult, audioDurationMs, previousText);
            if (badSegmentDetection.isBad) {
                logger_1.default.warn({
                    jobId: task.job_id,
                    reasonCodes: badSegmentDetection.reasonCodes,
                    qualityScore: badSegmentDetection.qualityScore,
                    segmentCount: asrResult.segments?.length || 0,
                    audioDurationMs,
                    languageProbability: asrResult.language_probability,
                }, 'CONF-3: Bad segment detected based on segments timestamps');
            }
            else {
                logger_1.default.debug({
                    jobId: task.job_id,
                    qualityScore: badSegmentDetection.qualityScore,
                    segmentCount: asrResult.segments?.length || 0,
                }, 'CONF-3: Segment quality check passed');
            }
            asrResult.badSegmentDetection = badSegmentDetection;
            // P0.5-CTX-2: 检查连续低质量
            const sessionId = task.session_id || task.job_id || 'unknown';
            if (badSegmentDetection.qualityScore < 0.4) {
                const currentCount = this.consecutiveLowQualityCount.get(sessionId) || 0;
                const newCount = currentCount + 1;
                this.consecutiveLowQualityCount.set(sessionId, newCount);
                if (newCount >= 2) {
                    logger_1.default.warn({
                        jobId: task.job_id,
                        sessionId,
                        consecutiveLowQualityCount: newCount,
                        qualityScore: badSegmentDetection.qualityScore,
                    }, 'P0.5-CTX-2: Consecutive low quality detected (>=2), should reset context');
                    asrResult.shouldResetContext = true;
                }
            }
            else {
                this.consecutiveLowQualityCount.set(sessionId, 0);
            }
            // P0.5-SH-1/2: 检查是否应该触发 Top-2 语言重跑
            const rerunCondition = (0, rerun_trigger_1.shouldTriggerRerun)(asrResult, audioDurationMs, task);
            if (rerunCondition.shouldRerun) {
                logger_1.default.info({
                    jobId: task.job_id,
                    reason: rerunCondition.reason,
                    languageProbability: asrResult.language_probability,
                    qualityScore: badSegmentDetection.qualityScore,
                }, 'P0.5-SH-2: Triggering Top-2 language rerun');
                const top2Langs = (0, rerun_trigger_1.getTop2LanguagesForRerun)(asrResult.language_probabilities || {}, asrResult.language);
                if (top2Langs.length > 0) {
                    let bestResult = asrResult;
                    let bestQualityScore = badSegmentDetection.qualityScore;
                    for (const lang of top2Langs) {
                        try {
                            logger_1.default.info({
                                jobId: task.job_id,
                                rerunLanguage: lang,
                                originalLanguage: asrResult.language,
                                rerunCount: (task.rerun_count || 0) + 1,
                            }, 'P0.5-SH-2: Attempting rerun with forced language');
                            const rerunTimeoutMs = task.rerun_timeout_ms ?? 5000;
                            const rerunAbortController = new AbortController();
                            const rerunTimeoutId = setTimeout(() => {
                                rerunAbortController.abort();
                                logger_1.default.warn({
                                    jobId: task.job_id,
                                    rerunLanguage: lang,
                                    timeoutMs: rerunTimeoutMs,
                                }, 'P0.5-SH-4: Rerun timeout exceeded');
                            }, rerunTimeoutMs);
                            try {
                                const rerunTask = {
                                    ...task,
                                    src_lang: lang,
                                    rerun_count: (task.rerun_count || 0) + 1,
                                };
                                const rerunRequestBody = {
                                    ...requestBody,
                                    src_lang: lang,
                                    language: lang,
                                };
                                const rerunResponse = await httpClient.post('/utterance', rerunRequestBody, {
                                    signal: rerunAbortController.signal,
                                });
                                clearTimeout(rerunTimeoutId);
                                const rerunResult = {
                                    text: rerunResponse.data.text || '',
                                    confidence: 1.0,
                                    language: rerunResponse.data.language || lang,
                                    language_probability: rerunResponse.data.language_probability,
                                    language_probabilities: rerunResponse.data.language_probabilities,
                                    segments: rerunResponse.data.segments,
                                    is_final: true,
                                };
                                const rerunAudioDurationMs = rerunResponse.data.duration
                                    ? Math.round(rerunResponse.data.duration * 1000)
                                    : undefined;
                                const rerunBadSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)(rerunResult, rerunAudioDurationMs, previousText);
                                rerunResult.badSegmentDetection = rerunBadSegmentDetection;
                                if (rerunBadSegmentDetection.qualityScore > bestQualityScore) {
                                    logger_1.default.info({
                                        jobId: task.job_id,
                                        rerunLanguage: lang,
                                        originalQualityScore: bestQualityScore,
                                        rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                                    }, 'P0.5-SH-3: Rerun result has better quality score, selecting it');
                                    bestResult = rerunResult;
                                    bestQualityScore = rerunBadSegmentDetection.qualityScore;
                                    this.rerunMetrics.qualityImprovements++;
                                }
                                else {
                                    logger_1.default.debug({
                                        jobId: task.job_id,
                                        rerunLanguage: lang,
                                        originalQualityScore: bestQualityScore,
                                        rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                                    }, 'P0.5-SH-3: Rerun result quality score not better, keeping original');
                                }
                                this.rerunMetrics.totalReruns++;
                                this.rerunMetrics.successfulReruns++;
                            }
                            catch (rerunError) {
                                clearTimeout(rerunTimeoutId);
                                this.rerunMetrics.totalReruns++;
                                if (rerunAbortController.signal.aborted) {
                                    logger_1.default.warn({
                                        jobId: task.job_id,
                                        rerunLanguage: lang,
                                        timeoutMs: rerunTimeoutMs,
                                    }, 'P0.5-SH-4: Rerun aborted due to timeout');
                                    this.rerunMetrics.timeoutReruns++;
                                }
                                else {
                                    logger_1.default.warn({
                                        jobId: task.job_id,
                                        rerunLanguage: lang,
                                        error: rerunError.message,
                                    }, 'P0.5-SH-2: Rerun failed, continuing with next language or original result');
                                    this.rerunMetrics.failedReruns++;
                                }
                            }
                        }
                        catch (outerError) {
                            logger_1.default.error({
                                jobId: task.job_id,
                                rerunLanguage: lang,
                                error: outerError.message,
                            }, 'P0.5-SH-2: Unexpected error during rerun setup');
                        }
                    }
                    if (bestResult !== asrResult) {
                        logger_1.default.info({
                            jobId: task.job_id,
                            originalLanguage: asrResult.language,
                            selectedLanguage: bestResult.language,
                            originalQualityScore: badSegmentDetection.qualityScore,
                            selectedQualityScore: bestQualityScore,
                        }, 'P0.5-SH-3: Selected rerun result as best');
                    }
                    // OBS-1: 记录处理效率（重跑场景，包含重跑时间）
                    const taskEndTime = Date.now();
                    const processingTimeMs = taskEndTime - taskStartTime;
                    this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
                    return bestResult;
                }
                else {
                    logger_1.default.warn({
                        jobId: task.job_id,
                    }, 'P0.5-SH-2: No Top-2 languages available for rerun');
                }
            }
            // OBS-1: 记录处理效率（正常场景，无重跑）
            const taskEndTime = Date.now();
            const processingTimeMs = taskEndTime - taskStartTime;
            this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
            return asrResult;
        }
        catch (error) {
            const errorDetails = {
                serviceId: endpoint.serviceId,
                baseUrl: endpoint.baseUrl,
                jobId: task.job_id,
                errorMessage: error.message,
            };
            if (error.response) {
                errorDetails.status = error.response.status;
                errorDetails.statusText = error.response.statusText;
                errorDetails.responseData = error.response.data;
                errorDetails.requestUrl = error.config?.url || 'unknown';
                errorDetails.requestMethod = error.config?.method || 'unknown';
            }
            else if (error.request) {
                errorDetails.requestError = true;
                errorDetails.requestUrl = error.config?.url || 'unknown';
            }
            else {
                errorDetails.errorCode = error.code;
                errorDetails.errorStack = error.stack;
            }
            logger_1.default.error(errorDetails, 'ASR task failed');
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            // 减少连接计数
            this.updateServiceConnections(endpoint.serviceId, -1);
        }
    }
    /**
     * OBS-1: 记录 ASR 处理效率
     */
    recordASREfficiency(serviceId, audioDurationMs, processingTimeMs) {
        if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
            logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs }, 'OBS-1: Skipping ASR efficiency recording due to invalid parameters');
            return;
        }
        const efficiency = audioDurationMs / processingTimeMs;
        let efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
        if (!efficiencies) {
            efficiencies = [];
            this.currentCycleServiceEfficiencies.set(serviceId, efficiencies);
        }
        efficiencies.push(efficiency);
        logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs, efficiency: efficiency.toFixed(2) }, 'OBS-1: Recorded ASR processing efficiency');
    }
    /**
     * Gate-A: 重置指定 session 的连续低质量计数
     */
    resetConsecutiveLowQualityCount(sessionId) {
        this.consecutiveLowQualityCount.set(sessionId, 0);
        logger_1.default.info({
            sessionId,
        }, 'Gate-A: Reset consecutiveLowQualityCount for session');
    }
    /**
     * Gate-B: 获取 Rerun 指标
     */
    getRerunMetrics() {
        return { ...this.rerunMetrics };
    }
    /**
     * OBS-1: 获取当前心跳周期的处理效率指标
     */
    getProcessingMetrics() {
        const result = {};
        for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
            if (efficiencies.length > 0) {
                const sum = efficiencies.reduce((a, b) => a + b, 0);
                const average = sum / efficiencies.length;
                result[serviceId] = average;
            }
        }
        return result;
    }
    /**
     * OBS-1: 重置当前心跳周期的统计数据
     */
    resetCycleMetrics() {
        this.currentCycleServiceEfficiencies.clear();
    }
}
exports.TaskRouterASRHandler = TaskRouterASRHandler;
