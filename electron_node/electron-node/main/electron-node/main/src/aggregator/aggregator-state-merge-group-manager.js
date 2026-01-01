"use strict";
/**
 * Aggregator State Merge Group Manager
 * 管理合并组状态（跟踪合并组的开始、结束、累积时长等）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateMergeGroupManager = void 0;
const logger_1 = __importDefault(require("../logger"));
class AggregatorStateMergeGroupManager {
    constructor() {
        this.mergeGroupStartUtterance = null;
        this.mergeGroupStartTimeMs = 0;
        this.accumulatedAudioDurationMs = 0;
    }
    /**
     * 判断是否是合并组中的第一个utterance
     */
    checkIsFirstInMergedGroup(action, pendingText, lastUtterance) {
        // 关键逻辑：
        // 1. 如果 action="MERGE" 且 pendingText 为空 且 mergeGroupStartUtterance 为 null，说明这是新合并组的开始
        // 2. 如果 action="MERGE" 但 pendingText 不为空，说明之前已经有 utterance 被合并了，当前 utterance 不是第一个
        // 3. 如果 action="MERGE" 但 mergeGroupStartUtterance 已存在，说明这是后续被合并的 utterance
        // 4. 如果 action="MERGE" 但 lastUtterance 不存在，说明这是第一个 utterance，不能是合并组
        // 5. 重要：如果 pendingText 为空且 mergeGroupStartUtterance 为 null，说明之前的合并组已经完成（已提交），当前 utterance 是新合并组的开始
        return action === 'MERGE' &&
            pendingText === '' &&
            this.mergeGroupStartUtterance === null &&
            lastUtterance !== null;
    }
    /**
     * 开始新的合并组
     */
    startMergeGroup(utterance, startMs, endMs) {
        this.mergeGroupStartUtterance = utterance;
        this.mergeGroupStartTimeMs = startMs;
        this.accumulatedAudioDurationMs = endMs - startMs;
        logger_1.default.info({
            text: utterance.text.substring(0, 50),
            isFirstInMergedGroup: true,
            mergeGroupStartTimeMs: this.mergeGroupStartTimeMs,
            initialAccumulatedDurationMs: this.accumulatedAudioDurationMs,
        }, 'AggregatorStateMergeGroupManager: Starting new merge group');
    }
    /**
     * 累加合并组中的音频时长
     */
    accumulateDuration(startMs, endMs) {
        const currentUtteranceDurationMs = endMs - startMs;
        this.accumulatedAudioDurationMs += currentUtteranceDurationMs;
    }
    /**
     * 清空合并组状态
     */
    clearMergeGroup() {
        if (this.mergeGroupStartUtterance) {
            logger_1.default.info({
                mergeGroupStartText: this.mergeGroupStartUtterance.text.substring(0, 50),
                accumulatedDurationMs: this.accumulatedAudioDurationMs,
            }, 'AggregatorStateMergeGroupManager: Clearing merge group');
        }
        this.mergeGroupStartUtterance = null;
        this.mergeGroupStartTimeMs = 0;
        this.accumulatedAudioDurationMs = 0;
    }
    /**
     * 获取合并组状态
     */
    getState() {
        return {
            mergeGroupStartUtterance: this.mergeGroupStartUtterance,
            mergeGroupStartTimeMs: this.mergeGroupStartTimeMs,
            accumulatedAudioDurationMs: this.accumulatedAudioDurationMs,
        };
    }
    /**
     * 重置状态
     */
    reset() {
        this.clearMergeGroup();
    }
}
exports.AggregatorStateMergeGroupManager = AggregatorStateMergeGroupManager;
