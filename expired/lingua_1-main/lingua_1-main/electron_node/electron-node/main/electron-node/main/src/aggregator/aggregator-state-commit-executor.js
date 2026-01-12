"use strict";
/**
 * Aggregator State Commit Executor
 * 执行提交操作：提取文本、更新上下文、清空合并组状态等
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateCommitExecutor = void 0;
const logger_1 = __importDefault(require("../logger"));
class AggregatorStateCommitExecutor {
    constructor(commitHandler, mergeGroupManager, contextManager) {
        this.commitHandler = commitHandler;
        this.mergeGroupManager = mergeGroupManager;
        this.contextManager = contextManager;
    }
    /**
     * 执行提交操作
     */
    executeCommit(pendingText, tailBuffer, isFinal, isManualCut, qualityScore, gapMs, commitByManualCut, commitByTimeout) {
        // 使用提交处理器提取文本
        const commitTextResult = this.commitHandler.extractCommitText(pendingText, tailBuffer, isFinal, isManualCut);
        // 更新上下文
        this.contextManager.updateRecentCommittedText(commitTextResult.commitText);
        this.contextManager.setLastCommitQuality(qualityScore);
        // 清空合并组状态
        const mergeGroupStateBeforeClear = this.mergeGroupManager.getState();
        if (mergeGroupStateBeforeClear.mergeGroupStartUtterance) {
            logger_1.default.info({
                text: commitTextResult.commitText.substring(0, 50),
                mergeGroupStartText: mergeGroupStateBeforeClear.mergeGroupStartUtterance.text.substring(0, 50),
                accumulatedDurationMs: mergeGroupStateBeforeClear.accumulatedAudioDurationMs,
                commitByManualCut: commitByManualCut,
                commitByTimeout: commitByTimeout,
                gapMs: gapMs,
                commitTextLength: commitTextResult.commitText.length,
            }, 'AggregatorStateCommitExecutor: Clearing mergeGroupStartUtterance after commit');
        }
        this.mergeGroupManager.clearMergeGroup();
        return {
            commitText: commitTextResult.commitText,
            newTailBuffer: commitTextResult.newTailBuffer,
            tailCarryUsed: commitTextResult.tailCarryUsed,
            shouldCommit: true,
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
exports.AggregatorStateCommitExecutor = AggregatorStateCommitExecutor;
