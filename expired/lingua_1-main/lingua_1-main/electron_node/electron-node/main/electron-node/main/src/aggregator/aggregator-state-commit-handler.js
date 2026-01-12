"use strict";
/**
 * Aggregator State Commit Handler
 * 处理提交逻辑（判断何时提交、提取文本等）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateCommitHandler = void 0;
const aggregator_decision_1 = require("./aggregator-decision");
const tail_carry_1 = require("./tail-carry");
const logger_1 = __importDefault(require("../logger"));
class AggregatorStateCommitHandler {
    constructor(mode, tuning, tailCarryConfig) {
        this.mode = mode;
        this.tuning = tuning;
        this.tailCarryConfig = tailCarryConfig;
        this.TIMEOUT_THRESHOLD_MS = 10000; // 10秒
    }
    /**
     * 判断是否需要提交
     */
    decideCommit(action, pendingText, lastCommitTsMs, nowMs, mergeGroupStartTimeMs, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered) {
        // 1. 手动发送或3秒静音触发：用户点击发送按钮或3秒静音，立即处理并强制提交
        const commitByManualCut = isManualCut || isPauseTriggered;
        // 2. 10秒超时触发：从NEW_STREAM开始计时，如果超过10秒，自动提交
        const commitByTimeout = isTimeoutTriggered ||
            (action === 'MERGE' && mergeGroupStartTimeMs > 0 &&
                (nowMs - mergeGroupStartTimeMs) >= this.TIMEOUT_THRESHOLD_MS);
        let shouldCommitResult;
        let isLastInMergedGroup = false;
        if (commitByManualCut && action === 'MERGE') {
            // 强制提交当前合并组
            shouldCommitResult = true;
            isLastInMergedGroup = true;
        }
        else {
            // 组合所有提交条件（优先级：手动发送/静音 > 10秒超时 > 原有条件）
            shouldCommitResult = (0, aggregator_decision_1.shouldCommit)(pendingText, lastCommitTsMs, nowMs, this.mode, this.tuning) || commitByManualCut || commitByTimeout || isFinal;
            // 如果是MERGE且触发提交，标记为合并组的最后一个
            if (action === 'MERGE' && shouldCommitResult) {
                isLastInMergedGroup = true;
            }
        }
        return {
            shouldCommit: shouldCommitResult,
            commitByManualCut,
            commitByTimeout,
            isLastInMergedGroup,
        };
    }
    /**
     * 提取提交文本（处理tail buffer）
     */
    extractCommitText(pendingText, tailBuffer, isFinal, isManualCut) {
        let commitText = '';
        let newTailBuffer = tailBuffer;
        let tailCarryUsed = false;
        if (isFinal || isManualCut) {
            // 如果是 isFinal，不保留 tail，全部输出（确保完整）
            commitText = pendingText;
            // 如果有 tail buffer，也包含进去
            if (tailBuffer) {
                commitText = tailBuffer + commitText;
                newTailBuffer = '';
            }
        }
        else {
            // 非 final，保留 tail
            commitText = (0, tail_carry_1.removeTail)(pendingText, this.tailCarryConfig);
            const tail = (0, tail_carry_1.extractTail)(pendingText, this.tailCarryConfig);
            if (tail) {
                newTailBuffer = tail;
                tailCarryUsed = true;
            }
        }
        return {
            commitText,
            newTailBuffer,
            tailCarryUsed,
        };
    }
    /**
     * 记录提交条件的判断（用于调试）
     */
    logCommitDecision(action, text, decision, gapMs, accumulatedAudioDurationMs, mergeGroupStartTimeMs, pendingTextLength, lastCommitTsMs, nowMs, isFinal, isManualCut) {
        if (action === 'MERGE') {
            logger_1.default.info({
                text: text.substring(0, 50),
                shouldCommit: decision.shouldCommit,
                commitByManualCut: decision.commitByManualCut,
                commitByTimeout: decision.commitByTimeout,
                gapMs,
                accumulatedAudioDurationMs,
                mergeGroupStartTimeMs,
                timeSinceMergeGroupStart: mergeGroupStartTimeMs > 0 ? (nowMs - mergeGroupStartTimeMs) : 0,
                pendingTextLength,
                lastCommitTsMs,
                nowMs,
                elapsedSinceLastCommit: nowMs - lastCommitTsMs,
                isFinal,
                isManualCut,
            }, 'AggregatorStateCommitHandler: MERGE action, checking commit conditions');
        }
    }
}
exports.AggregatorStateCommitHandler = AggregatorStateCommitHandler;
