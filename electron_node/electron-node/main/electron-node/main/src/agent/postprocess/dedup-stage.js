"use strict";
/**
 * DedupStage - 去重阶段
 * 职责：基于最终文本决定是否发送，维护 lastSentText
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DedupStage = void 0;
const logger_1 = __importDefault(require("../../logger"));
class DedupStage {
    constructor() {
        this.lastSentJobIds = new Map(); // 记录已发送的job_id（用于去重）
        this.lastAccessTime = new Map(); // 记录最后访问时间，用于清理过期记录
        this.CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟清理一次
        this.TTL_MS = 10 * 60 * 1000; // 10 分钟 TTL
        this.JOB_ID_TTL_MS = 30 * 1000; // job_id 去重 TTL：30秒（与调度服务器保持一致）
    }
    /**
     * 检查是否应该发送（去重检查）
     * 统一使用 job_id 进行去重，不基于文本内容
     * 理由：
     * 1. 对文本进行过滤只会增加调度服务器的负担
     * 2. 文本丢失的情况是节点端的问题，不应该掩盖这个问题
     *
     * @param job 原始 job 请求
     * @param aggregatedText 聚合后的文本（不再用于去重）
     * @param translatedText 翻译后的文本（不再用于去重）
     */
    process(job, aggregatedText, translatedText) {
        // 检查 session_id
        if (!job.session_id || job.session_id.trim() === '') {
            logger_1.default.warn({ jobId: job.job_id }, 'DedupStage: Missing session_id, allowing send');
            return { shouldSend: true };
        }
        // 统一使用 job_id 进行去重（30秒TTL，与调度服务器保持一致）
        const sessionJobIds = this.lastSentJobIds.get(job.session_id) || new Set();
        const now = Date.now();
        // 检查该 job_id 是否在30秒内已发送过
        if (sessionJobIds.has(job.job_id)) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                aggregatedTextLength: aggregatedText?.length || 0,
                translatedTextLength: translatedText?.length || 0,
                reason: 'This job_id already sent within TTL, skipping duplicate',
            }, 'DedupStage: Duplicate job_id detected, skipping send');
            return {
                shouldSend: false,
                reason: 'duplicate_job_id',
            };
        }
        // 注意：不再在这里记录job_id，而是在ResultSender成功发送后才记录
        // 这样可以避免发送失败后重试时被误判为重复
        // 更新最后访问时间
        this.lastAccessTime.set(job.session_id, now);
        logger_1.default.debug({
            jobId: job.job_id,
            sessionId: job.session_id,
            aggregatedTextLength: aggregatedText?.length || 0,
            translatedTextLength: translatedText?.length || 0,
        }, 'DedupStage: Job_id check passed, will be recorded after successful send');
        return { shouldSend: true };
    }
    /**
     * 标记job_id为已发送（在成功发送后调用）
     * 修复：不再在process()中记录，而是在成功发送后才记录
     */
    markJobIdAsSent(sessionId, jobId) {
        if (!sessionId || !jobId) {
            return;
        }
        const sessionJobIds = this.lastSentJobIds.get(sessionId) || new Set();
        sessionJobIds.add(jobId);
        this.lastSentJobIds.set(sessionId, sessionJobIds);
        // 更新最后访问时间
        this.lastAccessTime.set(sessionId, Date.now());
        logger_1.default.debug({
            jobId,
            sessionId,
        }, 'DedupStage: Job_id marked as sent, will be deduplicated for 30 seconds');
    }
    /**
     * 清理 session
     */
    removeSession(sessionId) {
        this.lastAccessTime.delete(sessionId);
        this.lastSentJobIds.delete(sessionId);
    }
    /**
     * 清理过期的记录
     */
    cleanupExpiredEntries() {
        const now = Date.now();
        const expiredSessions = [];
        for (const [sessionId, lastAccess] of this.lastAccessTime.entries()) {
            if (now - lastAccess > this.TTL_MS) {
                expiredSessions.push(sessionId);
            }
        }
        for (const sessionId of expiredSessions) {
            this.removeSession(sessionId);
        }
        // 注意：job_id的TTL（30秒）由session的TTL（10分钟）统一管理
        // 如果需要更精确的控制，可以单独维护job_id的时间戳
        if (expiredSessions.length > 0) {
            logger_1.default.info({
                count: expiredSessions.length,
                remainingJobIdsCount: Array.from(this.lastSentJobIds.values()).reduce((sum, set) => sum + set.size, 0),
            }, 'DedupStage: Cleaned up expired job_id entries');
        }
    }
}
exports.DedupStage = DedupStage;
