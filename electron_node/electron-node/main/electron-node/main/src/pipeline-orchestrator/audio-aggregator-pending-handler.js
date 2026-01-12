"use strict";
/**
 * Audio Aggregator - Pending Second Half Handler
 * 处理保留的后半句音频
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePendingSecondHalf = handlePendingSecondHalf;
const logger_1 = __importDefault(require("../logger"));
/**
 * 处理保留的后半句音频
 */
function handlePendingSecondHalf(job, buffer, currentAudio, currentDurationMs, sampleRate, bytesPerSample, pendingSecondHalfTtlMs, pendingSecondHalfMaxDurationMs, nowMs) {
    const sessionId = job.session_id;
    // 如果有保留的后半句，先与当前音频合并
    if (buffer.pendingSecondHalf) {
        // 优化：检查TTL和长度上限
        const pendingAge = buffer.pendingSecondHalfCreatedAt
            ? nowMs - buffer.pendingSecondHalfCreatedAt
            : 0;
        const pendingDurationMs = (buffer.pendingSecondHalf.length / bytesPerSample / sampleRate) * 1000;
        const shouldFlushPending = pendingAge > pendingSecondHalfTtlMs ||
            pendingDurationMs > pendingSecondHalfMaxDurationMs;
        if (shouldFlushPending) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                pendingAge,
                pendingDurationMs,
                reason: pendingAge > pendingSecondHalfTtlMs ? 'TTL exceeded' : 'Max duration exceeded',
            }, 'AudioAggregator: Flushing pending second half due to TTL or max duration');
            // 将pendingSecondHalf作为独立音频处理，不合并
            // 这里我们将其添加到当前音频之前
            const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
            buffer.pendingSecondHalf.copy(mergedAudio, 0);
            currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
            currentAudio = mergedAudio;
            currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
            buffer.pendingSecondHalf = undefined;
            buffer.pendingSecondHalfCreatedAt = undefined;
        }
        else {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                pendingSecondHalfLength: buffer.pendingSecondHalf.length,
                currentAudioLength: currentAudio.length,
                pendingAge,
            }, 'AudioAggregator: Merging pending second half with current audio');
            // 将保留的后半句与当前音频合并
            const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
            buffer.pendingSecondHalf.copy(mergedAudio, 0);
            currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
            currentAudio = mergedAudio;
            currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
            // 修复：标记job已合并pendingSecondHalf，用于聚合决策
            job.hasPendingSecondHalfMerged = true;
            buffer.pendingSecondHalf = undefined; // 清空保留的后半句
            buffer.pendingSecondHalfCreatedAt = undefined;
        }
    }
    return {
        currentAudio,
        durationMs: currentDurationMs,
    };
}
