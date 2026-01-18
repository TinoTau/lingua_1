"use strict";
/**
 * 音频聚合器 - Job容器管理器
 *
 * 功能：
 * - 构建Job容器（基于原始job信息）
 * - 将批次分配给容器
 * - 为批次分配originalJobIds
 * - 为音频段分配originalJobIds
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioAggregatorJobContainer = void 0;
const logger_1 = __importDefault(require("../logger"));
class AudioAggregatorJobContainer {
    constructor() {
        this.SAMPLE_RATE = 16000;
        this.BYTES_PER_SAMPLE = 2;
    }
    /**
     * 构建Job容器
     *
     * @param jobInfo 原始job信息映射
     * @returns Job容器数组
     */
    buildContainers(jobInfo) {
        const containers = [];
        for (const info of jobInfo) {
            containers.push({
                jobId: info.jobId,
                expectedDurationMs: info.expectedDurationMs || 10000, // 默认10秒
                batches: [],
                currentDurationMs: 0,
                utteranceIndex: info.utteranceIndex,
            });
        }
        return containers;
    }
    /**
     * 容器分配算法：将batch分配给job容器
     *
     * 算法逻辑（按照LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE_FULL.md）：
     * 1. 从左到右扫描batch（B0..Bn）
     * 2. 按顺序依次填满job0、job1、job2...
     * 3. 容器装满后切换到下一个容器
     * 4. 最后一个容器允许超长或为空
     *
     * @param batches 批次数组
     * @param containers 容器数组
     * @returns 分配后的容器数组
     */
    assignBatchesToContainers(batches, containers) {
        if (containers.length === 0) {
            return containers;
        }
        let containerIndex = 0;
        const maxContainerIndex = containers.length - 1;
        for (const batch of batches) {
            // 计算batch时长（毫秒）
            const batchDurationMs = (batch.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
            // 安全防御：所有多出的batch都塞进最后一个容器
            if (containerIndex > maxContainerIndex) {
                const last = containers[maxContainerIndex];
                last.batches.push(batch);
                last.currentDurationMs += batchDurationMs;
                continue;
            }
            const container = containers[containerIndex];
            const afterAddDurationMs = container.currentDurationMs + batchDurationMs;
            // 判断是否是最后一个容器
            if (containerIndex === maxContainerIndex) {
                // 已是最后一个容器：全部放进来
                container.batches.push(batch);
                container.currentDurationMs = afterAddDurationMs;
            }
            else {
                // 非最后一个容器：判断是否装满
                if (afterAddDurationMs <= container.expectedDurationMs) {
                    // 装得下：放进来
                    container.batches.push(batch);
                    container.currentDurationMs = afterAddDurationMs;
                    // 如果刚好装满，切换到下一个容器
                    if (afterAddDurationMs >= container.expectedDurationMs) {
                        containerIndex++;
                    }
                }
                else {
                    // 装不下：切换到下一个容器
                    containerIndex++;
                    // 递归处理当前batch（放到下一个容器）
                    if (containerIndex <= maxContainerIndex) {
                        const nextContainer = containers[containerIndex];
                        nextContainer.batches.push(batch);
                        nextContainer.currentDurationMs += batchDurationMs;
                    }
                    else {
                        // 已经是最后一个容器，强制放进去
                        const last = containers[maxContainerIndex];
                        last.batches.push(batch);
                        last.currentDurationMs += batchDurationMs;
                    }
                }
            }
        }
        return containers;
    }
    /**
     * 为批次分配originalJobIds
     *
     * @param batches 批次数组
     * @param jobInfo 原始job信息映射
     * @returns 每个批次对应的originalJobId数组
     */
    assignOriginalJobIdsForBatches(batches, jobInfo) {
        if (jobInfo.length === 0 || batches.length === 0) {
            return [];
        }
        // 构建容器
        const containers = this.buildContainers(jobInfo);
        // 分配batch到容器
        const assignedContainers = this.assignBatchesToContainers(batches, containers);
        // 为每个batch分配对应的originalJobId
        const originalJobIds = [];
        let batchIndex = 0;
        for (const container of assignedContainers) {
            for (const batch of container.batches) {
                originalJobIds.push(container.jobId);
                batchIndex++;
            }
        }
        // 确保返回的数组长度与batches长度一致
        while (originalJobIds.length < batches.length) {
            // 如果还有未分配的batch，分配给最后一个容器
            originalJobIds.push(assignedContainers[assignedContainers.length - 1].jobId);
        }
        // 记录容器分配结果（用于调试）
        logger_1.default.debug({
            batchCount: batches.length,
            containerCount: assignedContainers.length,
            containerAssignments: assignedContainers.map(c => ({
                jobId: c.jobId,
                batchCount: c.batches.length,
                currentDurationMs: c.currentDurationMs,
                expectedDurationMs: c.expectedDurationMs,
                isFull: c.currentDurationMs >= c.expectedDurationMs,
            })),
        }, 'AudioAggregator: Container assignment completed');
        return originalJobIds;
    }
    /**
     * 为音频段分配originalJobIds
     *
     * 注意：这个方法返回每个片段对应的originalJobId，但调用方应该只使用第一个片段的originalJobId
     * 作为整个ASR批次的originalJobId（头部对齐策略）
     *
     * @param audioSegments 音频片段数组
     * @param originalJobInfo 原始job信息映射（记录每个job在聚合音频中的字节偏移范围）
     * @param aggregatedAudioStartOffset 聚合音频的起始偏移（用于处理pendingTimeoutAudio的情况）
     * @returns 每个片段对应的originalJobId数组
     */
    assignOriginalJobIds(audioSegments, originalJobInfo, aggregatedAudioStartOffset = 0) {
        if (originalJobInfo.length === 0) {
            return [];
        }
        const originalJobIds = [];
        let currentOffset = aggregatedAudioStartOffset;
        for (const segment of audioSegments) {
            // 查找该片段对应的originalJobId
            let assignedJobId = undefined;
            // 计算片段的字节范围
            const segmentStartOffset = currentOffset;
            const segmentEndOffset = currentOffset + segment.length;
            // 查找与片段有重叠的job
            for (const info of originalJobInfo) {
                if (info.startOffset < segmentEndOffset && info.endOffset > segmentStartOffset) {
                    assignedJobId = info.jobId;
                    break; // 使用第一个匹配的job
                }
            }
            // 如果没有找到，使用第一个job的ID（兜底）
            if (!assignedJobId) {
                assignedJobId = originalJobInfo[0].jobId;
            }
            // 注意：虽然这里为每个片段分配了originalJobId，但调用方应该只使用第一个片段的originalJobId
            // 作为整个ASR批次的originalJobId，确保一个ASR批次只对应一个originalJob
            originalJobIds.push(assignedJobId);
            currentOffset = segmentEndOffset;
        }
        return originalJobIds;
    }
}
exports.AudioAggregatorJobContainer = AudioAggregatorJobContainer;
