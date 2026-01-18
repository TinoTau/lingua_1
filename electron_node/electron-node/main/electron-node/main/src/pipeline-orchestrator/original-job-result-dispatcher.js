"use strict";
/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果，累积多个ASR批次到同一个JobResult
 *
 * 功能：
 * 1. 按originalJobId分组ASR结果
 * 2. 累积多个ASR批次到同一个JobResult的segments数组
 * 3. 当达到期望的片段数量或finalize时，触发后续处理（语义修复、NMT、TTS）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OriginalJobResultDispatcher = void 0;
const logger_1 = __importDefault(require("../logger"));
/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果
 */
class OriginalJobResultDispatcher {
    constructor() {
        // 按sessionId和originalJobId分组存储注册信息
        this.registrations = new Map();
        // ✅ 20秒超时清理机制
        this.UTT_TIMEOUT_MS = 20000; // 20秒
        this.cleanupIntervalId = null;
        // 启动定时清理任务（每5秒检查一次）
        this.startCleanupTimer();
    }
    /**
     * 启动定时清理任务
     */
    startCleanupTimer() {
        if (this.cleanupIntervalId) {
            return; // 已经启动
        }
        this.cleanupIntervalId = setInterval(() => {
            this.cleanupExpiredRegistrations();
        }, 5000); // 每5秒检查一次
        logger_1.default.info({
            timeoutMs: this.UTT_TIMEOUT_MS,
            checkIntervalMs: 5000,
        }, 'OriginalJobResultDispatcher: Started cleanup timer for expired utterances');
    }
    /**
     * 停止定时清理任务
     */
    stopCleanupTimer() {
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
            logger_1.default.info({}, 'OriginalJobResultDispatcher: Stopped cleanup timer');
        }
    }
    /**
     * 清理超时的注册信息
     */
    cleanupExpiredRegistrations() {
        const now = Date.now();
        const expiredJobs = [];
        for (const [sessionId, sessionRegistrations] of this.registrations.entries()) {
            for (const [originalJobId, registration] of sessionRegistrations.entries()) {
                // 已完成的无需处理
                if (registration.isFinalized) {
                    continue;
                }
                const idleMs = now - registration.lastActivityAt;
                if (idleMs > this.UTT_TIMEOUT_MS) {
                    expiredJobs.push({ sessionId, originalJobId, idleMs });
                    // 只清理，不触发SR
                    sessionRegistrations.delete(originalJobId);
                    logger_1.default.warn({
                        sessionId,
                        originalJobId,
                        idleMs,
                        startedAt: registration.startedAt,
                        lastActivityAt: registration.lastActivityAt,
                        accumulatedSegmentsCount: registration.accumulatedSegments.length,
                        reason: 'Utterance timed out, cleaning registration (no SR triggered)',
                    }, 'OriginalJobResultDispatcher: Utterance timed out, cleaning registration');
                }
            }
            // 如果session下没有注册信息了，删除session
            if (sessionRegistrations.size === 0) {
                this.registrations.delete(sessionId);
            }
        }
        if (expiredJobs.length > 0) {
            logger_1.default.warn({
                expiredCount: expiredJobs.length,
                expiredJobs: expiredJobs.map(j => ({
                    sessionId: j.sessionId,
                    originalJobId: j.originalJobId,
                    idleMs: j.idleMs,
                })),
            }, 'OriginalJobResultDispatcher: Cleaned up expired utterances');
        }
    }
    /**
     * 注册原始job
     *
     * @param sessionId 会话ID
     * @param originalJobId 原始job ID
     * @param expectedSegmentCount 期望的片段数量（undefined=累积等待，0=立即处理，>0=等待指定数量）
     * @param originalJob 原始job消息
     * @param callback 处理回调
     */
    registerOriginalJob(sessionId, originalJobId, expectedSegmentCount, originalJob, callback) {
        let sessionRegistrations = this.registrations.get(sessionId);
        if (!sessionRegistrations) {
            sessionRegistrations = new Map();
            this.registrations.set(sessionId, sessionRegistrations);
        }
        const now = Date.now();
        sessionRegistrations.set(originalJobId, {
            originalJob,
            callback,
            expectedSegmentCount,
            accumulatedSegments: [],
            accumulatedSegmentsList: [],
            // ✅ 初始化生命周期字段
            startedAt: now,
            lastActivityAt: now,
            isFinalized: false,
        });
        // ✅ TASK-4: 精简日志，只在关键路径记录
        // 注册日志已删除，减少噪声
    }
    /**
     * 添加ASR片段
     *
     * @param sessionId 会话ID
     * @param originalJobId 原始job ID
     * @param asrData ASR数据
     * @returns 是否应该立即处理（达到期望片段数量或finalize）
     */
    async addASRSegment(sessionId, originalJobId, asrData) {
        const sessionRegistrations = this.registrations.get(sessionId);
        if (!sessionRegistrations) {
            logger_1.default.warn({ sessionId, originalJobId }, 'OriginalJobResultDispatcher: Session not found');
            return false;
        }
        const registration = sessionRegistrations.get(originalJobId);
        if (!registration) {
            logger_1.default.warn({ sessionId, originalJobId }, 'OriginalJobResultDispatcher: Original job not registered');
            return false;
        }
        // ✅ 更新生命周期：更新lastActivityAt
        registration.lastActivityAt = Date.now();
        // 累积ASR结果
        registration.accumulatedSegments.push(asrData);
        registration.accumulatedSegmentsList.push(...asrData.asrSegments);
        logger_1.default.debug({
            sessionId,
            originalJobId,
            operation: 'accumulateASRSegment',
            batchIndex: asrData.batchIndex,
            currentAccumulatedCount: registration.accumulatedSegments.length,
            expectedSegmentCount: registration.expectedSegmentCount,
            asrTextLength: asrData.asrText.length,
            asrSegmentsCount: asrData.asrSegments.length,
        }, 'OriginalJobResultDispatcher: [Accumulate] Added ASR segment to accumulation');
        // ✅ TASK-1: 简化并内联shouldProcessNow逻辑
        // 检查是否应该立即处理：仅在收齐expectedSegmentCount时触发
        const shouldProcess = registration.expectedSegmentCount != null &&
            registration.accumulatedSegments.length >= registration.expectedSegmentCount;
        if (shouldProcess) {
            // ✅ 标记为已finalize
            registration.isFinalized = true;
            // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
            const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
                const aIndex = a.batchIndex ?? 0;
                const bIndex = b.batchIndex ?? 0;
                return aIndex - bIndex;
            });
            // ✅ 按排序后的顺序合并文本
            const fullText = sortedSegments.map(s => s.asrText).join(' ');
            logger_1.default.info({
                sessionId,
                originalJobId,
                operation: 'mergeASRText',
                batchCount: sortedSegments.length,
                batchTexts: sortedSegments.map((s, idx) => ({
                    batchIndex: s.batchIndex ?? idx,
                    textLength: s.asrText.length,
                    textPreview: s.asrText.substring(0, 30),
                })),
                mergedTextLength: fullText.length,
                mergedTextPreview: fullText.substring(0, 100),
            }, 'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text');
            // 触发处理回调
            const finalAsrData = {
                originalJobId,
                asrText: fullText,
                asrSegments: registration.accumulatedSegmentsList,
                languageProbabilities: this.mergeLanguageProbabilities(registration.accumulatedSegments),
            };
            await registration.callback(finalAsrData, registration.originalJob);
            // 清除注册信息
            sessionRegistrations.delete(originalJobId);
            if (sessionRegistrations.size === 0) {
                this.registrations.delete(sessionId);
            }
        }
        return shouldProcess;
    }
    /**
     * 强制完成原始job（异常兜底路径）
     *
     * **设计说明**：
     * - 仅作为异常兜底使用（例如少数batch丢失的极端情况）
     * - 正常业务不依赖此函数触发SR，主流程通过addASRSegment触发
     * - 调用方（例如runAsrStep）只在finalize后的"最后安全点"调用一次
     *
     * @param sessionId 会话ID
     * @param originalJobId 原始job ID
     */
    async forceComplete(sessionId, originalJobId) {
        const sessionRegistrations = this.registrations.get(sessionId);
        if (!sessionRegistrations) {
            return; // 已被正常流程清理
        }
        const registration = sessionRegistrations.get(originalJobId);
        if (!registration) {
            return; // 已被正常流程清理
        }
        // ✅ TASK-2: 早期返回防御，避免双回调
        if (registration.isFinalized) {
            return; // 已由addASRSegment正常完成，避免重复触发
        }
        // ✅ 标记为已finalize
        registration.isFinalized = true;
        // 如果有累积的ASR结果，立即处理
        if (registration.accumulatedSegments.length > 0) {
            // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
            const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
                const aIndex = a.batchIndex ?? 0;
                const bIndex = b.batchIndex ?? 0;
                return aIndex - bIndex;
            });
            // ✅ 按排序后的顺序合并文本
            const fullText = sortedSegments.map(s => s.asrText).join(' ');
            logger_1.default.info({
                sessionId,
                originalJobId,
                operation: 'mergeASRText',
                triggerPath: 'forceComplete',
                batchCount: sortedSegments.length,
                batchTexts: sortedSegments.map((s, idx) => ({
                    batchIndex: s.batchIndex ?? idx,
                    textLength: s.asrText.length,
                    textPreview: s.asrText.substring(0, 30),
                })),
                mergedTextLength: fullText.length,
                mergedTextPreview: fullText.substring(0, 100),
            }, 'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text (forceComplete path)');
            const finalAsrData = {
                originalJobId,
                asrText: fullText,
                asrSegments: registration.accumulatedSegmentsList,
                languageProbabilities: this.mergeLanguageProbabilities(registration.accumulatedSegments),
            };
            // ✅ TASK-4: 精简日志，只记录关键信息（forceComplete是fallback路径）
            logger_1.default.info({
                sessionId,
                originalJobId,
                batchCount: registration.accumulatedSegments.length,
                expectedSegmentCount: registration.expectedSegmentCount,
                reason: 'Force complete triggered (fallback path)',
            }, 'OriginalJobResultDispatcher: [SRTrigger] Force complete triggered, triggering semantic repair');
            await registration.callback(finalAsrData, registration.originalJob);
        }
        // 清除注册信息
        sessionRegistrations.delete(originalJobId);
        if (sessionRegistrations.size === 0) {
            this.registrations.delete(sessionId);
        }
    }
    /**
     * 合并语言概率
     */
    mergeLanguageProbabilities(segments) {
        if (segments.length === 0) {
            return undefined;
        }
        // 使用最后一个片段的语言概率（或合并所有片段的概率）
        const lastSegment = segments[segments.length - 1];
        return lastSegment.languageProbabilities;
    }
}
exports.OriginalJobResultDispatcher = OriginalJobResultDispatcher;
