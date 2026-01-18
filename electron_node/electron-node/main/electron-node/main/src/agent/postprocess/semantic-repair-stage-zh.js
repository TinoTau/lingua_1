"use strict";
/**
 * SemanticRepairStageZH - 中文语义修复Stage
 * 职责：对中文ASR文本进行语义修复（使用LLM）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairStageZH = void 0;
const semantic_repair_scorer_1 = require("./semantic-repair-scorer");
const semantic_repair_validator_1 = require("./semantic-repair-validator");
const logger_1 = __importDefault(require("../../logger"));
const sequential_executor_factory_1 = require("../../sequential-executor/sequential-executor-factory");
const gpu_arbiter_1 = require("../../gpu-arbiter");
const node_config_1 = require("../../node-config");
class SemanticRepairStageZH {
    constructor(taskRouter, config) {
        this.taskRouter = taskRouter;
        this.config = config;
        this.DEFAULT_QUALITY_THRESHOLD = 0.70;
        // 从配置文件加载文本长度配置
        const nodeConfig = (0, node_config_1.loadNodeConfig)();
        this.SHORT_SENTENCE_LENGTH = nodeConfig.textLength?.minLengthToSend ?? 20;
        // P1-1: 初始化打分器
        this.scorer = new semantic_repair_scorer_1.SemanticRepairScorer({
            qualityThreshold: config.qualityThreshold || this.DEFAULT_QUALITY_THRESHOLD,
            shortSentenceLength: this.SHORT_SENTENCE_LENGTH,
            ...config.scorerConfig,
        });
        // P1-2: 初始化输出校验器
        this.validator = new semantic_repair_validator_1.SemanticRepairValidator(config.validatorConfig);
    }
    /**
     * 执行中文语义修复
     */
    async process(job, text, qualityScore, meta) {
        if (!text || text.trim().length === 0) {
            return {
                textOut: text,
                decision: 'PASS',
                confidence: 1.0,
                reasonCodes: ['EMPTY_TEXT'],
            };
        }
        // 调用语义修复服务
        if (!this.taskRouter) {
            logger_1.default.warn({ jobId: job.job_id }, 'SemanticRepairStageZH: TaskRouter not available, returning PASS');
            return {
                textOut: text,
                decision: 'PASS',
                confidence: 1.0,
                reasonCodes: ['TASK_ROUTER_NOT_AVAILABLE'],
            };
        }
        // 对每句话都进行修复，跳过质量评分
        // 仍然计算评分用于日志记录，但不作为触发条件
        const scoreResult = this.scorer.score(text, qualityScore, meta);
        const startTime = Date.now();
        try {
            // 获取微上下文（上一句尾部）
            const microContext = this.getMicroContext(job, meta);
            // 构建修复任务
            const repairTask = {
                job_id: job.job_id,
                session_id: job.session_id || '',
                utterance_index: job.utterance_index || 0,
                lang: 'zh',
                text_in: text,
                quality_score: qualityScore,
                micro_context: microContext,
                meta: {
                    segments: meta?.segments,
                    language_probability: meta?.language_probability,
                    reason_codes: scoreResult.reasonCodes,
                    score: scoreResult.score, // P1-1: 传递综合评分
                    score_details: scoreResult.details, // P1-1: 传递评分详情
                },
            };
            // 顺序执行：确保Semantic Repair按utterance_index顺序执行
            const sequentialExecutor = (0, sequential_executor_factory_1.getSequentialExecutor)();
            const sessionId = job.session_id || '';
            const utteranceIndex = job.utterance_index || 0;
            // 使用顺序执行管理器包装Semantic Repair调用
            const repairResult = await sequentialExecutor.execute(sessionId, utteranceIndex, 'SEMANTIC_REPAIR', async () => {
                // GPU仲裁：获取GPU租约（支持忙时降级）
                let result;
                try {
                    const lease = await (0, gpu_arbiter_1.tryAcquireGpuLease)('SEMANTIC_REPAIR', {
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        stage: 'SemanticRepair',
                    });
                    if (lease) {
                        // 成功获取GPU租约，使用GPU执行
                        try {
                            result = await this.taskRouter.routeSemanticRepairTask(repairTask);
                        }
                        finally {
                            lease.release();
                        }
                    }
                    else {
                        // GPU租约获取失败（超时或队列满），这不应该发生（因为busyPolicy是WAIT）
                        // 如果发生，说明配置错误或系统异常
                        logger_1.default.error({
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            note: 'GPU lease acquisition failed unexpectedly. This should not happen with WAIT policy. Check GPU arbiter configuration.',
                        }, 'SemanticRepairStageZH: GPU lease acquisition failed unexpectedly');
                        // 抛出错误，让上层处理
                        throw new Error('SemanticRepairStageZH: GPU lease acquisition failed unexpectedly');
                    }
                }
                catch (error) {
                    // GPU租约获取异常，这不应该发生（因为busyPolicy是WAIT，应该等待）
                    // 如果发生，说明系统异常，抛出错误让上层处理
                    logger_1.default.error({
                        error: error.message,
                        stack: error.stack,
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        note: 'GPU lease acquisition error. This should not happen with WAIT policy. Check GPU arbiter configuration and system status.',
                    }, 'SemanticRepairStageZH: GPU lease acquisition error');
                    // 抛出错误，让上层处理
                    throw error;
                }
                return result;
            }, job.job_id);
            const repairTimeMs = Date.now() - startTime;
            // P1-2: 输出校验
            let finalTextOut = repairResult.text_out;
            let finalDecision = repairResult.decision;
            let finalConfidence = repairResult.confidence;
            let finalReasonCodes = [...repairResult.reason_codes];
            if (repairResult.decision === 'REPAIR') {
                const validationResult = this.validator.validate(text, repairResult.text_out);
                if (!validationResult.isValid) {
                    // 校验失败，回退到PASS
                    logger_1.default.warn({
                        jobId: job.job_id,
                        validationReasonCodes: validationResult.reasonCodes,
                        originalText: text.substring(0, 50),
                        repairedText: repairResult.text_out.substring(0, 50),
                    }, 'SemanticRepairStageZH: Validation failed, reverting to PASS');
                    finalTextOut = text;
                    finalDecision = 'PASS';
                    finalConfidence = 1.0;
                    finalReasonCodes = [...repairResult.reason_codes, ...validationResult.reasonCodes];
                }
            }
            logger_1.default.debug({
                jobId: job.job_id,
                decision: finalDecision,
                confidence: finalConfidence,
                reasonCodes: finalReasonCodes,
                repairTimeMs,
            }, 'SemanticRepairStageZH: Repair completed');
            return {
                textOut: finalTextOut,
                decision: finalDecision,
                confidence: finalConfidence,
                diff: repairResult.diff,
                reasonCodes: finalReasonCodes,
                repairTimeMs,
            };
        }
        catch (error) {
            logger_1.default.error({
                error: error.message,
                stack: error.stack,
                jobId: job.job_id,
            }, 'SemanticRepairStageZH: Repair service error, returning PASS');
            return {
                textOut: text,
                decision: 'PASS',
                confidence: 1.0,
                reasonCodes: ['SERVICE_ERROR'],
                repairTimeMs: Date.now() - startTime,
            };
        }
    }
    // P1-1: 已移除shouldTriggerRepair、countNonChineseChars、hasBasicSyntax方法
    // 这些功能已迁移到SemanticRepairScorer中
    /**
     * 获取微上下文（上一句尾部）
     */
    getMicroContext(job, meta) {
        // TODO: 从AggregatorManager获取上一句文本
        // 暂时返回undefined，后续可以从meta中获取
        return meta?.micro_context;
    }
}
exports.SemanticRepairStageZH = SemanticRepairStageZH;
