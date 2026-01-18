/**
 * Pipeline音频处理模块
 * 负责音频聚合、格式转换等逻辑
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AudioAggregator } from './audio-aggregator';
import logger from '../logger';

import { OriginalJobInfo } from './audio-aggregator-types';

export interface AudioProcessorResult {
  audioForASR: string;
  audioFormatForASR: string;
  shouldReturnEmpty: boolean;
  /** 切分后的音频段数组（用于流式ASR批次处理） */
  audioSegments?: string[];
  /** 每个ASR批次对应的原始job_id（头部对齐策略） */
  originalJobIds?: string[];
  /** 原始job信息映射（用于获取原始job的utteranceIndex） */
  originalJobInfo?: OriginalJobInfo[];
}

export class PipelineOrchestratorAudioProcessor {
  constructor(private audioAggregator: AudioAggregator) {}

  /**
   * 处理音频：聚合和格式转换
   */
  async processAudio(
    job: JobAssignMessage
  ): Promise<AudioProcessorResult | null> {
    // 音频聚合：在ASR之前根据 is_manual_cut 和 is_pause_triggered 标识聚合音频
    const chunkResult = await this.audioAggregator.processAudioChunk(job);
    
    // 如果应该返回空，说明音频被缓冲，等待更多音频块或触发标识
    if (chunkResult.shouldReturnEmpty) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          isTimeoutPending: chunkResult.isTimeoutPending,
          bufferStatus: this.audioAggregator.getBufferStatus(job.session_id),
        },
        'PipelineOrchestrator: Audio chunk buffered, waiting for more chunks or trigger. Returning empty result.'
      );
      return {
        audioForASR: '',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: true,
        audioSegments: [],
        originalJobIds: chunkResult.originalJobIds,
        originalJobInfo: chunkResult.originalJobInfo,
      };
    }
    
    // 音频已聚合并切分，继续处理
    const audioSegments = chunkResult.audioSegments;
    if (!audioSegments || audioSegments.length === 0) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
        },
        'PipelineOrchestrator: No audio segments returned from aggregator'
      );
      return {
        audioForASR: '',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: true,
        audioSegments: [],
        originalJobIds: chunkResult.originalJobIds,
        originalJobInfo: chunkResult.originalJobInfo,
      };
    }
    
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        segmentCount: audioSegments.length,
        segmentLengths: audioSegments.map(seg => Buffer.from(seg, 'base64').length),
        originalJobIds: chunkResult.originalJobIds,
      },
      'PipelineOrchestrator: Audio processed with streaming split, proceeding to ASR'
    );
    
    // Opus 解码：强制要求输入格式必须是 Opus，在 Pipeline 中解码为 PCM16
    // 注意：AudioAggregator已经返回了base64编码的PCM16字符串数组
    const audioFormat = job.audio_format || 'opus';
    
    if (audioFormat !== 'opus') {
      const errorMessage = `Audio format must be 'opus', but received '${audioFormat}'. Three-end communication only uses Opus format.`;
      logger.error(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          receivedFormat: audioFormat,
        },
        errorMessage
      );
      throw new Error(errorMessage);
    }
    
    // 验证每个音频段的长度是否为2的倍数（PCM16要求）
    const validatedSegments = audioSegments.map((seg, idx) => {
      const buffer = Buffer.from(seg, 'base64');
      if (buffer.length % 2 !== 0) {
        logger.error(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            segmentIndex: idx,
            segmentLength: buffer.length,
            isOdd: buffer.length % 2 !== 0,
          },
          '🚨 CRITICAL: Audio segment length is not a multiple of 2!'
        );
        // 修复：截断最后一个字节
        const fixedLength = buffer.length - (buffer.length % 2);
        return buffer.slice(0, fixedLength).toString('base64');
      }
      return seg;
    });
    
    // 使用第一个段作为audioForASR（向后兼容，但实际应该使用audioSegments）
    const audioForASR = validatedSegments[0] || '';
    const audioFormatForASR = 'pcm16';
    
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        segmentCount: validatedSegments.length,
        originalJobIds: chunkResult.originalJobIds,
      },
      'PipelineOrchestrator: Audio segments ready for ASR (PCM16 format)'
    );
    
    return {
      audioForASR,
      audioFormatForASR,
      shouldReturnEmpty: false,
      audioSegments: validatedSegments,
      originalJobIds: chunkResult.originalJobIds,
      originalJobInfo: chunkResult.originalJobInfo,
    };
  }
}
