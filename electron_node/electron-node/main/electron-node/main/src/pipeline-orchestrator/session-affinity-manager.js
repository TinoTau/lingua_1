"use strict";
/**
 * Session Affinity Manager
 * 管理超时finalize的sessionId->nodeId映射，确保长语音的后续job发送到同一个节点
 *
 * 策略：
 * 1. 手动finalize或pause finalize：可以随机分配（不需要session affinity）
 * 2. 超时finalize：记录sessionId->nodeId的映射，确保后续job发送到同一个节点
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionAffinityManager = void 0;
const logger_1 = __importDefault(require("../logger"));
class SessionAffinityManager {
    constructor() {
        // 当前节点ID
        this.nodeId = null;
        // 存储超时finalize的sessionId->nodeId映射
        this.timeoutFinalizeSessions = new Map();
        // TTL：30分钟（超时finalize的session映射保留30分钟）
        this.SESSION_TTL_MS = 30 * 60 * 1000;
        // 清理间隔：5分钟
        this.CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
        this.cleanupTimer = null;
        // 启动定期清理
        this.startCleanup();
    }
    static getInstance() {
        if (!SessionAffinityManager.instance) {
            SessionAffinityManager.instance = new SessionAffinityManager();
        }
        return SessionAffinityManager.instance;
    }
    /**
     * 设置当前节点ID
     * @param nodeId 节点ID
     */
    setNodeId(nodeId) {
        this.nodeId = nodeId;
    }
    /**
     * 获取当前节点ID
     * @returns 节点ID
     */
    getNodeId() {
        return this.nodeId;
    }
    /**
     * 记录超时finalize的sessionId->nodeId映射
     * @param sessionId 会话ID
     * @param nodeId 节点ID（如果未提供，使用当前节点ID）
     */
    recordTimeoutFinalize(sessionId, nodeId) {
        const targetNodeId = nodeId || this.nodeId;
        if (!targetNodeId) {
            logger_1.default.warn({ sessionId }, 'SessionAffinityManager: Cannot record timeout finalize, nodeId not set');
            return;
        }
        const nowMs = Date.now();
        this.timeoutFinalizeSessions.set(sessionId, {
            nodeId: targetNodeId,
            createdAt: nowMs,
            lastAccessAt: nowMs,
        });
        logger_1.default.info({
            sessionId,
            nodeId: targetNodeId,
            totalSessions: this.timeoutFinalizeSessions.size,
            createdAt: new Date(nowMs).toISOString(),
            ttlMs: this.SESSION_TTL_MS,
            reason: 'Timeout/MaxDuration finalize - recording sessionId->nodeId mapping for session affinity',
        }, 'SessionAffinityManager: [SessionAffinity] Recorded timeout finalize session mapping - subsequent jobs should route to this node');
    }
    /**
     * 获取超时finalize的节点ID
     * @param sessionId 会话ID
     * @returns 节点ID，如果不存在则返回null
     */
    getNodeIdForTimeoutFinalize(sessionId) {
        const mapping = this.timeoutFinalizeSessions.get(sessionId);
        if (!mapping) {
            return null;
        }
        // 更新最后访问时间
        mapping.lastAccessAt = Date.now();
        logger_1.default.debug({
            sessionId,
            nodeId: mapping.nodeId,
            ageMs: Date.now() - mapping.createdAt,
        }, 'SessionAffinityManager: Retrieved nodeId for timeout finalize session');
        return mapping.nodeId;
    }
    /**
     * 检查session是否应该使用session affinity
     * @param sessionId 会话ID
     * @returns 是否应该使用session affinity
     */
    shouldUseSessionAffinity(sessionId) {
        return this.timeoutFinalizeSessions.has(sessionId);
    }
    /**
     * 清除session映射（用于手动finalize或pause finalize）
     * @param sessionId 会话ID
     */
    clearSessionMapping(sessionId) {
        if (this.timeoutFinalizeSessions.delete(sessionId)) {
            logger_1.default.info({
                sessionId,
                remainingSessions: this.timeoutFinalizeSessions.size,
                reason: 'Manual/pause finalize - cleared session mapping, subsequent jobs can use random assignment',
            }, 'SessionAffinityManager: [SessionAffinity] Cleared session mapping (manual/pause finalize)');
        }
    }
    /**
     * 启动定期清理过期映射
     */
    startCleanup() {
        if (this.cleanupTimer) {
            return;
        }
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredSessions();
        }, this.CLEANUP_INTERVAL_MS);
        logger_1.default.info({
            cleanupIntervalMs: this.CLEANUP_INTERVAL_MS,
            sessionTtlMs: this.SESSION_TTL_MS,
        }, 'SessionAffinityManager: Started cleanup timer');
    }
    /**
     * 清理过期的session映射
     */
    cleanupExpiredSessions() {
        const nowMs = Date.now();
        let cleanedCount = 0;
        for (const [sessionId, mapping] of this.timeoutFinalizeSessions.entries()) {
            const ageMs = nowMs - mapping.lastAccessAt;
            if (ageMs > this.SESSION_TTL_MS) {
                this.timeoutFinalizeSessions.delete(sessionId);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            logger_1.default.info({
                cleanedCount,
                remainingSessions: this.timeoutFinalizeSessions.size,
            }, 'SessionAffinityManager: Cleaned up expired session mappings');
        }
    }
    /**
     * 停止清理定时器
     */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
            logger_1.default.info({}, 'SessionAffinityManager: Stopped cleanup timer');
        }
    }
    /**
     * 获取统计信息
     */
    getStats() {
        const nowMs = Date.now();
        const sessions = Array.from(this.timeoutFinalizeSessions.entries()).map(([sessionId, mapping]) => ({
            sessionId,
            nodeId: mapping.nodeId,
            ageMs: nowMs - mapping.createdAt,
            lastAccessAgeMs: nowMs - mapping.lastAccessAt,
        }));
        return {
            totalSessions: this.timeoutFinalizeSessions.size,
            sessions,
        };
    }
}
exports.SessionAffinityManager = SessionAffinityManager;
SessionAffinityManager.instance = null;
