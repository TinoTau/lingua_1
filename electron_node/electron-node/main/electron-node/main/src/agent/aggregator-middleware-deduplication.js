"use strict";
/**
 * Aggregator Middleware Deduplication Handler
 * 处理重复文本检测相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeduplicationHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
class DeduplicationHandler {
    constructor() {
        this.lastSentText = new Map();
        this.lastSentTextAccessTime = new Map();
        this.LAST_SENT_TEXT_TTL_MS = 10 * 60 * 1000; // 10 分钟 TTL
        this.LAST_SENT_TEXT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟清理一次
    }
    /**
     * 规范化文本（去除所有空白字符）
     */
    normalizeText(text) {
        return text.replace(/\s+/g, ' ').trim();
    }
    /**
     * 计算文本相似度（简单的字符重叠度）
     */
    calculateTextSimilarity(text1, text2) {
        if (text1.length === 0 && text2.length === 0)
            return 1.0;
        if (text1.length === 0 || text2.length === 0)
            return 0.0;
        // 使用较短的文本作为基准
        const shorter = text1.length < text2.length ? text1 : text2;
        const longer = text1.length >= text2.length ? text1 : text2;
        // 检查较短文本是否完全包含在较长文本中
        if (longer.includes(shorter)) {
            return shorter.length / longer.length;
        }
        // 计算字符重叠度（简化版）
        let matches = 0;
        const minLen = Math.min(text1.length, text2.length);
        for (let i = 0; i < minLen; i++) {
            if (text1[i] === text2[i]) {
                matches++;
            }
        }
        return matches / Math.max(text1.length, text2.length);
    }
    /**
     * 检查是否与上次发送的文本重复
     */
    isDuplicate(sessionId, text, jobId, utteranceIndex) {
        const lastSent = this.lastSentText.get(sessionId);
        if (!lastSent) {
            return { isDuplicate: false };
        }
        const normalizedCurrent = this.normalizeText(text);
        const normalizedLastSent = this.normalizeText(lastSent);
        // 完全相同的文本
        if (normalizedCurrent === normalizedLastSent && normalizedCurrent.length > 0) {
            logger_1.default.info({
                jobId,
                sessionId,
                utteranceIndex,
                originalASRText: text,
                normalizedText: normalizedCurrent,
                lastSentText: lastSent,
                reason: 'Duplicate text detected (same as last sent)',
            }, 'AggregatorMiddleware: Filtering duplicate text, returning empty result (no NMT/TTS)');
            return { isDuplicate: true, reason: 'same_as_last_sent' };
        }
        // 检查当前文本是否是前一个utterance的子串
        if (normalizedLastSent.length > 0 && normalizedCurrent.length > 0) {
            if (normalizedCurrent.length >= 3 && normalizedLastSent.includes(normalizedCurrent)) {
                logger_1.default.info({
                    jobId,
                    sessionId,
                    utteranceIndex,
                    originalASRText: text,
                    normalizedText: normalizedCurrent,
                    lastSentText: lastSent,
                    normalizedLastSent: normalizedLastSent,
                    reason: 'Current text is a substring of last sent text, filtering to avoid duplicate output',
                }, 'AggregatorMiddleware: Filtering substring duplicate text, returning empty result (no NMT/TTS)');
                return { isDuplicate: true, reason: 'substring_of_last_sent' };
            }
            // 检查前一个utterance是否是当前文本的子串
            if (normalizedLastSent.length >= 3 && normalizedCurrent.includes(normalizedLastSent)) {
                logger_1.default.info({
                    jobId,
                    sessionId,
                    utteranceIndex,
                    originalASRText: text,
                    normalizedText: normalizedCurrent,
                    lastSentText: lastSent,
                    normalizedLastSent: normalizedLastSent,
                    reason: 'Last sent text is a substring of current text, this should not happen, but filtering to avoid duplicate output',
                }, 'AggregatorMiddleware: Filtering reverse substring duplicate text, returning empty result (no NMT/TTS)');
                return { isDuplicate: true, reason: 'last_sent_is_substring' };
            }
            // 检查相似度
            const similarity = this.calculateTextSimilarity(normalizedCurrent, normalizedLastSent);
            if (similarity > 0.95) {
                logger_1.default.warn({
                    jobId,
                    sessionId,
                    utteranceIndex,
                    text: text.substring(0, 50),
                    lastSentText: lastSent.substring(0, 50),
                    similarity,
                }, 'Skipping duplicate text (high similarity with last sent)');
                return { isDuplicate: true, reason: 'high_similarity' };
            }
        }
        return { isDuplicate: false };
    }
    /**
     * 获取最后发送的文本
     */
    getLastSentText(sessionId) {
        return this.lastSentText.get(sessionId);
    }
    /**
     * 设置最后发送的文本（在成功发送后调用）
     */
    setLastSentText(sessionId, text) {
        const normalized = this.normalizeText(text);
        this.lastSentText.set(sessionId, normalized);
        this.lastSentTextAccessTime.set(sessionId, Date.now());
    }
    /**
     * 清理过期的 lastSentText 记录
     */
    cleanupExpiredLastSentText() {
        const now = Date.now();
        const expiredSessions = [];
        for (const [sessionId, lastAccess] of this.lastSentTextAccessTime.entries()) {
            if (now - lastAccess > this.LAST_SENT_TEXT_TTL_MS) {
                expiredSessions.push(sessionId);
            }
        }
        for (const sessionId of expiredSessions) {
            this.lastSentText.delete(sessionId);
            this.lastSentTextAccessTime.delete(sessionId);
        }
        if (expiredSessions.length > 0) {
            logger_1.default.info({
                count: expiredSessions.length,
                remainingCount: this.lastSentText.size,
            }, 'AggregatorMiddleware: Cleaned up expired lastSentText entries');
        }
    }
    /**
     * 清理指定会话的记录
     */
    removeSession(sessionId) {
        this.lastSentText.delete(sessionId);
        this.lastSentTextAccessTime.delete(sessionId);
    }
    /**
     * 清理所有记录
     */
    clearAll() {
        this.lastSentText.clear();
        this.lastSentTextAccessTime.clear();
    }
}
exports.DeduplicationHandler = DeduplicationHandler;
