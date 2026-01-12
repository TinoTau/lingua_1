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
const postprocess_semantic_repair_initializer_1 = require("../agent/postprocess/postprocess-semantic-repair-initializer");
const aggregation_stage_1 = require("../agent/postprocess/aggregation-stage");
const dedup_1 = require("../aggregator/dedup");
class PipelineOrchestrator {
    /**
     * 设置去重处理器（从PostProcessCoordinator传递）
     */
    setDeduplicationHandler(deduplicationHandler) {
        // 更新AggregationStage的DeduplicationHandler
        this.aggregationStage.deduplicationHandler = deduplicationHandler;
        logger_1.default.info({ hasDeduplicationHandler: !!deduplicationHandler }, 'PipelineOrchestrator: DeduplicationHandler set for AggregationStage');
    }
    constructor(taskRouter, aggregatorManager, mode = 'offline', servicesHandler, // 可选的ServicesHandler（用于语义修复服务发现）
    aggregatorMiddleware // 可选的AggregatorMiddleware（用于去重时获取lastSentText）
    ) {
        this.taskRouter = taskRouter;
        this.aggregatorManager = null;
        // 语义修复相关
        this.semanticRepairInitializer = null;
        this.semanticRepairVersion = 0;
        // Gate-A: 初始化 Session Context Manager
        this.sessionContextManager = new session_context_manager_1.SessionContextManager();
        this.sessionContextManager.setTaskRouter(taskRouter);
        // S1: 初始化 AggregatorManager（用于ASR handler，仅用于构建prompt）
        this.aggregatorManager = aggregatorManager || null;
        // 初始化 ASR Handler
        this.asrHandler = new pipeline_orchestrator_asr_1.PipelineOrchestratorASRHandler(taskRouter, aggregatorManager);
        // 注意：文本聚合现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
        // 文本聚合在 ASR 之后、语义修复之前执行
        // PipelineOrchestrator 负责 ASR → 聚合 → 语义修复的完整流程
        // 初始化音频聚合器（用于在ASR之前聚合音频）
        this.audioAggregator = new audio_aggregator_1.AudioAggregator();
        logger_1.default.info({}, 'PipelineOrchestrator: AudioAggregator initialized for pre-ASR audio aggregation');
        // 初始化模块化处理器
        this.audioProcessor = new pipeline_orchestrator_audio_processor_1.PipelineOrchestratorAudioProcessor(this.audioAggregator);
        this.asrResultProcessor = new pipeline_orchestrator_asr_result_processor_1.PipelineOrchestratorASRResultProcessor();
        this.resultBuilder = new pipeline_orchestrator_result_builder_1.PipelineOrchestratorResultBuilder();
        // 初始化文本聚合Stage（与 ASR 绑定）
        // 修复：传递AggregatorMiddleware和DeduplicationHandler给AggregationStage，用于去重时获取lastSentText
        // 注意：DeduplicationHandler应该从PostProcessCoordinator获取，但PipelineOrchestrator不直接访问PostProcessCoordinator
        // 因此，DeduplicationHandler通过InferenceService传递
        this.aggregationStage = new aggregation_stage_1.AggregationStage(aggregatorManager ?? null, aggregatorMiddleware ?? null, null // DeduplicationHandler将在运行时通过setDeduplicationHandler设置
        );
        logger_1.default.info({}, 'PipelineOrchestrator: AggregationStage initialized (bound to ASR)');
        // 初始化语义修复（如果提供了ServicesHandler）
        if (servicesHandler) {
            this.semanticRepairInitializer = new postprocess_semantic_repair_initializer_1.SemanticRepairInitializer(servicesHandler, taskRouter);
            // 异步初始化，不阻塞构造函数
            this.semanticRepairInitializer.initialize().catch((error) => {
                logger_1.default.error({ error: error.message }, 'PipelineOrchestrator: Failed to initialize semantic repair stage in constructor');
            });
            logger_1.default.info({}, 'PipelineOrchestrator: SemanticRepairInitializer initialized');
        }
        else {
            logger_1.default.info({}, 'PipelineOrchestrator: SemanticRepairInitializer not initialized (no ServicesHandler provided)');
        }
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
        // 检查是否需要执行 ASR
        if (job.pipeline?.use_asr === false) {
            logger_1.default.info({ jobId: job.job_id, sessionId: job.session_id }, 'PipelineOrchestrator: ASR disabled by pipeline config, returning empty result');
            // ASR 完成回调
            if (asrCompletedCallback) {
                asrCompletedCallback(true);
            }
            return this.resultBuilder.buildEmptyResult();
        }
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
            // 处理ASR结果：空文本检查、无意义文本检查
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
            // ========== Stage 1: 文本聚合（ASR 之后、语义修复之前）==========
            // 注意：文本聚合现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
            // 构建临时 JobResult 用于聚合（包含 ASR 结果）
            const tempResult = this.resultBuilder.buildResult(textForNMT, asrResult, asrTask.rerun_count ?? 0);
            const aggregationStartTime = Date.now();
            const aggregationResult = this.aggregationStage.process(job, tempResult);
            const aggregationDuration = Date.now() - aggregationStartTime;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                aggregationDurationMs: aggregationDuration,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
                originalTextLength: textForNMT.length,
                action: aggregationResult.action,
                aggregationChanged: aggregationResult.aggregationChanged,
            }, 'PipelineOrchestrator: Aggregation stage completed (after ASR, before semantic repair)');
            // 修复：在语义修复之前检测并移除文本内部重复（叠字叠词）
            let textAfterDedup = aggregationResult.aggregatedText;
            if (textAfterDedup && textAfterDedup.trim().length > 0) {
                const originalText = textAfterDedup;
                textAfterDedup = (0, dedup_1.detectInternalRepetition)(textAfterDedup);
                if (textAfterDedup !== originalText) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        originalText: originalText.substring(0, 100),
                        dedupedText: textAfterDedup.substring(0, 100),
                        originalLength: originalText.length,
                        dedupedLength: textAfterDedup.length,
                        removedChars: originalText.length - textAfterDedup.length,
                        note: 'Detected and removed internal repetition (duplicate words/phrases) before semantic repair',
                    }, 'PipelineOrchestrator: Detected and removed internal repetition before semantic repair');
                }
            }
            // ========== Stage 2: 语义修复（如果 use_asr === true，必须执行）==========
            let finalTextForNMT = textAfterDedup; // 使用聚合和去重后的文本
            let semanticRepairApplied = false;
            let semanticRepairConfidence = 1.0;
            // 如果 use_asr === true，必须执行语义修复
            const useAsr = Boolean(job.pipeline?.use_asr ?? true);
            const shouldUseSemanticRepair = useAsr && textAfterDedup && textAfterDedup.trim().length > 0;
            // 添加调试日志：记录语义修复决策条件
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                useAsr,
                textAfterDedup: textAfterDedup ? textAfterDedup.substring(0, 50) : null,
                textAfterDedupLength: textAfterDedup ? textAfterDedup.length : 0,
                textAfterDedupTrimmedLength: textAfterDedup ? textAfterDedup.trim().length : 0,
                hasSemanticRepairInitializer: !!this.semanticRepairInitializer,
                shouldUseSemanticRepair,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
            }, 'PipelineOrchestrator: Semantic repair decision check');
            if (shouldUseSemanticRepair && this.semanticRepairInitializer) {
                try {
                    // 确保语义修复Stage已初始化
                    const initPromise = this.semanticRepairInitializer.getInitPromise();
                    if (!this.semanticRepairInitializer.isInitialized() && initPromise) {
                        await initPromise;
                    }
                    const semanticRepairStage = this.semanticRepairInitializer.getSemanticRepairStage();
                    if (semanticRepairStage) {
                        logger_1.default.info({
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            textLength: textAfterDedup.length,
                            aggregatedTextLength: aggregationResult.aggregatedText.length,
                            note: 'Starting semantic repair stage (after aggregation)',
                        }, 'PipelineOrchestrator: Starting semantic repair stage (after aggregation)');
                        // 获取微上下文（上一句尾部，用于语义修复）
                        let microContext = undefined;
                        if (this.aggregatorManager) {
                            const lastCommittedText = this.aggregatorManager.getLastCommittedText(job.session_id, textAfterDedup);
                            if (lastCommittedText && lastCommittedText.trim().length > 0) {
                                // 限制长度：取最后150个字符（避免上下文过长）
                                const trimmedContext = lastCommittedText.trim();
                                microContext = trimmedContext.length > 150
                                    ? trimmedContext.substring(trimmedContext.length - 150)
                                    : trimmedContext;
                            }
                        }
                        const repairResult = await semanticRepairStage.process(job, textAfterDedup, // 使用聚合和去重后的文本
                        asrResult.badSegmentDetection?.qualityScore, {
                            segments: asrResult.segments,
                            language_probability: asrResult.language_probability,
                            micro_context: microContext,
                        });
                        if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
                            finalTextForNMT = repairResult.textOut;
                            semanticRepairApplied = repairResult.semanticRepairApplied || false;
                            semanticRepairConfidence = repairResult.confidence;
                            logger_1.default.info({
                                jobId: job.job_id,
                                sessionId: job.session_id,
                                utteranceIndex: job.utterance_index,
                                decision: repairResult.decision,
                                confidence: repairResult.confidence,
                                originalText: textAfterDedup.substring(0, 100),
                                repairedText: finalTextForNMT.substring(0, 100),
                                textChanged: finalTextForNMT !== textAfterDedup,
                                semanticRepairApplied,
                                aggregatedTextLength: aggregationResult.aggregatedText.length,
                            }, 'PipelineOrchestrator: Semantic repair stage completed');
                        }
                        else if (repairResult.decision === 'REJECT') {
                            logger_1.default.warn({
                                jobId: job.job_id,
                                reasonCodes: repairResult.reasonCodes,
                            }, 'PipelineOrchestrator: Semantic repair rejected text');
                            // 保持原始文本
                        }
                    }
                    else {
                        logger_1.default.warn({
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            reason: 'semanticRepairStage is null',
                            hasSemanticRepairInitializer: !!this.semanticRepairInitializer,
                            isInitialized: this.semanticRepairInitializer?.isInitialized(),
                        }, 'PipelineOrchestrator: Semantic repair stage skipped (not available)');
                    }
                }
                catch (error) {
                    logger_1.default.error({
                        error: error.message,
                        stack: error.stack,
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                    }, 'PipelineOrchestrator: Semantic repair failed, using original text');
                    // 使用原始文本
                }
            }
            else {
                const reason = !useAsr ? 'use_asr is false' : !textAfterDedup ? 'textAfterDedup is empty' : !textAfterDedup.trim().length ? 'textAfterDedup is empty after trim' : !this.semanticRepairInitializer ? 'semanticRepairInitializer is null' : 'unknown';
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    useAsr: job.pipeline?.use_asr,
                    hasText: !!textAfterDedup,
                    textAfterDedupLength: textAfterDedup ? textAfterDedup.length : 0,
                    textAfterDedupTrimmedLength: textAfterDedup ? textAfterDedup.trim().length : 0,
                    hasSemanticRepairInitializer: !!this.semanticRepairInitializer,
                    shouldUseSemanticRepair,
                    reason,
                }, 'PipelineOrchestrator: Semantic repair skipped');
            }
            // 构建结果（包含聚合和语义修复后的文本）
            // 注意：如果应用了语义修复，finalTextForNMT 已经是修复后的文本
            // 如果应用了聚合，finalTextForNMT 已经是聚合后的文本
            const result = this.resultBuilder.buildResult(finalTextForNMT, // 使用聚合和修复后的文本（如果应用了）或原始文本
            asrResult, asrTask.rerun_count ?? 0);
            // 添加聚合相关字段
            result.aggregation_applied = aggregationResult.aggregationChanged;
            result.aggregation_action = aggregationResult.action;
            result.is_last_in_merged_group = aggregationResult.isLastInMergedGroup;
            if (aggregationResult.metrics) {
                result.aggregation_metrics = aggregationResult.metrics;
            }
            // 添加语义修复相关字段
            if (semanticRepairApplied) {
                result.semantic_repair_applied = true;
                result.semantic_repair_confidence = semanticRepairConfidence;
                result.text_asr_repaired = finalTextForNMT; // 保存修复后的文本（用于 PostProcessCoordinator 检查）
                // 注意：result.text_asr 已经是聚合和修复后的文本（因为 buildResult 使用了 finalTextForNMT）
            }
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
