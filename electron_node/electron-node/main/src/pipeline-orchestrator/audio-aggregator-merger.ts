/**
 * 音频聚合器 - 音频合并器
 * 
 * 功能：
 * - 将多个音频块合并为一个完整的音频
 * - 验证音频块长度的合法性
 */

import logger from '../logger';

export class AudioAggregatorMerger {
  private readonly SAMPLE_RATE = 16000;
  private readonly BYTES_PER_SAMPLE = 2;

  /**
   * 聚合多个音频块为一个完整的音频
   */
  aggregateAudioChunks(chunks: Buffer[]): Buffer {
    if (chunks.length === 0) {
      throw new Error('AudioAggregator: No audio chunks to aggregate');
    }

    if (chunks.length === 1) {
      // 验证单个chunk的长度
      const chunk = chunks[0];
      const durationMs = (chunk.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      logger.debug(
        {
          chunkCount: 1,
          chunkSizeBytes: chunk.length,
          durationMs,
          operation: 'aggregateAudioChunks',
        },
        'AudioAggregator: [AudioMerge] Single chunk, no merge needed'
      );

      if (chunk.length % 2 !== 0) {
        logger.error(
          {
            chunkLength: chunk.length,
            isOdd: chunk.length % 2 !== 0,
          },
          '🚨 CRITICAL: Single audio chunk length is not a multiple of 2!'
        );
        // 修复：截断最后一个字节
        const fixedLength = chunk.length - (chunk.length % 2);
        return chunk.slice(0, fixedLength);
      }
      return chunk;
    }

    // 验证每个chunk的长度并记录
    const chunkLengths = chunks.map((chunk, idx) => {
      const isValid = chunk.length % 2 === 0;
      if (!isValid) {
        logger.error(
          {
            chunkIndex: idx,
            chunkLength: chunk.length,
            isOdd: chunk.length % 2 !== 0,
          },
          '🚨 CRITICAL: Audio chunk length is not a multiple of 2!'
        );
      }
      return {
        index: idx,
        length: chunk.length,
        isValid,
      };
    });

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // 修复：如果总长度不是2的倍数，截断最后一个字节
    const fixedLength = totalLength - (totalLength % 2);
    const aggregated = Buffer.alloc(fixedLength);

    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const copyLength = Math.min(chunk.length, fixedLength - offset);
      chunk.copy(aggregated, offset, 0, copyLength);
      offset += copyLength;

      if (offset >= fixedLength) {
        break; // 防止超出边界
      }
    }

    logger.debug(
      {
        chunkCount: chunks.length,
        totalSizeBytes: totalLength,
        fixedSizeBytes: fixedLength,
        durationMs: (fixedLength / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
        operation: 'aggregateAudioChunks',
        chunkLengths: chunkLengths.map(c => `[${c.index}]:${c.length}(${c.isValid ? 'OK' : 'BAD'})`).join(', '),
      },
      'AudioAggregator: [AudioMerge] Multiple chunks aggregated'
    );

    return aggregated;
  }

  /**
   * 清理音频数据（兜底）
   * 删除超过20秒没有活动的session缓冲区
   */
  cleanupOldBuffers(buffers: Map<string, any>, sessionId: string, reasonLog: string): void {
    const now = Date.now();
    const CLEANUP_THRESHOLD_MS = 20000; // 20秒

    for (const [sid, buffer] of buffers.entries()) {
      const ageMs = now - buffer.lastChunkTimeMs;
      if (ageMs > CLEANUP_THRESHOLD_MS) {
        logger.warn(
          {
            sessionId: sid,
            ageMs,
            thresholdMs: CLEANUP_THRESHOLD_MS,
            reason: reasonLog,
          },
          'AudioAggregator: Cleaning up old buffer (no activity for >20s)'
        );
        buffers.delete(sid);
      }
    }
  }
}
