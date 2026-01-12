"use strict";
/**
 * Aggregator State Action Decider
 * 决定流动作：MERGE 还是 NEW_STREAM
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateActionDecider = void 0;
const aggregator_decision_1 = require("./aggregator-decision");
const logger_1 = __importDefault(require("../logger"));
class AggregatorStateActionDecider {
    constructor(mode, tuning) {
        this.mode = mode;
        this.tuning = tuning;
    }
    /**
     * 决定流动作：merge 还是 new_stream
     * 关键逻辑：
     * 1. 如果当前utterance合并了pendingSecondHalf，应该标记为MERGE（因为这是上一个utterance的延续）
     * 2. 如果上一个utterance有手动发送/3秒静音标识，且当前utterance没有合并pendingSecondHalf，当前应该是NEW_STREAM
     *    因为上一个utterance已经被强制提交，当前应该是新的流
     */
    decideAction(lastUtterance, currentUtterance) {
        // 修复：如果当前utterance合并了pendingSecondHalf，应该标记为MERGE
        // 因为pendingSecondHalf是上一个utterance的后半部分，应该与当前utterance合并
        if (currentUtterance.hasPendingSecondHalfMerged) {
            logger_1.default.info({
                text: currentUtterance.text.substring(0, 50),
                lastUtteranceText: lastUtterance?.text.substring(0, 50),
                reason: 'Current utterance merged pendingSecondHalf, forcing MERGE to continue previous utterance',
            }, 'AggregatorStateActionDecider: Forcing MERGE due to pendingSecondHalf merge');
            return 'MERGE';
        }
        if (lastUtterance && (lastUtterance.isManualCut || lastUtterance.isPauseTriggered)) {
            // 上一个utterance有手动发送/3秒静音标识，当前应该是NEW_STREAM
            logger_1.default.info({
                text: currentUtterance.text.substring(0, 50),
                lastUtteranceText: lastUtterance.text.substring(0, 50),
                lastUtteranceIsManualCut: lastUtterance.isManualCut,
                reason: 'Last utterance had manual cut or pause trigger, starting new stream',
            }, 'AggregatorStateActionDecider: Forcing NEW_STREAM due to last utterance trigger');
            return 'NEW_STREAM';
        }
        else {
            // 正常决策
            return (0, aggregator_decision_1.decideStreamAction)(lastUtterance, currentUtterance, this.mode, this.tuning);
        }
    }
}
exports.AggregatorStateActionDecider = AggregatorStateActionDecider;
