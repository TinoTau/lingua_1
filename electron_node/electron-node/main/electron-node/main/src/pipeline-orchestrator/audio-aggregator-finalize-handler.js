"use strict";
/**
 * 音频聚合器 - Finalize处理器
 *
 * 功能：
 * 1. 处理手动/pause finalize，合并pending音频
 * 2. 处理pendingTimeoutAudio和pendingPauseAudio的合并
 * 3. 处理pendingSmallSegments的合并
 * 4. 按能量切分音频，创建流式批次
 *
 * 设计：
 * - 无状态类，所有逻辑基于传入的参数
 * - 纯函数式设计，便于测试
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioAggregatorFinalizeHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
const audio_aggregator_utils_1 = require("./audio-aggregator-utils");
const session_affinity_manager_1 = require("./session-affinity-manager");
class AudioAggregatorFinalizeHandler {
    constructor() {
        this.SAMPLE_RATE = 16000;
        this.BYTES_PER_SAMPLE = 2;
        this.SPLIT_HANGOVER_MS = 600;
        this.SHORT_AUDIO_THRESHOLD_MS = 1000;
        this.audioUtils = new audio_aggregator_utils_1.AudioAggregatorUtils();
        this.sessionAffinityManager = session_affinity_manager_1.SessionAffinityManager.getInstance();
    }
    /**
     * 处理手动/pause finalize
     * 合并pendingTimeoutAudio、pendingPauseAudio和pendingSmallSegments
     */
    handleFinalize(buffer, job, currentAggregated, nowMs, isManualCut, isPauseTriggered) {
        let audioToProcess = currentAggregated;
        let jobInfoToProcess = [...buffer.originalJobInfo];
        let hasMergedPendingAudio = false;
        let shouldCachePendingPause = false;
        // 1. 处理pendingTimeoutAudio
        if (buffer.pendingTimeoutAudio) {
            const mergeResult = this.mergePendingTimeoutAudio(buffer, job, currentAggregated, nowMs);
            if (mergeResult.shouldMerge) {
                audioToProcess = mergeResult.mergedAudio;
                jobInfoToProcess = mergeResult.mergedJobInfo;
                hasMergedPendingAudio = true;
                // 清除session affinity映射
                this.sessionAffinityManager.clearSessionMapping(job.session_id);
                logger_1.default.info({
                    sessionId: job.session_id,
                    jobId: job.job_id,
                    utteranceIndex: job.utterance_index,
                    isManualCut,
                    isPauseTriggered,
                }, 'AudioAggregatorFinalizeHandler: Cleared session mapping (manual/pause finalize)');
            }
        }
        // 2. 处理pendingPauseAudio（如果没有合并pendingTimeoutAudio）
        if (!hasMergedPendingAudio && buffer.pendingPauseAudio) {
            const currentDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
            if (isPauseTriggered && currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS) {
                const mergeResult = this.mergePendingPauseAudio(buffer, job, audioToProcess, nowMs);
                if (mergeResult.shouldMerge) {
                    audioToProcess = mergeResult.mergedAudio;
                    jobInfoToProcess = mergeResult.mergedJobInfo;
                    hasMergedPendingAudio = true;
                }
                else if (mergeResult.shouldCache) {
                    shouldCachePendingPause = true;
                }
            }
        }
        // 3. 如果当前pause音频短且还没有缓存，保存到pendingPauseAudio
        if (!hasMergedPendingAudio && !buffer.pendingPauseAudio) {
            const currentDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
            if (isPauseTriggered && currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS) {
                shouldCachePendingPause = true;
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    currentAudioDurationMs: currentDurationMs,
                }, 'AudioAggregatorFinalizeHandler: Caching short pause audio to pendingPauseAudio');
            }
        }
        // 4. 处理pendingSmallSegments（仅在非独立utterance时）
        const isIndependentUtterance = isManualCut || isPauseTriggered;
        if (!isIndependentUtterance && buffer.pendingSmallSegments.length > 0) {
            const mergeResult = this.mergePendingSmallSegments(buffer, job, audioToProcess, jobInfoToProcess);
            if (mergeResult.shouldMerge) {
                audioToProcess = mergeResult.mergedAudio;
                jobInfoToProcess = mergeResult.mergedJobInfo;
            }
        }
        return {
            audioToProcess,
            jobInfoToProcess,
            hasMergedPendingAudio,
            shouldCachePendingPause,
        };
    }
    /**
     * 合并pendingTimeoutAudio
     */
    mergePendingTimeoutAudio(buffer, job, currentAggregated, nowMs) {
        // 检查utteranceIndex
        const pendingUtteranceIndex = buffer.pendingTimeoutJobInfo && buffer.pendingTimeoutJobInfo.length > 0
            ? buffer.pendingTimeoutJobInfo[0].utteranceIndex
            : buffer.utteranceIndex;
        // ✅ 修复：允许连续的utteranceIndex合并（超时finalize的正常场景）
        // - 如果currentIndex = pendingIndex + 1，说明是超时finalize后的下一个job，应该合并
        // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
        const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;
        if (utteranceIndexDiff > 2) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                utteranceIndexDiff,
                reason: 'UtteranceIndex跳跃太大（>2），说明中间有其他独立utterance，清除pendingTimeoutAudio',
            }, 'AudioAggregatorFinalizeHandler: PendingTimeoutAudio跳跃太大，清除');
            return { shouldMerge: false };
        }
        if (utteranceIndexDiff === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                reason: 'UtteranceIndex相同，说明是同一个utterance的重复job，清除pendingTimeoutAudio',
            }, 'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingTimeoutAudio');
            return { shouldMerge: false };
        }
        // utteranceIndexDiff === 1 或 2，允许合并（超时finalize的正常场景）
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            pendingUtteranceIndex,
            currentUtteranceIndex: job.utterance_index,
            utteranceIndexDiff,
            reason: '连续的utteranceIndex，允许合并（超时finalize的正常场景）',
        }, 'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingTimeoutAudio');
        const pendingAudio = buffer.pendingTimeoutAudio;
        const mergedAudio = Buffer.concat([pendingAudio, currentAggregated]);
        const pendingDurationMs = (pendingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        const currentDurationMs = (currentAggregated.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        const ageMs = nowMs - (buffer.pendingTimeoutAudioCreatedAt || nowMs);
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingAudioDurationMs: pendingDurationMs,
            currentAudioDurationMs: currentDurationMs,
            mergedAudioDurationMs: mergedDurationMs,
            ageMs,
        }, 'AudioAggregatorFinalizeHandler: Merging pendingTimeoutAudio with current audio');
        // 合并job信息
        const pendingJobInfo = buffer.pendingTimeoutJobInfo || [];
        const currentJobInfo = buffer.originalJobInfo.map((info) => ({
            ...info,
            startOffset: info.startOffset + pendingAudio.length,
            endOffset: info.endOffset + pendingAudio.length,
        }));
        const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];
        return {
            shouldMerge: true,
            mergedAudio,
            mergedJobInfo,
        };
    }
    /**
     * 合并pendingPauseAudio
     */
    mergePendingPauseAudio(buffer, job, currentAudio, nowMs) {
        const PAUSE_MERGE_TTL_MS = 5000;
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
            }, 'AudioAggregatorFinalizeHandler: UtteranceIndex跳跃太大，清除pendingPauseAudio（finalize场景）');
            return { shouldMerge: false, shouldCache: false };
        }
        if (utteranceIndexDiff === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingPauseUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                reason: 'UtteranceIndex相同（重复job），清除pendingPauseAudio',
            }, 'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingPauseAudio（finalize场景）');
            return { shouldMerge: false, shouldCache: false };
        }
        // utteranceIndexDiff === 1 或 2，允许合并
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            pendingUtteranceIndex: pendingPauseUtteranceIndex,
            currentUtteranceIndex: job.utterance_index,
            utteranceIndexDiff,
            reason: '连续的utteranceIndex，允许合并',
        }, 'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingPauseAudio（finalize场景）');
        const pendingPauseAudio = buffer.pendingPauseAudio;
        const ageMs = buffer.pendingPauseAudioCreatedAt ? nowMs - buffer.pendingPauseAudioCreatedAt : 0;
        // 检查TTL
        if (ageMs > PAUSE_MERGE_TTL_MS) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                ageMs,
                ttlMs: PAUSE_MERGE_TTL_MS,
            }, 'AudioAggregatorFinalizeHandler: PendingPauseAudio TTL exceeded, not merging');
            return { shouldMerge: false, shouldCache: false };
        }
        // 合并音频
        const mergedAudio = Buffer.concat([pendingPauseAudio, currentAudio]);
        const mergedJobInfo = [
            ...(buffer.pendingPauseJobInfo || []),
            ...buffer.originalJobInfo.map((info) => ({
                ...info,
                startOffset: info.startOffset + pendingPauseAudio.length,
                endOffset: info.endOffset + pendingPauseAudio.length,
            })),
        ];
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            mergedAudioDurationMs: (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
        }, 'AudioAggregatorFinalizeHandler: Merged pendingPauseAudio with current audio');
        return {
            shouldMerge: true,
            shouldCache: false,
            mergedAudio,
            mergedJobInfo,
        };
    }
    /**
     * 合并pendingSmallSegments
     */
    mergePendingSmallSegments(buffer, job, currentAudio, currentJobInfo) {
        // 检查utteranceIndex
        const pendingSmallSegmentsUtteranceIndex = buffer.pendingSmallSegmentsJobInfo && buffer.pendingSmallSegmentsJobInfo.length > 0
            ? buffer.pendingSmallSegmentsJobInfo[0].utteranceIndex
            : buffer.utteranceIndex;
        // ✅ 修复：允许连续的utteranceIndex合并
        // - 如果currentIndex = pendingIndex + 1，说明是正常延续，应该合并
        // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
        const utteranceIndexDiff = job.utterance_index - pendingSmallSegmentsUtteranceIndex;
        if (utteranceIndexDiff > 2) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                utteranceIndexDiff,
                reason: 'UtteranceIndex跳跃太大（>2），清除pendingSmallSegments',
            }, 'AudioAggregatorFinalizeHandler: UtteranceIndex跳跃太大，清除pendingSmallSegments');
            return { shouldMerge: false };
        }
        if (utteranceIndexDiff === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                reason: 'UtteranceIndex相同（重复job），清除pendingSmallSegments',
            }, 'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingSmallSegments');
            return { shouldMerge: false };
        }
        // utteranceIndexDiff === 1 或 2，允许合并
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
            currentUtteranceIndex: job.utterance_index,
            utteranceIndexDiff,
            reason: '连续的utteranceIndex，允许合并',
        }, 'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingSmallSegments');
        const smallSegmentsAudio = Buffer.concat(buffer.pendingSmallSegments);
        const mergedAudio = Buffer.concat([smallSegmentsAudio, currentAudio]);
        const smallSegmentsDurationMs = (smallSegmentsAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            smallSegmentsCount: buffer.pendingSmallSegments.length,
            smallSegmentsDurationMs,
            mergedAudioDurationMs: (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
        }, 'AudioAggregatorFinalizeHandler: Merged pendingSmallSegments with current audio');
        // 合并job信息
        const mergedJobInfo = [
            ...buffer.pendingSmallSegmentsJobInfo,
            ...currentJobInfo.map((info) => ({
                ...info,
                startOffset: info.startOffset + smallSegmentsAudio.length,
                endOffset: info.endOffset + smallSegmentsAudio.length,
            })),
        ];
        return {
            shouldMerge: true,
            mergedAudio,
            mergedJobInfo,
        };
    }
}
exports.AudioAggregatorFinalizeHandler = AudioAggregatorFinalizeHandler;
