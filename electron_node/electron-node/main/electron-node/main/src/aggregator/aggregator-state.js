"use strict";
/* Aggregator State: 会话态管理
   维护每个 session 的 Aggregator 状态，包括：
   - 待提交的文本（pending text）
   - 上一个 utterance 信息
   - 会话时间轴
   - Tail buffer
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorState = void 0;
const aggregator_decision_1 = require("./aggregator-decision");
const dedup_1 = require("./dedup");
const tail_carry_1 = require("./tail-carry");
const logger_1 = __importDefault(require("../logger"));
const aggregator_state_context_1 = require("./aggregator-state-context");
const aggregator_state_text_processor_1 = require("./aggregator-state-text-processor");
const aggregator_state_merge_group_manager_1 = require("./aggregator-state-merge-group-manager");
const aggregator_state_commit_handler_1 = require("./aggregator-state-commit-handler");
const aggregator_state_utterance_processor_1 = require("./aggregator-state-utterance-processor");
const aggregator_state_action_decider_1 = require("./aggregator-state-action-decider");
const aggregator_state_pending_manager_1 = require("./aggregator-state-pending-manager");
const aggregator_state_commit_executor_1 = require("./aggregator-state-commit-executor");
class AggregatorState {
    constructor(sessionId, mode = 'offline', tuning, dedupConfig, tailCarryConfig) {
        // 状态
        this.pendingText = '';
        this.lastUtterance = null;
        this.lastCommitTsMs = 0;
        this.tailBuffer = '';
        // 会话时间轴
        this.sessionStartTimeMs = 0;
        this.lastUtteranceEndTimeMs = 0;
        // 合并组状态（由 mergeGroupManager 管理，这里保留用于向后兼容和状态同步）
        this.mergeGroupStartUtterance = null;
        this.mergeGroupStartTimeMs = 0;
        this.accumulatedAudioDurationMs = 0;
        // 指标
        this.metrics = {
            commitCount: 0,
            mergeCount: 0,
            newStreamCount: 0,
            dedupCount: 0,
            dedupCharsRemoved: 0,
            tailCarryUsage: 0,
            veryShortUttRate: 0,
            missingGapCount: 0,
            commitLatencyMs: 0,
        };
        this.sessionId = sessionId;
        this.mode = mode;
        this.tuning = tuning || (0, aggregator_decision_1.defaultTuning)(mode);
        this.dedupConfig = dedupConfig || dedup_1.DEFAULT_DEDUP_CONFIG;
        this.tailCarryConfig = tailCarryConfig || tail_carry_1.DEFAULT_TAIL_CARRY_CONFIG;
        this.sessionStartTimeMs = Date.now();
        this.lastCommitTsMs = Date.now();
        this.contextManager = new aggregator_state_context_1.AggregatorStateContextManager();
        this.textProcessor = new aggregator_state_text_processor_1.AggregatorStateTextProcessor(this.dedupConfig, this.tailCarryConfig);
        this.mergeGroupManager = new aggregator_state_merge_group_manager_1.AggregatorStateMergeGroupManager();
        this.commitHandler = new aggregator_state_commit_handler_1.AggregatorStateCommitHandler(this.mode, this.tuning, this.tailCarryConfig);
        this.utteranceProcessor = new aggregator_state_utterance_processor_1.AggregatorStateUtteranceProcessor();
        this.actionDecider = new aggregator_state_action_decider_1.AggregatorStateActionDecider(this.mode, this.tuning);
        this.pendingManager = new aggregator_state_pending_manager_1.AggregatorStatePendingManager(this.tailCarryConfig, this.mergeGroupManager);
        this.commitExecutor = new aggregator_state_commit_executor_1.AggregatorStateCommitExecutor(this.commitHandler, this.mergeGroupManager, this.contextManager);
    }
    /**
     * 处理新的 utterance
     * @param text ASR 文本
     * @param segments ASR segments（用于计算时间戳）
     * @param langProbs 语言概率信息
     * @param qualityScore 质量分数
     * @param isFinal 是否为 final
     * @param isManualCut 是否为手动截断
     * @returns 处理结果
     */
    processUtterance(text, segments, langProbs, qualityScore, isFinal = false, isManualCut = false, isPauseTriggered = false, isTimeoutTriggered = false, hasPendingSecondHalfMerged = false) {
        const nowMs = Date.now();
        // 使用 utterance 处理器进行预处理
        const utteranceResult = this.utteranceProcessor.processUtterance(text, segments, langProbs, qualityScore, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered, this.sessionStartTimeMs, this.lastUtteranceEndTimeMs);
        // 修复：如果合并了pendingSecondHalf，将标志传递给utteranceInfo
        if (hasPendingSecondHalfMerged) {
            utteranceResult.utteranceInfo.hasPendingSecondHalfMerged = true;
        }
        const curr = utteranceResult.utteranceInfo;
        const startMs = utteranceResult.utteranceTime.startMs;
        const endMs = utteranceResult.utteranceTime.endMs;
        const gapMs = utteranceResult.utteranceTime.gapMs;
        // 更新会话开始时间
        if (utteranceResult.utteranceTime.newSessionStartTimeMs !== this.sessionStartTimeMs) {
            this.sessionStartTimeMs = utteranceResult.utteranceTime.newSessionStartTimeMs;
        }
        // 更新指标
        if (utteranceResult.hasMissingSegments) {
            this.metrics.missingGapCount++;
        }
        // 使用动作决策器决定流动作
        const action = this.actionDecider.decideAction(this.lastUtterance, curr);
        // 更新指标
        if (action === 'MERGE') {
            this.metrics.mergeCount++;
        }
        else {
            this.metrics.newStreamCount++;
        }
        // 使用合并组管理器判断是否是合并组的第一个
        const currentMergeGroupState = this.mergeGroupManager.getState();
        const isFirstInMergedGroup = this.mergeGroupManager.checkIsFirstInMergedGroup(action, this.pendingText, this.lastUtterance);
        // 添加调试日志
        if (action === 'MERGE') {
            logger_1.default.info({
                text: text.substring(0, 50),
                pendingText: this.pendingText.substring(0, 50),
                hasMergeGroupStart: currentMergeGroupState.mergeGroupStartUtterance !== null,
                hasLastUtterance: this.lastUtterance !== null,
                lastUtteranceText: this.lastUtterance?.text.substring(0, 50),
                isFirstInMergedGroup,
            }, 'AggregatorState: MERGE action, checking isFirstInMergedGroup');
        }
        // 使用文本处理器处理文本合并和去重
        const textProcessResult = this.textProcessor.processText(action, utteranceResult.processedText, this.lastUtterance, this.tailBuffer);
        const processedText = textProcessResult.processedText;
        let deduped = textProcessResult.deduped;
        let dedupChars = textProcessResult.dedupChars;
        // 更新指标
        if (deduped) {
            this.metrics.dedupCount++;
            this.metrics.dedupCharsRemoved += dedupChars;
        }
        if (textProcessResult.tailBufferCleared) {
            this.tailBuffer = '';
            this.metrics.tailCarryUsage++;
        }
        // 使用 pending manager 处理文本合并和状态管理
        // 修复：在NEW_STREAM时，先保存之前的pendingText，用于提交
        const previousPendingText = action === 'NEW_STREAM' ? this.pendingText : '';
        let pendingUpdateResult;
        if (action === 'MERGE' && this.lastUtterance) {
            pendingUpdateResult = this.pendingManager.handleMerge(processedText, this.pendingText, curr, startMs, endMs, isFirstInMergedGroup);
        }
        else {
            pendingUpdateResult = this.pendingManager.handleNewStream(processedText, this.pendingText, this.tailBuffer);
            // 修复：在NEW_STREAM时，如果之前的pendingText存在，先提交之前的文本
            // 这样可以确保之前的文本被记录到recentCommittedText中，用于去重
            if (previousPendingText && previousPendingText.trim().length > 0) {
                // 使用临时提交处理器判断是否需要提交之前的文本
                const previousMergeGroupState = this.mergeGroupManager.getState();
                const previousCommitDecision = this.commitHandler.decideCommit('NEW_STREAM', previousPendingText, this.lastCommitTsMs, nowMs, previousMergeGroupState.mergeGroupStartTimeMs, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered);
                // 如果之前的文本应该提交，先提交它
                if (previousCommitDecision.shouldCommit) {
                    const previousCommitResult = this.commitExecutor.executeCommit(previousPendingText, this.tailBuffer, isFinal, isManualCut, qualityScore, gapMs, previousCommitDecision.commitByManualCut, previousCommitDecision.commitByTimeout);
                    const previousCommitText = previousCommitResult.commitText;
                    if (previousCommitText && previousCommitText.trim().length > 0) {
                        // 更新上下文（记录到recentCommittedText，用于去重）
                        this.contextManager.updateRecentCommittedText(previousCommitText);
                        logger_1.default.info({
                            text: previousCommitText.substring(0, 50),
                            textLength: previousCommitText.length,
                            action: 'NEW_STREAM',
                            reason: 'Committed previous pendingText before starting new stream, for deduplication',
                        }, 'AggregatorState: Committed previous pendingText in NEW_STREAM for deduplication');
                    }
                }
            }
        }
        // 更新 pending text 和 tail buffer
        this.pendingText = pendingUpdateResult.newPendingText;
        this.tailBuffer = pendingUpdateResult.newTailBuffer;
        // 同步合并组状态
        if (pendingUpdateResult.mergeGroupStateSynced) {
            const syncedState = this.pendingManager.syncMergeGroupState();
            this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
            this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
            this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
        }
        // 更新状态
        this.lastUtterance = curr;
        this.lastUtteranceEndTimeMs = endMs;
        if (this.sessionStartTimeMs === 0) {
            this.sessionStartTimeMs = startMs;
        }
        // 使用提交处理器判断是否需要提交
        const mergeGroupState = this.mergeGroupManager.getState();
        const commitDecision = this.commitHandler.decideCommit(action, this.pendingText, this.lastCommitTsMs, nowMs, mergeGroupState.mergeGroupStartTimeMs, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered);
        let shouldCommitNow = commitDecision.shouldCommit;
        const isLastInMergedGroup = commitDecision.isLastInMergedGroup;
        const commitByManualCut = commitDecision.commitByManualCut;
        const commitByTimeout = commitDecision.commitByTimeout;
        // 如果收到手动发送/3秒静音标识，清空合并组状态
        if (commitByManualCut && action === 'MERGE') {
            this.mergeGroupManager.clearMergeGroup();
            // 同步状态
            const newState = this.mergeGroupManager.getState();
            this.mergeGroupStartUtterance = newState.mergeGroupStartUtterance;
            this.mergeGroupStartTimeMs = newState.mergeGroupStartTimeMs;
            this.accumulatedAudioDurationMs = newState.accumulatedAudioDurationMs;
        }
        // 记录提交条件的判断（用于调试）
        this.commitHandler.logCommitDecision(action, text, commitDecision, gapMs, this.accumulatedAudioDurationMs, mergeGroupState.mergeGroupStartTimeMs, this.pendingText.length, this.lastCommitTsMs, nowMs, isFinal, isManualCut);
        // 计算首次输出延迟
        if (this.metrics.commitCount === 0 && shouldCommitNow) {
            this.metrics.commitLatencyMs = nowMs - this.sessionStartTimeMs;
        }
        // 如果需要 commit，使用提交执行器执行提交
        let commitText = '';
        if (shouldCommitNow && this.pendingText) {
            const commitResult = this.commitExecutor.executeCommit(this.pendingText, this.tailBuffer, isFinal, isManualCut, qualityScore, gapMs, commitByManualCut, commitByTimeout);
            commitText = commitResult.commitText;
            this.tailBuffer = commitResult.newTailBuffer;
            if (commitResult.tailCarryUsed) {
                this.metrics.tailCarryUsage++;
            }
            this.pendingText = '';
            this.lastCommitTsMs = nowMs;
            this.metrics.commitCount++;
            // 同步合并组状态
            const syncedState = this.commitExecutor.syncMergeGroupState();
            this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
            this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
            this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
        }
        else if (isFinal && this.pendingText) {
            // 如果是 final 但没有触发 commit（可能是因为 pending 文本太短），强制提交
            // 确保 final 时所有文本都被提交
            const commitResult = this.commitExecutor.executeCommit(this.pendingText, this.tailBuffer, true, // isFinal
            isManualCut, qualityScore, gapMs, commitByManualCut, commitByTimeout);
            commitText = commitResult.commitText;
            this.tailBuffer = commitResult.newTailBuffer;
            if (commitResult.tailCarryUsed) {
                this.metrics.tailCarryUsage++;
            }
            this.pendingText = '';
            this.lastCommitTsMs = nowMs;
            this.metrics.commitCount++;
            // 标记为应该提交
            shouldCommitNow = true;
            // 同步合并组状态
            const syncedState = this.commitExecutor.syncMergeGroupState();
            this.mergeGroupStartUtterance = syncedState.mergeGroupStartUtterance;
            this.mergeGroupStartTimeMs = syncedState.mergeGroupStartTimeMs;
            this.accumulatedAudioDurationMs = syncedState.accumulatedAudioDurationMs;
        }
        // 新逻辑：判断是否是合并组中的最后一个
        // 如果是 MERGE 且触发提交，则当前 utterance 是最后一个
        // 提交可能由以下条件触发：
        // 1. 手动发送（commitByManualCut）
        // 2. 10秒超时（commitByTimeout）
        // 3. 原有提交条件（shouldCommit 函数返回 true）
        // 4. isFinal（最终结果）
        // isLastInMergedGroup 已经在上面根据 shouldCommitNow 设置
        // 添加调试日志
        if (action === 'MERGE') {
            logger_1.default.info(// 改为 info 级别，确保日志输出
            {
                text: text.substring(0, 50),
                isLastInMergedGroup,
                shouldCommitNow,
                commitByManualCut,
                commitByTimeout,
                hasCommitText: !!commitText,
                commitTextLength: commitText.length,
            }, 'AggregatorState: MERGE action, isLastInMergedGroup determination');
        }
        return {
            text: commitText,
            shouldCommit: shouldCommitNow,
            action,
            isFirstInMergedGroup: action === 'MERGE' ? isFirstInMergedGroup : undefined, // 保留用于兼容
            isLastInMergedGroup: action === 'MERGE' ? isLastInMergedGroup : undefined, // 新逻辑
            metrics: {
                dedupCount: deduped ? 1 : 0,
                dedupCharsRemoved: dedupChars,
            },
        };
    }
    /**
     * 强制 flush（stop/leave 时调用）
     */
    flush() {
        let textToFlush = '';
        if (this.pendingText) {
            // flush 时不保留 tail，全部输出
            textToFlush = this.pendingText;
            if (this.tailBuffer) {
                textToFlush = this.tailBuffer + textToFlush;
                this.tailBuffer = '';
            }
            this.pendingText = '';
            this.lastCommitTsMs = Date.now();
            this.metrics.commitCount++;
        }
        else if (this.tailBuffer) {
            // 如果只有 tail buffer，也输出
            textToFlush = this.tailBuffer;
            this.tailBuffer = '';
            this.metrics.commitCount++;
        }
        return textToFlush;
    }
    /**
     * 获取指标
     */
    getMetrics() {
        return { ...this.metrics };
    }
    /**
     * 重置状态（用于测试或会话重启）
     */
    reset() {
        this.pendingText = '';
        this.lastUtterance = null;
        this.lastCommitTsMs = Date.now();
        this.tailBuffer = '';
        this.sessionStartTimeMs = 0;
        this.lastUtteranceEndTimeMs = 0;
        this.metrics = {
            commitCount: 0,
            mergeCount: 0,
            newStreamCount: 0,
            dedupCount: 0,
            dedupCharsRemoved: 0,
            tailCarryUsage: 0,
            veryShortUttRate: 0,
            missingGapCount: 0,
            commitLatencyMs: 0,
        };
        // 清理翻译文本和上下文缓存
        this.contextManager.clearContext();
        // 重置合并组状态
        this.mergeGroupManager.reset();
        // 同步状态
        const newState = this.mergeGroupManager.getState();
        this.mergeGroupStartUtterance = newState.mergeGroupStartUtterance;
        this.mergeGroupStartTimeMs = newState.mergeGroupStartTimeMs;
        this.accumulatedAudioDurationMs = newState.accumulatedAudioDurationMs;
    }
    /**
     * 获取上一个 utterance 的翻译文本（检查是否过期）
     */
    getLastTranslatedText() {
        return this.contextManager.getLastTranslatedText();
    }
    /**
     * 设置上一个 utterance 的翻译文本
     */
    setLastTranslatedText(translatedText) {
        this.contextManager.setLastTranslatedText(translatedText);
    }
    /**
     * 清理翻译文本（NEW_STREAM 时可选调用）
     */
    clearLastTranslatedText() {
        this.contextManager.clearLastTranslatedText();
    }
    /**
     * S1/S2: 获取最近提交的文本
     */
    getRecentCommittedText() {
        return this.contextManager.getRecentCommittedText();
    }
    /**
     * S1/S2: 获取最近关键词
     */
    getRecentKeywords() {
        return this.contextManager.getRecentKeywords();
    }
    /**
     * S1/S2: 设置用户关键词
     */
    setUserKeywords(keywords) {
        this.contextManager.setUserKeywords(keywords);
    }
    /**
     * S1/S2: 更新关键词（从最近文本中提取）
     */
    updateKeywordsFromRecent() {
        this.contextManager.updateKeywordsFromRecent();
    }
    /**
     * S1/S2: 获取上一次提交的质量分数
     */
    getLastCommitQuality() {
        return this.contextManager.getLastCommitQuality();
    }
}
exports.AggregatorState = AggregatorState;
