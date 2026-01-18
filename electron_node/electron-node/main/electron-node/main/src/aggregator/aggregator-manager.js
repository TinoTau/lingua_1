"use strict";
/* Aggregator Manager: 管理多个 session 的 Aggregator 状态
   支持 TTL/LRU 回收过期会话
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorManager = void 0;
const aggregator_state_1 = require("./aggregator-state");
const logger_1 = __importDefault(require("../logger"));
const DEFAULT_CONFIG = {
    ttlMs: 5 * 60 * 1000, // 5 分钟
    maxSessions: 500, // 降低最大会话数（从 1000 降低到 500，减少内存占用）
};
class AggregatorManager {
    constructor(config = {}) {
        this.states = new Map();
        this.lastAccessTime = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // 定期清理过期会话（缩短清理间隔，更及时清理）
        setInterval(() => this.cleanupExpiredSessions(), 30000); // 每30秒清理一次（从60秒缩短）
    }
    /**
     * 获取或创建 session 的 Aggregator 状态
     *
     * 关键：每个 session_id 都有独立的状态，确保不同 session 的 utterance 不会互相影响
     */
    getOrCreateState(sessionId, mode = 'offline', tuning) {
        // 验证 sessionId 不为空
        if (!sessionId || sessionId.trim() === '') {
            logger_1.default.error({ sessionId }, 'Invalid sessionId in getOrCreateState');
            throw new Error('sessionId cannot be empty');
        }
        let state = this.states.get(sessionId);
        if (!state) {
            // 检查是否超过最大会话数
            if (this.states.size >= this.config.maxSessions) {
                this.evictLRU();
            }
            state = new aggregator_state_1.AggregatorState(sessionId, mode, tuning);
            this.states.set(sessionId, state);
            logger_1.default.debug({
                sessionId,
                mode,
                totalSessions: this.states.size
            }, 'Created new AggregatorState (session isolated)');
        }
        this.lastAccessTime.set(sessionId, Date.now());
        return state;
    }
    /**
     * 处理 utterance
     */
    processUtterance(sessionId, text, segments, langProbs, qualityScore, isFinal = false, isManualCut = false, mode = 'offline', isPauseTriggered = false, isTimeoutTriggered = false) {
        const state = this.getOrCreateState(sessionId, mode);
        return state.processUtterance(text, segments, langProbs, qualityScore, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered);
    }
    /**
     * 强制 flush session
     */
    flush(sessionId) {
        const state = this.states.get(sessionId);
        if (!state)
            return '';
        const flushed = state.flush();
        if (flushed) {
            logger_1.default.debug({ sessionId, flushedLength: flushed.length }, 'Flushed AggregatorState');
        }
        return flushed;
    }
    /**
     * 清理 session（显式关闭）
     */
    removeSession(sessionId) {
        const state = this.states.get(sessionId);
        if (state) {
            // 先 flush
            const flushed = state.flush();
            if (flushed) {
                logger_1.default.debug({ sessionId, flushedLength: flushed.length }, 'Flushed before removing session');
            }
            // 清理上下文缓存（停止说话时清理）
            state.clearLastTranslatedText();
            this.states.delete(sessionId);
            this.lastAccessTime.delete(sessionId);
            logger_1.default.debug({ sessionId }, 'Removed AggregatorState and cleared context cache');
        }
    }
    /**
     * 获取 session 的指标
     */
    getMetrics(sessionId) {
        const state = this.states.get(sessionId);
        return state ? state.getMetrics() : null;
    }
    /**
     * 清理过期会话
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        const expiredSessions = [];
        for (const [sessionId, lastAccess] of this.lastAccessTime.entries()) {
            if (now - lastAccess > this.config.ttlMs) {
                expiredSessions.push(sessionId);
            }
        }
        for (const sessionId of expiredSessions) {
            this.removeSession(sessionId);
            logger_1.default.debug({ sessionId }, 'Removed expired AggregatorState');
        }
        if (expiredSessions.length > 0) {
            logger_1.default.info({ count: expiredSessions.length, totalSessions: this.states.size }, 'Cleaned up expired AggregatorState sessions');
        }
    }
    /**
     * LRU 回收：移除最久未使用的会话
     */
    evictLRU() {
        if (this.lastAccessTime.size === 0)
            return;
        // 找到最久未使用的会话
        let oldestSessionId = '';
        let oldestTime = Infinity;
        for (const [sessionId, lastAccess] of this.lastAccessTime.entries()) {
            if (lastAccess < oldestTime) {
                oldestTime = lastAccess;
                oldestSessionId = sessionId;
            }
        }
        if (oldestSessionId) {
            this.removeSession(oldestSessionId);
            logger_1.default.debug({ sessionId: oldestSessionId }, 'Evicted LRU AggregatorState');
        }
    }
    /**
     * 获取所有会话的统计信息
     */
    getStats() {
        return {
            totalSessions: this.states.size,
            activeSessions: this.states.size,
        };
    }
    /**
     * 获取上一个 utterance 的翻译文本（带1分钟过期）
     */
    getLastTranslatedText(sessionId) {
        const state = this.states.get(sessionId);
        if (!state) {
            return null;
        }
        return state.getLastTranslatedText();
    }
    /**
     * 设置上一个 utterance 的翻译文本（带1分钟过期）
     */
    setLastTranslatedText(sessionId, translatedText) {
        const state = this.states.get(sessionId);
        if (state) {
            state.setLastTranslatedText(translatedText);
        }
    }
    /**
     * 清理翻译文本（NEW_STREAM 时可选调用）
     */
    clearLastTranslatedText(sessionId) {
        const state = this.states.get(sessionId);
        if (state) {
            state.clearLastTranslatedText();
        }
    }
    /**
     * 获取上一个utterance的已提交文本（用于NMT服务的context_text）
     *
     * 修复：只按utteranceIndex顺序选择最近一条已提交的完整文本
     * 不再包含任何基于文本内容的heuristic（包含关系、长度差等）
     *
     * @param sessionId 会话ID
     * @param currentUtteranceIndex 当前utterance的索引
     * @returns 上一个utterance的文本，如果没有则返回null
     */
    getLastCommittedText(sessionId, currentUtteranceIndex) {
        const state = this.states.get(sessionId);
        if (!state) {
            return null;
        }
        return state.getLastCommittedText(currentUtteranceIndex);
    }
    /**
     * 更新最后一个提交的文本（用于语义修复后更新）
     */
    updateLastCommittedTextAfterRepair(sessionId, utteranceIndex, originalText, repairedText) {
        const state = this.states.get(sessionId);
        if (!state) {
            return;
        }
        state.updateLastCommittedTextAfterRepair(utteranceIndex, originalText, repairedText);
    }
}
exports.AggregatorManager = AggregatorManager;
