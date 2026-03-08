/**
 * AudioAggregatorStreamBatcher 单元测试
 * 验证 5 秒批次逻辑
 */

import { AudioAggregatorStreamBatcher } from './audio-aggregator-stream-batcher';
import { OriginalJobInfo } from './audio-aggregator-types';
import { msToBytesPcm16LE } from './audio-aggregator.test.helpers';

const SAMPLE_RATE = 16000;

function msToBytes(ms: number): number {
  return msToBytesPcm16LE(ms, SAMPLE_RATE);
}

function makeJobInfo(startOffset: number, endOffset: number, jobId = 'job-1', utteranceIndex = 0): OriginalJobInfo {
  return { jobId, startOffset, endOffset, utteranceIndex };
}

describe('AudioAggregatorStreamBatcher', () => {
  let batcher: AudioAggregatorStreamBatcher;

  beforeEach(() => {
    batcher = new AudioAggregatorStreamBatcher();
  });

  it('不足 5 秒的段会合并或缓存', () => {
    const seg1 = Buffer.alloc(msToBytes(2000), 0);
    const seg2 = Buffer.alloc(msToBytes(2000), 0);
    const seg3 = Buffer.alloc(msToBytes(1500), 0);
    const totalBytes = seg1.length + seg2.length + seg3.length;
    const jobInfo: OriginalJobInfo[] = [makeJobInfo(0, totalBytes)];

    const result = batcher.createStreamingBatchesWithPending(
      [seg1, seg2, seg3],
      jobInfo,
      true
    );

    expect(result.batches.length).toBe(1);
    expect(result.batches[0].length).toBe(seg1.length + seg2.length);
    expect(result.remainingSmallSegments.length).toBe(1);
    expect(result.remainingSmallSegments[0].length).toBe(seg3.length);
    expect(result.batchJobInfo.length).toBe(1);
  });

  it('shouldCacheRemaining=false 时尾段不足 5 秒也直接输出', () => {
    const seg1 = Buffer.alloc(msToBytes(6000), 0);
    const seg2 = Buffer.alloc(msToBytes(1000), 0);
    const jobInfo: OriginalJobInfo[] = [
      makeJobInfo(0, seg1.length),
      makeJobInfo(seg1.length, seg1.length + seg2.length),
    ];

    const result = batcher.createStreamingBatchesWithPending(
      [seg1, seg2],
      jobInfo,
      false
    );

    expect(result.batches.length).toBe(2);
    expect(result.batches[0].length).toBe(seg1.length);
    expect(result.batches[1].length).toBe(seg2.length);
    expect(result.remainingSmallSegments.length).toBe(0);
  });
});
