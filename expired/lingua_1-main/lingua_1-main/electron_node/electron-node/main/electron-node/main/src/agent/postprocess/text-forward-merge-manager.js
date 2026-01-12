"use strict";
/**
 * Text Forward Merge Manager
 * 处理PostASR阶段的向前合并和去重逻辑
 *
 * 策略：
 * 1. 如果下一句里有上一句的重复内容，删除重复部分
 * 2. 去重后的文本长度判断（统一使用SemanticRepairScorer的标准：16字符）：
 *    - < 6个字符：直接丢弃
 *    - 6-16个字符：等待与下一句合并（3秒超时）
 *    - > 16个字符：发给语义修复服务进行输出
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextForwardMergeManager = void 0;
const dedup_1 = require("../../aggregator/dedup");
const logger_1 = __importDefault(require("../../logger"));
class TextForwardMergeManager {
    constructor() {
        this.pendingTexts = new Map();
        this.MIN_LENGTH_TO_KEEP = 6; // 最小保留长度：6个字符（太短的文本直接丢弃）
        this.MIN_LENGTH_TO_SEND = 16; // 最小发送长度：16个字符（统一使用SemanticRepairScorer的标准）
        this.WAIT_TIMEOUT_MS = 3000; // 等待超时：3秒
        this.dedupConfig = dedup_1.DEFAULT_DEDUP_CONFIG;
    }
    /**
     * 处理文本：向前合并和去重
     * @param sessionId 会话ID
     * @param currentText 当前ASR文本
     * @param previousText 上一个已提交的文本（用于去重）
     * @param jobId 当前任务ID
     * @param utteranceIndex 当前utterance索引
     * @param isManualCut 是否是手动发送（如果是，6-16字符的文本直接发送给语义修复，不等待合并）
     * @returns 处理结果
     */
    processText(sessionId, currentText, previousText, jobId, utteranceIndex, isManualCut = false) {
        const nowMs = Date.now();
        // 检查是否有待合并的文本（等待超时）
        const pending = this.pendingTexts.get(sessionId);
        if (pending && nowMs >= pending.waitUntil) {
            // 等待超时，处理待合并的文本
            logger_1.default.info({
                sessionId,
                pendingText: pending.text.substring(0, 50),
                pendingLength: pending.text.length,
                waitTimeout: true,
                reason: 'Pending text wait timeout, processing now',
            }, 'TextForwardMergeManager: Pending text wait timeout, processing now');
            this.pendingTexts.delete(sessionId);
            // 超时后，无论文本长度如何，都发送给语义修复服务，跳过过滤
            logger_1.default.info({
                sessionId,
                pendingText: pending.text.substring(0, 50),
                pendingLength: pending.text.length,
                reason: 'Pending text wait timeout, sending to semantic repair regardless of length',
            }, 'TextForwardMergeManager: Pending text wait timeout, sending to semantic repair regardless of length');
            return {
                processedText: pending.text,
                shouldDiscard: false,
                shouldWaitForMerge: false,
                shouldSendToSemanticRepair: true,
                deduped: false,
                dedupChars: 0,
                // 注意：超时处理时，不需要通知GPU仲裁器，因为任务可能已经完成
            };
        }
        // 如果有待合并的文本且未超时，与当前文本合并
        if (pending && nowMs < pending.waitUntil) {
            // 与当前文本去重合并
            const dedupResult = (0, dedup_1.dedupMergePrecise)(pending.text, currentText, this.dedupConfig);
            const mergedText = dedupResult.text;
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
                currentUtteranceIndex: utteranceIndex,
                reason: 'Merged pending text with current text, will notify GPU arbiter to cancel pending utterance tasks',
            }, 'TextForwardMergeManager: Merged pending text with current text, will notify GPU arbiter');
            // 保存待合并文本的utterance索引（用于通知GPU仲裁器）
            const mergedFromPendingUtteranceIndex = pending.utteranceIndex;
            // 清除待合并的文本
            this.pendingTexts.delete(sessionId);
            // 判断合并后的文本长度
            if (mergedText.length < this.MIN_LENGTH_TO_KEEP) {
                // < 6字符：丢弃
                return {
                    processedText: '',
                    shouldDiscard: true,
                    shouldWaitForMerge: false,
                    shouldSendToSemanticRepair: false,
                    deduped: dedupResult.deduped,
                    dedupChars: dedupResult.overlapChars,
                    mergedFromPendingUtteranceIndex, // 通知GPU仲裁器取消待合并文本的任务
                };
            }
            else if (mergedText.length < this.MIN_LENGTH_TO_SEND) {
                // 6-16字符：如果是手动发送，直接发送给语义修复；否则继续等待
                if (isManualCut) {
                    // 手动发送：直接发送给语义修复，不等待合并
                    logger_1.default.info({
                        sessionId,
                        mergedText: mergedText.substring(0, 50),
                        length: mergedText.length,
                        reason: 'Merged text length 6-16, but isManualCut=true, sending to semantic repair directly',
                    }, 'TextForwardMergeManager: Merged text length 6-16, but isManualCut=true, sending to semantic repair directly');
                    return {
                        processedText: mergedText,
                        shouldDiscard: false,
                        shouldWaitForMerge: false,
                        shouldSendToSemanticRepair: true,
                        deduped: dedupResult.deduped,
                        dedupChars: dedupResult.overlapChars,
                        mergedFromPendingUtteranceIndex, // 通知GPU仲裁器取消待合并文本的任务
                    };
                }
                else {
                    // 非手动发送：继续等待（统一使用SemanticRepairScorer的标准：16字符）
                    this.pendingTexts.set(sessionId, {
                        text: mergedText,
                        waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
                        jobId,
                        utteranceIndex,
                    });
                    return {
                        processedText: '',
                        shouldDiscard: false,
                        shouldWaitForMerge: true,
                        shouldSendToSemanticRepair: false,
                        deduped: dedupResult.deduped,
                        dedupChars: dedupResult.overlapChars,
                        mergedFromPendingUtteranceIndex, // 通知GPU仲裁器取消待合并文本的任务
                    };
                }
            }
            else {
                // > 16字符：发送给语义修复（统一使用SemanticRepairScorer的标准）
                return {
                    processedText: mergedText,
                    shouldDiscard: false,
                    shouldWaitForMerge: false,
                    shouldSendToSemanticRepair: true,
                    deduped: dedupResult.deduped,
                    dedupChars: dedupResult.overlapChars,
                    mergedFromPendingUtteranceIndex, // 通知GPU仲裁器取消待合并文本的任务
                };
            }
        }
        // 没有待合并的文本，处理当前文本
        let processedText = currentText;
        let deduped = false;
        let dedupChars = 0;
        // 如果有上一个文本，进行去重
        // 注意：如果去重后文本为空或很短，说明当前文本完全被包含在上一个文本中
        // 这种情况下，上一个文本的utterance索引应该是当前索引-1（假设utterance_index是连续的）
        let mergedFromUtteranceIndex = undefined;
        if (previousText) {
            const dedupResult = (0, dedup_1.dedupMergePrecise)(previousText, currentText, this.dedupConfig);
            processedText = dedupResult.text;
            deduped = dedupResult.deduped;
            dedupChars = dedupResult.overlapChars;
            // 如果去重后文本为空或很短，说明当前文本被合并到上一个文本
            // 需要通知GPU仲裁器取消上一个utterance的任务
            if (deduped && (processedText.length === 0 || processedText.length < this.MIN_LENGTH_TO_KEEP)) {
                // 假设utterance_index是连续的，上一个utterance的索引是当前索引-1
                mergedFromUtteranceIndex = utteranceIndex - 1;
                logger_1.default.info({
                    sessionId,
                    previousText: previousText.substring(0, 50),
                    currentText: currentText.substring(0, 50),
                    processedText: processedText.substring(0, 100),
                    dedupChars,
                    previousUtteranceIndex: mergedFromUtteranceIndex,
                    currentUtteranceIndex: utteranceIndex,
                    reason: 'Current text merged into previous text, will notify GPU arbiter to cancel previous utterance tasks',
                }, 'TextForwardMergeManager: Current text merged into previous, will notify GPU arbiter');
            }
            else if (deduped) {
                logger_1.default.info({
                    sessionId,
                    previousText: previousText.substring(0, 50),
                    currentText: currentText.substring(0, 50),
                    processedText: processedText.substring(0, 100),
                    dedupChars,
                    reason: 'Deduped current text with previous text',
                }, 'TextForwardMergeManager: Deduped current text with previous text');
            }
        }
        // 判断去重后的文本长度
        if (processedText.length < this.MIN_LENGTH_TO_KEEP) {
            // < 6字符：丢弃
            logger_1.default.info({
                sessionId,
                processedText: processedText.substring(0, 50),
                length: processedText.length,
                reason: 'Processed text too short, discarding',
            }, 'TextForwardMergeManager: Processed text too short, discarding');
            return {
                processedText: '',
                shouldDiscard: true,
                shouldWaitForMerge: false,
                shouldSendToSemanticRepair: false,
                deduped,
                dedupChars,
                mergedFromUtteranceIndex, // 如果合并了上一个utterance，通知GPU仲裁器
            };
        }
        else if (processedText.length < this.MIN_LENGTH_TO_SEND) {
            // 6-16字符：如果是手动发送，直接发送给语义修复；否则等待与下一句合并
            if (isManualCut) {
                // 手动发送：直接发送给语义修复，不等待合并
                logger_1.default.info({
                    sessionId,
                    processedText: processedText.substring(0, 50),
                    length: processedText.length,
                    reason: 'Processed text length 6-16, but isManualCut=true, sending to semantic repair directly',
                }, 'TextForwardMergeManager: Processed text length 6-16, but isManualCut=true, sending to semantic repair directly');
                return {
                    processedText,
                    shouldDiscard: false,
                    shouldWaitForMerge: false,
                    shouldSendToSemanticRepair: true,
                    deduped,
                    dedupChars,
                    mergedFromUtteranceIndex, // 如果合并了上一个utterance，通知GPU仲裁器
                };
            }
            else {
                // 非手动发送：等待与下一句合并（统一使用SemanticRepairScorer的标准：16字符）
                this.pendingTexts.set(sessionId, {
                    text: processedText,
                    waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
                    jobId,
                    utteranceIndex,
                });
                logger_1.default.info({
                    sessionId,
                    processedText: processedText.substring(0, 50),
                    length: processedText.length,
                    waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
                    waitMs: this.WAIT_TIMEOUT_MS,
                    reason: 'Processed text length 6-16, waiting for merge with next utterance',
                }, 'TextForwardMergeManager: Processed text length 6-16, waiting for merge');
                return {
                    processedText: '',
                    shouldDiscard: false,
                    shouldWaitForMerge: true,
                    shouldSendToSemanticRepair: false,
                    deduped,
                    dedupChars,
                    mergedFromUtteranceIndex, // 如果合并了上一个utterance，通知GPU仲裁器
                };
            }
        }
        else {
            // > 16字符：发送给语义修复（统一使用SemanticRepairScorer的标准）
            return {
                processedText,
                shouldDiscard: false,
                shouldWaitForMerge: false,
                shouldSendToSemanticRepair: true,
                deduped,
                dedupChars,
                mergedFromUtteranceIndex, // 如果合并了上一个utterance，通知GPU仲裁器
            };
        }
    }
    /**
     * 获取待合并的文本（用于调试）
     */
    getPendingText(sessionId) {
        const pending = this.pendingTexts.get(sessionId);
        return pending ? pending.text : null;
    }
    /**
     * 清除待合并的文本（用于会话结束）
     */
    clearPendingText(sessionId) {
        this.pendingTexts.delete(sessionId);
    }
    /**
     * 清除所有待合并的文本
     */
    clearAllPendingTexts() {
        this.pendingTexts.clear();
    }
}
exports.TextForwardMergeManager = TextForwardMergeManager;
