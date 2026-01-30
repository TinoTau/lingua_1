/**
 * 音频聚合器 - 流式批次处理器
 * 
 * 功能：
 * - 将切分后的音频段组合成~5秒批次，用于ASR流式处理
 * - 管理小片段缓存（<5秒），等待合并成完整批次
 */

import logger from '../logger';
import { OriginalJobInfo } from './audio-aggregator-types';

export interface StreamingBatchResult {
  batches: Buffer[];
  /** 每个 batch 的第一个音频片段对应的 jobInfo（用于头部对齐策略） */
  batchJobInfo: OriginalJobInfo[];
  remainingSmallSegments: Buffer[];
  remainingSmallSegmentsJobInfo: OriginalJobInfo[];
}

export class AudioAggregatorStreamBatcher {
  private readonly SAMPLE_RATE = 16000;
  private readonly BYTES_PER_SAMPLE = 2;
  private readonly MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000;

  /**
   * 创建流式批次：将音频段组合成~5秒批次
   * 
   * @param audioSegments 切分后的音频段数组
   * @param jobInfo 原始job信息映射
   * @param shouldCacheRemaining 是否缓存剩余小片段（手动发送时应该为false）
   * @returns 批次数组和剩余小片段
   */
  createStreamingBatchesWithPending(
    audioSegments: Buffer[],
    jobInfo: OriginalJobInfo[],
    shouldCacheRemaining: boolean = true
  ): StreamingBatchResult {
    const batches: Buffer[] = [];
    const batchJobInfo: OriginalJobInfo[] = [];  // 每个 batch 的第一个片段对应的 jobInfo
    let currentBatch: Buffer[] = [];
    let currentBatchDurationMs = 0;
    let segmentOffset = 0; // 当前音频段的累计偏移量（在聚合音频中的位置）
    let currentBatchFirstSegmentOffset: number | undefined = undefined;  // 当前 batch 的第一个片段的偏移量

    for (let i = 0; i < audioSegments.length; i++) {
      const segment = audioSegments[i];
      const segmentDurationMs = (segment.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      if (currentBatchDurationMs + segmentDurationMs >= this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS) {
        // 当前批次已达到5秒，创建新批次
        if (currentBatch.length > 0) {
          batches.push(Buffer.concat(currentBatch));
          
          // 记录当前 batch 的第一个片段对应的 jobInfo
          if (currentBatchFirstSegmentOffset !== undefined) {
            const firstSegmentJobInfo = this.findJobInfoByOffset(
              currentBatchFirstSegmentOffset,
              jobInfo
            );
            batchJobInfo.push(firstSegmentJobInfo);
          }
        }
        // 新 batch 的第一个片段（使用当前片段的偏移量）
        currentBatch = [segment];
        currentBatchDurationMs = segmentDurationMs;
        currentBatchFirstSegmentOffset = segmentOffset;
      } else {
        // 添加到当前批次
        if (currentBatch.length === 0) {
          // 这是当前 batch 的第一个片段
          currentBatchFirstSegmentOffset = segmentOffset;
        }
        currentBatch.push(segment);
        currentBatchDurationMs += segmentDurationMs;
      }
      
      // 更新偏移量（在处理完当前片段后）
      segmentOffset += segment.length;
    }

    // 处理最后一个批次
    let remainingSmallSegments: Buffer[] = [];
    let remainingSmallSegmentsJobInfo: OriginalJobInfo[] = [];

    if (currentBatch.length > 0) {
      if (currentBatchDurationMs < this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS && shouldCacheRemaining) {
        // 最后一个批次<5秒，且允许缓存：缓存到pendingSmallSegments（等待下一个job合并）
        remainingSmallSegments = currentBatch;

        // 计算剩余片段的job信息（基于已处理的偏移量）
        // 使用 currentBatchFirstSegmentOffset 作为起始偏移量
        let remainingSegmentOffset = currentBatchFirstSegmentOffset ?? 0;
        for (const segment of currentBatch) {
          // 查找该片段对应的job信息
          let found = false;
          for (const info of jobInfo) {
            if (info.startOffset <= remainingSegmentOffset && info.endOffset > remainingSegmentOffset) {
              remainingSmallSegmentsJobInfo.push({
                ...info,
                startOffset: remainingSegmentOffset,
                endOffset: remainingSegmentOffset + segment.length,
              });
              found = true;
              break;
            }
          }
          if (!found && jobInfo.length > 0) {
            // 如果没有找到，使用最后一个job信息（兜底）
            remainingSmallSegmentsJobInfo.push({
              ...jobInfo[jobInfo.length - 1],
              startOffset: remainingSegmentOffset,
              endOffset: remainingSegmentOffset + segment.length,
            });
          }
          remainingSegmentOffset += segment.length;
        }
      } else {
        // 最后一个批次≥5秒，或者shouldCacheRemaining=false（手动发送），直接作为批次发送
        batches.push(Buffer.concat(currentBatch));
        
        // 记录最后一个 batch 的第一个片段对应的 jobInfo
        if (currentBatchFirstSegmentOffset !== undefined) {
          const firstSegmentJobInfo = this.findJobInfoByOffset(
            currentBatchFirstSegmentOffset,
            jobInfo
          );
          batchJobInfo.push(firstSegmentJobInfo);
        }
      }
    }

    return {
      batches,
      batchJobInfo,
      remainingSmallSegments,
      remainingSmallSegmentsJobInfo,
    };
  }

  /**
   * 根据偏移量查找对应的 jobInfo
   */
  private findJobInfoByOffset(
    offset: number,
    jobInfo: OriginalJobInfo[]
  ): OriginalJobInfo {
    // 查找包含该偏移量的 jobInfo
    for (const info of jobInfo) {
      if (info.startOffset <= offset && info.endOffset > offset) {
        return info;
      }
    }
    
    // 如果没有找到，使用第一个 jobInfo（兜底）
    if (jobInfo.length > 0) {
      return jobInfo[0];
    }
    
    // 如果 jobInfo 为空，返回一个默认值（这种情况不应该发生）
    throw new Error('No jobInfo available for offset lookup');
  }
}
