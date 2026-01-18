"use strict";
/**
 * 音频聚合器 - 超时处理器
 *
 * 功能：
 * 1. 检查pendingTimeoutAudio是否超过TTL
 * 2. 处理超时finalize，缓存音频到pendingTimeoutAudio
 * 3. 处理连续的超时finalize，合并音频
 *
 * 设计：
 * - 无状态类，所有逻辑基于传入的参数
 * - 纯函数式设计，便于测试
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioAggregatorTimeoutHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
const audio_aggregator_utils_1 = require("./audio-aggregator-utils");
const session_affinity_manager_1 = require("./session-affinity-manager");
class AudioAggregatorTimeoutHandler {
    constructor() {
        this.PENDING_TIMEOUT_AUDIO_TTL_MS = 10000;
        this.SAMPLE_RATE = 16000;
        this.BYTES_PER_SAMPLE = 2;
        this.SPLIT_HANGOVER_MS = 600;
        this.audioUtils = new audio_aggregator_utils_1.AudioAggregatorUtils();
        this.sessionAffinityManager = session_affinity_manager_1.SessionAffinityManager.getInstance();
    }
    /**
     * 检查pendingTimeoutAudio是否超过TTL
     * 如果超过TTL，合并pendingTimeoutAudio和当前音频，然后按能量切分
     */
    checkTimeoutTTL(buffer, job, currentAudio, nowMs) {
        if (!buffer.pendingTimeoutAudio || !buffer.pendingTimeoutAudioCreatedAt) {
            return null;
        }
        const pendingAgeMs = nowMs - buffer.pendingTimeoutAudioCreatedAt;
        if (pendingAgeMs < this.PENDING_TIMEOUT_AUDIO_TTL_MS) {
            return null;
        }
        // 检查utteranceIndex
        const pendingUtteranceIndex = buffer.pendingTimeoutJobInfo && buffer.pendingTimeoutJobInfo.length > 0
            ? buffer.pendingTimeoutJobInfo[0].utteranceIndex
            : buffer.utteranceIndex;
        // ✅ 修复：允许连续的utteranceIndex合并（超时finalize的正常场景）
        // - TTL已过期但utteranceIndex连续（差值≤2），说明是超时finalize后的正常延续，应该合并
        // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
        const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;
        if (utteranceIndexDiff > 2) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                utteranceIndexDiff,
                pendingAgeMs,
                ttlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
                reason: 'TTL已过期且utteranceIndex跳跃太大（>2），清除pendingTimeoutAudio',
            }, 'AudioAggregatorTimeoutHandler: TTL过期且utteranceIndex跳跃太大，清除pendingTimeoutAudio');
            return {
                shouldProcess: false,
                audioSegments: [],
                clearPendingTimeout: true,
            };
        }
        if (utteranceIndexDiff === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                pendingUtteranceIndex: pendingUtteranceIndex,
                currentUtteranceIndex: job.utterance_index,
                pendingAgeMs,
                ttlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
                reason: 'TTL已过期且utteranceIndex相同（重复job），清除pendingTimeoutAudio',
            }, 'AudioAggregatorTimeoutHandler: TTL过期且utteranceIndex相同，清除pendingTimeoutAudio');
            return {
                shouldProcess: false,
                audioSegments: [],
                clearPendingTimeout: true,
            };
        }
        // utteranceIndexDiff === 1 或 2，即使TTL过期也允许合并（超时finalize的正常场景）
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            pendingUtteranceIndex,
            currentUtteranceIndex: job.utterance_index,
            utteranceIndexDiff,
            pendingAgeMs,
            ttlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
            reason: 'TTL已过期但utteranceIndex连续，允许合并（超时finalize的正常场景）',
        }, 'AudioAggregatorTimeoutHandler: TTL过期但utteranceIndex连续，允许合并pendingTimeoutAudio');
        // 合并音频
        const pendingAudio = buffer.pendingTimeoutAudio;
        const pendingJobInfo = buffer.pendingTimeoutJobInfo || [];
        const mergedAudio = Buffer.concat([pendingAudio, currentAudio]);
        const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingAgeMs,
            ttlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
            mergedAudioDurationMs: mergedDurationMs,
            mergedAudioSizeBytes: mergedAudio.length,
        }, 'AudioAggregatorTimeoutHandler: TTL exceeded, merging pendingTimeoutAudio with current audio');
        // 按能量切分
        const audioSegments = this.audioUtils.splitAudioByEnergy(mergedAudio, 10000, // maxSegmentDurationMs: 10秒
        2000, // minSegmentDurationMs: 2秒
        this.SPLIT_HANGOVER_MS);
        // 合并jobInfo
        const currentAudioDurationMs = (currentAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        const currentExpectedDurationMs = job.expected_duration_ms ||
            Math.ceil(currentAudioDurationMs * 1.2);
        const currentJobInfo = {
            jobId: job.job_id,
            startOffset: pendingAudio.length,
            endOffset: mergedAudio.length,
            utteranceIndex: job.utterance_index,
            expectedDurationMs: currentExpectedDurationMs,
        };
        const mergedJobInfo = [...pendingJobInfo, currentJobInfo];
        // 分配originalJobIds
        const originalJobIds = this.assignOriginalJobIds(audioSegments, mergedJobInfo, 0);
        return {
            shouldProcess: true,
            audioSegments,
            originalJobIds: originalJobIds.length > 0 ? originalJobIds : undefined,
            clearPendingTimeout: true,
        };
    }
    /**
     * 处理超时finalize
     * 缓存音频到pendingTimeoutAudio，等待下一个job合并
     */
    handleTimeoutFinalize(buffer, job, currentAudio, nowMs, aggregateAudioChunks) {
        // 检查是否为空音频
        if (currentAudio.length === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'Timeout job with empty audio',
            }, 'AudioAggregatorTimeoutHandler: Timeout job with empty audio');
            return {
                shouldCache: false,
                clearBuffer: true,
            };
        }
        // 检查是否已存在pendingTimeoutAudio（连续的超时finalize）
        if (buffer.pendingTimeoutAudio) {
            const existingPendingAudio = buffer.pendingTimeoutAudio;
            const existingPendingJobInfo = buffer.pendingTimeoutJobInfo || [];
            const currentAggregated = aggregateAudioChunks(buffer.audioChunks);
            // 合并音频
            const mergedAudio = Buffer.concat([existingPendingAudio, currentAggregated]);
            const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                mergedAudioDurationMs: mergedDurationMs,
                mergedAudioSizeBytes: mergedAudio.length,
                reason: 'Consecutive timeout finalize, merged existing and current audio',
            }, 'AudioAggregatorTimeoutHandler: Consecutive timeout finalize, merged audio');
            // 更新pendingTimeoutAudio
            buffer.pendingTimeoutAudio = mergedAudio;
            buffer.pendingTimeoutAudioCreatedAt = nowMs;
            // 合并job信息（调整偏移）
            const currentJobInfo = buffer.originalJobInfo.map((info) => ({
                ...info,
                startOffset: info.startOffset + existingPendingAudio.length,
                endOffset: info.endOffset + existingPendingAudio.length,
            }));
            buffer.pendingTimeoutJobInfo = [...existingPendingJobInfo, ...currentJobInfo];
            return {
                shouldCache: true,
                clearBuffer: false,
            };
        }
        // 聚合音频并缓存
        const aggregatedAudio = aggregateAudioChunks(buffer.audioChunks);
        const aggregatedDurationMs = (aggregatedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedAudioDurationMs: aggregatedDurationMs,
            aggregatedAudioSizeBytes: aggregatedAudio.length,
            ttlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
        }, 'AudioAggregatorTimeoutHandler: Caching audio to pendingTimeoutAudio');
        // 记录session affinity
        const currentNodeId = this.sessionAffinityManager.getNodeId();
        this.sessionAffinityManager.recordTimeoutFinalize(job.session_id);
        logger_1.default.info({
            sessionId: job.session_id,
            nodeId: currentNodeId,
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
        }, 'AudioAggregatorTimeoutHandler: Recorded timeout finalize session mapping');
        // 缓存到pendingTimeoutAudio
        buffer.pendingTimeoutAudio = aggregatedAudio;
        buffer.pendingTimeoutAudioCreatedAt = nowMs;
        buffer.pendingTimeoutJobInfo = [...buffer.originalJobInfo];
        return {
            shouldCache: true,
            clearBuffer: false,
        };
    }
    /**
     * 分配originalJobIds
     */
    assignOriginalJobIds(audioSegments, originalJobInfo, aggregatedAudioStartOffset) {
        const originalJobIds = [];
        let currentOffset = aggregatedAudioStartOffset;
        for (const segment of audioSegments) {
            const segmentStartOffset = currentOffset;
            const segmentEndOffset = currentOffset + segment.length;
            const segmentMidpoint = (segmentStartOffset + segmentEndOffset) / 2;
            // 找到包含segment中点的job
            let assignedJobId;
            for (const jobInfo of originalJobInfo) {
                if (segmentMidpoint >= jobInfo.startOffset && segmentMidpoint < jobInfo.endOffset) {
                    assignedJobId = jobInfo.jobId;
                    break;
                }
            }
            if (!assignedJobId && originalJobInfo.length > 0) {
                assignedJobId = originalJobInfo[originalJobInfo.length - 1].jobId;
            }
            originalJobIds.push(assignedJobId || 'unknown');
            currentOffset = segmentEndOffset;
        }
        return originalJobIds;
    }
}
exports.AudioAggregatorTimeoutHandler = AudioAggregatorTimeoutHandler;
