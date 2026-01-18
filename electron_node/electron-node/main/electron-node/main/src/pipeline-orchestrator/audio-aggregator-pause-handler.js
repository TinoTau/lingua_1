"use strict";
/**
 * 音频聚合器 - Pause处理器
 *
 * 功能：
 * 1. 检查pendingPauseAudio是否需要合并
 * 2. 处理短pause音频（< 1秒），缓存或合并
 * 3. 处理pause音频的TTL检查
 *
 * 设计：
 * - 无状态类，所有逻辑基于传入的参数
 * - 纯函数式设计，便于测试
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioAggregatorPauseHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
class AudioAggregatorPauseHandler {
    constructor() {
        this.SHORT_AUDIO_THRESHOLD_MS = 1000; // 短音频阈值：1秒
        this.PAUSE_MERGE_TTL_MS = 5000; // pause音频合并TTL：5秒
        this.SAMPLE_RATE = 16000;
        this.BYTES_PER_SAMPLE = 2;
    }
    /**
     * 检查是否需要合并pendingPauseAudio
     * 当当前pause音频很短（< 1秒）时，检查是否有pendingPauseAudio需要合并
     */
    checkPauseMerge(buffer, job, currentAggregated, nowMs, isPauseTriggered) {
        const currentDurationMs = (currentAggregated.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        // 检查是否需要合并pendingPauseAudio
        if (!isPauseTriggered || currentDurationMs >= this.SHORT_AUDIO_THRESHOLD_MS || !buffer.pendingPauseAudio) {
            // 不需要合并，但如果当前pause音频很短，缓存到pendingPauseAudio
            if (isPauseTriggered && currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS && !buffer.pendingPauseAudio) {
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    currentAudioDurationMs: currentDurationMs,
                    reason: 'Current pause audio is short, caching to pendingPauseAudio',
                }, 'AudioAggregatorPauseHandler: Caching short pause audio to pendingPauseAudio');
                return {
                    shouldMerge: false,
                    shouldCache: true,
                };
            }
            return {
                shouldMerge: false,
                shouldCache: false,
            };
        }
        // 检查utteranceIndex
        const pendingPauseUtteranceIndex = buffer.pendingPauseJobInfo && buffer.pendingPauseJobInfo.length > 0
            ? buffer.pendingPauseJobInfo[0].utteranceIndex
            : buffer.utteranceIndex;
        // ✅ 修复：允许连续的utteranceIndex合并
        // - 如果currentIndex = pendingIndex + 1，说明是正常延续，应该合并
        // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
        const utteranceIndexDiff = job.utterance_index - pendingPauseUtteranceIndex;
        if (utteranceIndexDiff > 2) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingPauseUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                utteranceIndexDiff,
                reason: 'UtteranceIndex跳跃太大（>2），清除pendingPauseAudio',
            }, 'AudioAggregatorPauseHandler: UtteranceIndex跳跃太大，清除pendingPauseAudio');
            return {
                shouldMerge: false,
                shouldCache: false,
            };
        }
        if (utteranceIndexDiff === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingPauseUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                reason: 'UtteranceIndex相同（重复job），清除pendingPauseAudio',
            }, 'AudioAggregatorPauseHandler: UtteranceIndex相同，清除pendingPauseAudio');
            return {
                shouldMerge: false,
                shouldCache: false,
            };
        }
        // utteranceIndexDiff === 1 或 2，允许合并
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            pendingUtteranceIndex: pendingPauseUtteranceIndex,
            currentUtteranceIndex: job.utterance_index,
            utteranceIndexDiff,
            reason: '连续的utteranceIndex，允许合并',
        }, 'AudioAggregatorPauseHandler: 连续utteranceIndex，允许合并pendingPauseAudio');
        const pendingPauseAudio = buffer.pendingPauseAudio;
        const pendingPauseDurationMs = (pendingPauseAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        const ageMs = buffer.pendingPauseAudioCreatedAt ? nowMs - buffer.pendingPauseAudioCreatedAt : 0;
        // 检查TTL
        if (ageMs > this.PAUSE_MERGE_TTL_MS) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                pendingPauseAudioDurationMs: pendingPauseDurationMs,
                currentAudioDurationMs: currentDurationMs,
                ageMs,
                ttlMs: this.PAUSE_MERGE_TTL_MS,
                reason: 'PendingPauseAudio TTL exceeded, not merging',
            }, 'AudioAggregatorPauseHandler: PendingPauseAudio TTL exceeded, not merging');
            return {
                shouldMerge: false,
                shouldCache: false,
            };
        }
        // 合并音频
        const mergedAudio = Buffer.concat([pendingPauseAudio, currentAggregated]);
        const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingPauseAudioDurationMs: pendingPauseDurationMs,
            currentAudioDurationMs: currentDurationMs,
            mergedAudioDurationMs: mergedDurationMs,
            ageMs,
            reason: 'Merging pendingPauseAudio with current short pause audio',
        }, 'AudioAggregatorPauseHandler: Merging pendingPauseAudio with current audio');
        // 合并job信息（调整偏移）
        const pendingPauseJobInfo = buffer.pendingPauseJobInfo || [];
        const currentJobInfo = buffer.originalJobInfo.map((info) => ({
            ...info,
            startOffset: info.startOffset + pendingPauseAudio.length,
            endOffset: info.endOffset + pendingPauseAudio.length,
        }));
        const mergedJobInfo = [...pendingPauseJobInfo, ...currentJobInfo];
        return {
            shouldMerge: true,
            mergedAudio,
            mergedJobInfo,
            shouldCache: false,
        };
    }
    /**
     * 清理长pause音频的pendingPauseAudio
     */
    clearLongPauseAudio(buffer, job, audioToProcess) {
        const audioDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        if (audioDurationMs >= this.SHORT_AUDIO_THRESHOLD_MS && buffer.pendingPauseAudio) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                audioDurationMs: audioDurationMs,
                reason: 'Current pause audio is long enough, clearing pendingPauseAudio',
            }, 'AudioAggregatorPauseHandler: Clearing pendingPauseAudio for long pause audio');
            buffer.pendingPauseAudio = undefined;
            buffer.pendingPauseAudioCreatedAt = undefined;
            buffer.pendingPauseJobInfo = undefined;
        }
    }
}
exports.AudioAggregatorPauseHandler = AudioAggregatorPauseHandler;
