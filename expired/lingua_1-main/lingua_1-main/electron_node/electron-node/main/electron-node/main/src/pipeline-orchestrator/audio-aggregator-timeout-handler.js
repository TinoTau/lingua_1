"use strict";
/**
 * Audio Aggregator - Timeout Handler
 * 超时处理逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTimeoutSplit = handleTimeoutSplit;
const logger_1 = __importDefault(require("../logger"));
/**
 * 处理超时切割
 */
function handleTimeoutSplit(job, buffer, aggregatedAudio, audioUtils, sampleRate, bytesPerSample, splitHangoverMs, secondarySplitThresholdMs, nowMs) {
    const sessionId = job.session_id;
    // 找到最长停顿并分割
    const splitResult = audioUtils.findLongestPauseAndSplit(aggregatedAudio);
    if (splitResult && splitResult.splitPosition > 0 && splitResult.splitPosition < aggregatedAudio.length) {
        // 优化：应用Hangover - 对前半句额外保留SPLIT_HANGOVER_MS的音频
        const hangoverBytes = Math.floor((splitHangoverMs / 1000) * sampleRate * bytesPerSample);
        const hangoverEnd = Math.min(splitResult.splitPosition + hangoverBytes, aggregatedAudio.length);
        const firstHalfWithHangover = aggregatedAudio.slice(0, hangoverEnd);
        const secondHalfAfterHangover = aggregatedAudio.slice(hangoverEnd);
        logger_1.default.info({
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            originalSplitPosition: splitResult.splitPosition,
            hangoverMs: splitHangoverMs,
            hangoverBytes,
            hangoverEnd,
            firstHalfDurationMs: (firstHalfWithHangover.length / bytesPerSample / sampleRate) * 1000,
            secondHalfDurationMs: (secondHalfAfterHangover.length / bytesPerSample / sampleRate) * 1000,
            longestPauseMs: splitResult.longestPauseMs,
            hadPendingSecondHalf: !!buffer.pendingSecondHalf,
            hangoverPurpose: 'Improve ASR accuracy and enable better text deduplication',
        }, `AudioAggregator: Timeout triggered, split audio at longest pause with ${splitHangoverMs}ms hangover. First half ready for ASR, second half buffered. Hangover helps ASR accuracy and creates overlap for deduplication.`);
        // 优化：检查前半句是否仍然过长，如果是则进行二级切割
        const firstHalfDurationMs = (firstHalfWithHangover.length / bytesPerSample / sampleRate) * 1000;
        let finalFirstHalf = firstHalfWithHangover;
        let finalSecondHalf = secondHalfAfterHangover;
        if (firstHalfDurationMs > secondarySplitThresholdMs) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                firstHalfDurationMs,
                threshold: secondarySplitThresholdMs,
            }, 'AudioAggregator: First half still too long, attempting secondary split');
            const secondarySplit = audioUtils.findLongestPauseAndSplit(firstHalfWithHangover);
            if (secondarySplit && secondarySplit.splitPosition > 0 && secondarySplit.splitPosition < firstHalfWithHangover.length) {
                // 二级切割成功
                const secondaryFirstHalf = firstHalfWithHangover.slice(0, secondarySplit.splitPosition);
                const secondarySecondHalf = firstHalfWithHangover.slice(secondarySplit.splitPosition);
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId,
                    utteranceIndex: job.utterance_index,
                    secondarySplitPosition: secondarySplit.splitPosition,
                    secondaryFirstHalfDurationMs: (secondaryFirstHalf.length / bytesPerSample / sampleRate) * 1000,
                    secondarySecondHalfDurationMs: (secondarySecondHalf.length / bytesPerSample / sampleRate) * 1000,
                }, 'AudioAggregator: Secondary split successful');
                // 将二级切割的后半句也加入pendingSecondHalf（在原始后半句之前）
                if (secondHalfAfterHangover.length > 0) {
                    const combinedSecondHalf = Buffer.alloc(secondarySecondHalf.length + secondHalfAfterHangover.length);
                    secondarySecondHalf.copy(combinedSecondHalf, 0);
                    secondHalfAfterHangover.copy(combinedSecondHalf, secondarySecondHalf.length);
                    finalSecondHalf = combinedSecondHalf;
                }
                else {
                    finalSecondHalf = secondarySecondHalf;
                }
                finalFirstHalf = secondaryFirstHalf;
            }
            else {
                // 二级切割失败，使用原始前半句
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId,
                    utteranceIndex: job.utterance_index,
                    reason: 'Secondary split failed, using original first half',
                }, 'AudioAggregator: Secondary split failed');
            }
        }
        logger_1.default.info({
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            firstHalfDurationMs: (finalFirstHalf.length / bytesPerSample / sampleRate) * 1000,
            secondHalfDurationMs: (finalSecondHalf.length / bytesPerSample / sampleRate) * 1000,
            secondHalfLength: finalSecondHalf.length,
            pendingSecondHalfCreatedAt: nowMs,
        }, 'AudioAggregator: Timeout split completed, second half saved to pendingSecondHalf');
        return {
            firstHalf: finalFirstHalf,
            secondHalf: finalSecondHalf,
            shouldKeepBuffer: true,
        };
    }
    else {
        // 优化：找不到静音段时，使用兜底策略 - 寻找能量最低的连续区间
        logger_1.default.warn({
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            totalDurationMs: buffer.totalDurationMs,
            reason: 'No pause found in audio, attempting fallback split',
        }, 'AudioAggregator: Timeout triggered but no pause found, attempting fallback split');
        const fallbackSplit = audioUtils.findLowestEnergyInterval(aggregatedAudio);
        if (fallbackSplit) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                fallbackSplitPosition: fallbackSplit.end,
                fallbackFirstHalfDurationMs: (fallbackSplit.end / bytesPerSample / sampleRate) * 1000,
                fallbackSecondHalfDurationMs: ((aggregatedAudio.length - fallbackSplit.end) / bytesPerSample / sampleRate) * 1000,
            }, 'AudioAggregator: Fallback split successful');
            const firstHalf = aggregatedAudio.slice(0, fallbackSplit.end);
            const secondHalf = aggregatedAudio.slice(fallbackSplit.end);
            logger_1.default.info({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                firstHalfDurationMs: (firstHalf.length / bytesPerSample / sampleRate) * 1000,
                secondHalfDurationMs: (secondHalf.length / bytesPerSample / sampleRate) * 1000,
                secondHalfLength: secondHalf.length,
                pendingSecondHalfCreatedAt: nowMs,
            }, 'AudioAggregator: Fallback split successful, second half saved to pendingSecondHalf');
            return {
                firstHalf,
                secondHalf,
                shouldKeepBuffer: true,
            };
        }
        else {
            // 兜底策略也失败，直接返回完整音频
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                totalDurationMs: buffer.totalDurationMs,
                reason: 'Fallback split also failed, using full audio without splitting',
            }, 'AudioAggregator: Timeout triggered but fallback split failed, using full audio');
            return {
                firstHalf: aggregatedAudio,
                secondHalf: Buffer.alloc(0),
                shouldKeepBuffer: false,
            };
        }
    }
}
