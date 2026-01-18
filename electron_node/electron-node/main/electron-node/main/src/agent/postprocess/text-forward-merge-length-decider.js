"use strict";
/**
 * Text Forward Merge - Length Decider
 * 根据文本长度决定处理动作
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextForwardMergeLengthDecider = void 0;
const logger_1 = __importDefault(require("../../logger"));
class TextForwardMergeLengthDecider {
    constructor(config) {
        this.config = config;
    }
    /**
     * 根据文本长度和是否手动截断决定处理动作
     */
    decide(text, isManualCut, sessionId, nowMs) {
        const length = text.length;
        // < minLengthToKeep：丢弃
        if (length < this.config.minLengthToKeep) {
            logger_1.default.info({
                sessionId,
                text: text.substring(0, 50),
                length,
                minLengthToKeep: this.config.minLengthToKeep,
            }, 'TextForwardMergeLengthDecider: Text too short, discarding');
            return {
                shouldDiscard: true,
                shouldWaitForMerge: false,
                shouldSendToSemanticRepair: false,
                shouldSetPending: false,
            };
        }
        // minLengthToKeep - minLengthToSend：等待合并或手动发送
        if (length <= this.config.minLengthToSend) {
            if (isManualCut) {
                return {
                    shouldDiscard: false,
                    shouldWaitForMerge: false,
                    shouldSendToSemanticRepair: true,
                    shouldSetPending: false,
                };
            }
            else {
                return {
                    shouldDiscard: false,
                    shouldWaitForMerge: true,
                    shouldSendToSemanticRepair: false,
                    shouldSetPending: true,
                    pendingWaitUntil: nowMs + this.config.waitTimeoutMs,
                };
            }
        }
        // minLengthToSend - maxLengthToWait：等待确认或手动发送
        if (length <= this.config.maxLengthToWait) {
            if (isManualCut) {
                return {
                    shouldDiscard: false,
                    shouldWaitForMerge: false,
                    shouldSendToSemanticRepair: true,
                    shouldSetPending: false,
                };
            }
            else {
                return {
                    shouldDiscard: false,
                    shouldWaitForMerge: true,
                    shouldSendToSemanticRepair: false,
                    shouldSetPending: true,
                    pendingWaitUntil: nowMs + this.config.waitTimeoutMs,
                };
            }
        }
        // > maxLengthToWait：强制发送
        return {
            shouldDiscard: false,
            shouldWaitForMerge: false,
            shouldSendToSemanticRepair: true,
            shouldSetPending: false,
        };
    }
}
exports.TextForwardMergeLengthDecider = TextForwardMergeLengthDecider;
