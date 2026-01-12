"use strict";
/**
 * Aggregator State Utterance Processor
 * 处理 utterance 的预处理：文本去重、时间戳计算、构建 UtteranceInfo
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateUtteranceProcessor = void 0;
const dedup_1 = require("./dedup");
const aggregator_state_utils_1 = require("./aggregator-state-utils");
class AggregatorStateUtteranceProcessor {
    /**
     * 处理 utterance：去重、计算时间戳、构建 UtteranceInfo
     */
    processUtterance(text, segments, langProbs, qualityScore, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered, sessionStartTimeMs, lastUtteranceEndTimeMs) {
        // 先检测并移除完全重复和内部重复
        const processedText = (0, dedup_1.detectInternalRepetition)(text);
        // 计算 utterance 的时间戳（从 segments 推导）
        const utteranceTime = aggregator_state_utils_1.AggregatorStateUtils.calculateUtteranceTime(segments, sessionStartTimeMs, lastUtteranceEndTimeMs);
        const hasMissingSegments = !segments || segments.length === 0;
        // 构建 UtteranceInfo
        const utteranceInfo = {
            text: processedText,
            startMs: utteranceTime.startMs,
            endMs: utteranceTime.endMs,
            lang: {
                top1: langProbs.top1,
                p1: langProbs.p1,
                top2: langProbs.top2,
                p2: langProbs.p2,
            },
            qualityScore,
            isFinal,
            isManualCut,
            isPauseTriggered,
            isTimeoutTriggered,
        }; // 临时使用any，因为UtteranceInfo接口需要更新
        return {
            processedText,
            utteranceInfo,
            utteranceTime,
            hasMissingSegments,
        };
    }
}
exports.AggregatorStateUtteranceProcessor = AggregatorStateUtteranceProcessor;
