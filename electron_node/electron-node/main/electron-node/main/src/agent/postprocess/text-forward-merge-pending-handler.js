"use strict";
/**
 * Text Forward Merge - Pending Handler
 * 处理待合并文本的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextForwardMergePendingHandler = void 0;
const dedup_1 = require("../../aggregator/dedup");
const logger_1 = __importDefault(require("../../logger"));
class TextForwardMergePendingHandler {
    constructor(dedupConfig, lengthConfig) {
        this.dedupConfig = dedupConfig;
        this.lengthConfig = lengthConfig;
        this.pendingTexts = new Map();
    }
    /**
     * 检查是否有待合并的文本
     */
    getPending(sessionId) {
        return this.pendingTexts.get(sessionId);
    }
    /**
     * 设置待合并的文本
     */
    setPending(sessionId, pending) {
        this.pendingTexts.set(sessionId, pending);
    }
    /**
     * 清除待合并的文本
     */
    clearPending(sessionId) {
        this.pendingTexts.delete(sessionId);
    }
    /**
     * 处理超时或手动截断的pending文本
     */
    handleTimeoutOrManualCut(pending, currentText, sessionId, nowMs, isManualCut) {
        logger_1.default.info({
            sessionId,
            pendingText: pending.text.substring(0, 50),
            pendingLength: pending.text.length,
            currentText: currentText.substring(0, 50),
            currentLength: currentText.length,
            isManualCut,
            waitTimeout: !isManualCut && nowMs >= pending.waitUntil,
            reason: isManualCut
                ? 'Manual cut detected, will merge pending text with current text if available'
                : 'Pending text wait timeout, will merge with current text if available',
        }, isManualCut
            ? 'TextForwardMergePendingHandler: Manual cut detected, merging'
            : 'TextForwardMergePendingHandler: Pending text timeout, merging');
        // 与当前文本去重合并
        const dedupResult = (0, dedup_1.dedupMergePrecise)(pending.text, currentText, this.dedupConfig);
        const mergedText = dedupResult.deduped
            ? pending.text + dedupResult.text
            : pending.text + currentText;
        logger_1.default.info({
            sessionId,
            pendingText: pending.text.substring(0, 50),
            currentText: currentText.substring(0, 50),
            mergedText: mergedText.substring(0, 100),
            pendingLength: pending.text.length,
            currentLength: currentText.length,
            mergedLength: mergedText.length,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            pendingUtteranceIndex: pending.utteranceIndex,
        }, 'TextForwardMergePendingHandler: Merged pending text with current text');
        return {
            mergedText,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex: pending.utteranceIndex,
        };
    }
    /**
     * 处理待合并文本（未超时）
     */
    handlePendingMerge(pending, currentText, sessionId) {
        const dedupResult = (0, dedup_1.dedupMergePrecise)(pending.text, currentText, this.dedupConfig);
        const mergedText = dedupResult.deduped
            ? pending.text + dedupResult.text
            : pending.text + currentText;
        logger_1.default.info({
            sessionId,
            pendingText: pending.text.substring(0, 50),
            currentText: currentText.substring(0, 50),
            mergedText: mergedText.substring(0, 100),
            pendingLength: pending.text.length,
            currentLength: currentText.length,
            mergedLength: mergedText.length,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            pendingUtteranceIndex: pending.utteranceIndex,
            reason: 'Merged pending text with current text, will notify GPU arbiter to cancel pending utterance tasks',
        }, 'TextForwardMergePendingHandler: Merged pending text with current text');
        return {
            mergedText,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex: pending.utteranceIndex,
        };
    }
    /**
     * 清除所有待合并的文本
     */
    clearAllPending() {
        this.pendingTexts.clear();
    }
}
exports.TextForwardMergePendingHandler = TextForwardMergePendingHandler;
