"use strict";
/**
 * Aggregator State Pending Manager
 * 管理 pending text 和状态更新（MERGE 和 NEW_STREAM 的处理）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStatePendingManager = void 0;
const tail_carry_1 = require("./tail-carry");
const logger_1 = __importDefault(require("../logger"));
class AggregatorStatePendingManager {
    constructor(tailCarryConfig, mergeGroupManager) {
        this.tailCarryConfig = tailCarryConfig;
        this.mergeGroupManager = mergeGroupManager;
    }
    /**
     * 处理 MERGE 动作：合并文本到 pending text，管理合并组状态
     */
    handleMerge(processedText, currentPendingText, currentUtterance, startMs, endMs, isFirstInMergedGroup) {
        // 合并到 pending text
        const newPendingText = currentPendingText + (currentPendingText ? ' ' : '') + processedText;
        // 管理合并组状态
        if (isFirstInMergedGroup) {
            this.mergeGroupManager.startMergeGroup(currentUtterance, startMs, endMs);
        }
        else {
            this.mergeGroupManager.accumulateDuration(startMs, endMs);
        }
        return {
            newPendingText,
            newTailBuffer: '', // MERGE 时不改变 tailBuffer
            mergeGroupStateSynced: true,
        };
    }
    /**
     * 处理 NEW_STREAM 动作：清空状态，开始新的流
     */
    handleNewStream(processedText, currentPendingText, currentTailBuffer) {
        let newTailBuffer = currentTailBuffer;
        // NEW_STREAM: 先提交之前的 pending text
        if (currentPendingText) {
            // 提交时移除 tail
            const textToCommit = (0, tail_carry_1.removeTail)(currentPendingText, this.tailCarryConfig);
            const tail = (0, tail_carry_1.extractTail)(currentPendingText, this.tailCarryConfig);
            if (tail) {
                newTailBuffer = tail;
            }
            // 注意：这里应该触发 commit，但为了简化，我们在 shouldCommit 中处理
        }
        // 开始新的 stream，清空合并组起始标志和累积时长
        // 重要：NEW_STREAM 时清空 tailBuffer，因为新句子不应该保留上一个句子的 tail
        // tailBuffer 只应该在 MERGE 时使用，用于去重
        newTailBuffer = '';
        this.mergeGroupManager.clearMergeGroup();
        logger_1.default.info({
            text: processedText.substring(0, 50),
            clearedTailBuffer: true,
        }, 'AggregatorStatePendingManager: NEW_STREAM, cleared tailBuffer');
        return {
            newPendingText: processedText,
            newTailBuffer,
            mergeGroupStateSynced: true,
        };
    }
    /**
     * 同步合并组状态（从 manager 同步到外部状态）
     */
    syncMergeGroupState() {
        const state = this.mergeGroupManager.getState();
        return {
            mergeGroupStartUtterance: state.mergeGroupStartUtterance,
            mergeGroupStartTimeMs: state.mergeGroupStartTimeMs,
            accumulatedAudioDurationMs: state.accumulatedAudioDurationMs,
        };
    }
}
exports.AggregatorStatePendingManager = AggregatorStatePendingManager;
