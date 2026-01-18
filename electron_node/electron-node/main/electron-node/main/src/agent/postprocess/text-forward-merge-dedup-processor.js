"use strict";
/**
 * Text Forward Merge - Dedup Processor
 * 处理文本去重逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextForwardMergeDedupProcessor = void 0;
const dedup_1 = require("../../aggregator/dedup");
const logger_1 = __importDefault(require("../../logger"));
class TextForwardMergeDedupProcessor {
    constructor(dedupConfig, minLengthToKeep) {
        this.dedupConfig = dedupConfig;
        this.minLengthToKeep = minLengthToKeep;
    }
    /**
     * 合并两个文本并去重
     */
    mergePendingWithCurrent(pendingText, currentText, sessionId) {
        const dedupResult = (0, dedup_1.dedupMergePrecise)(pendingText, currentText, this.dedupConfig);
        const mergedText = dedupResult.deduped
            ? pendingText + dedupResult.text
            : pendingText + currentText;
        logger_1.default.info({
            sessionId,
            pendingText: pendingText.substring(0, 50),
            currentText: currentText.substring(0, 50),
            mergedText: mergedText.substring(0, 100),
            pendingLength: pendingText.length,
            currentLength: currentText.length,
            mergedLength: mergedText.length,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
        }, 'TextForwardMergeDedupProcessor: Merged pending text with current text');
        return {
            processedText: mergedText,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
        };
    }
    /**
     * 用前一个文本对当前文本去重
     */
    dedupWithPrevious(previousText, currentText, utteranceIndex, sessionId) {
        const dedupResult = (0, dedup_1.dedupMergePrecise)(previousText, currentText, this.dedupConfig);
        const processedText = dedupResult.text;
        const deduped = dedupResult.deduped;
        const dedupChars = dedupResult.overlapChars;
        let mergedFromUtteranceIndex;
        // 如果去重后文本为空或很短，说明当前文本被合并到上一个文本
        if (deduped && (processedText.length === 0 || processedText.length < this.minLengthToKeep)) {
            mergedFromUtteranceIndex = utteranceIndex - 1;
            logger_1.default.info({
                sessionId,
                previousText: previousText.substring(0, 50),
                currentText: currentText.substring(0, 50),
                processedText: processedText.substring(0, 100),
                dedupChars,
                previousUtteranceIndex: mergedFromUtteranceIndex,
                currentUtteranceIndex: utteranceIndex,
            }, 'TextForwardMergeDedupProcessor: Current text merged into previous');
        }
        else if (deduped) {
            logger_1.default.info({
                sessionId,
                previousText: previousText.substring(0, 50),
                currentText: currentText.substring(0, 50),
                processedText: processedText.substring(0, 100),
                dedupChars,
            }, 'TextForwardMergeDedupProcessor: Deduped current text with previous text');
        }
        return {
            processedText,
            deduped,
            dedupChars,
            mergedFromUtteranceIndex,
        };
    }
}
exports.TextForwardMergeDedupProcessor = TextForwardMergeDedupProcessor;
