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
    // 音频聚合：在ASR之前根据 is_manual_cut 和 is_timeout_triggered 标识聚合音频
    const chunkResult = await this.audioAggregator.processAudioChunk(job);
    
    // 如果应该返回空，说明音频被缓冲，等待更多音频块或触发标识（热路径不取 getBufferStatus，仅 debug 时可选）
    if (chunkResult.shouldReturnEmpty) {
      logger.debug(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          isTimeoutPending: chunkResult.isTimeoutPending,
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
    
    // 注意：音频格式验证已在 decodeAudioChunk 中完成（统一使用位置1的代码）
    // AudioAggregator 已经返回了 base64 编码的 PCM16 字符串数组，无需再次验证
    
    // 使用第一个段作为audioForASR（向后兼容，但实际应该使用audioSegments）
    const audioForASR = audioSegments[0] || '';
    const audioFormatForASR = 'pcm16';
    
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        segmentCount: audioSegments.length,
        originalJobIds: chunkResult.originalJobIds,
      },
      'PipelineOrchestrator: Audio segments ready for ASR (PCM16 format)'
    );
    
    return {
      audioForASR,
      audioFormatForASR,
      shouldReturnEmpty: false,
      audioSegments: audioSegments,
      originalJobIds: chunkResult.originalJobIds,
      originalJobInfo: chunkResult.originalJobInfo,
    };
  }
}
