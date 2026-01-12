/**
 * Pipeline音频处理模块
 * 负责音频聚合、格式转换等逻辑
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AudioAggregator } from './audio-aggregator';
import logger from '../logger';

export interface AudioProcessorResult {
  audioForASR: string;
  audioFormatForASR: string;
  shouldReturnEmpty: boolean;
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
    const aggregatedAudio = await this.audioAggregator.processAudioChunk(job);
    
    // 如果返回null，说明音频被缓冲，等待更多音频块或触发标识
    if (aggregatedAudio === null) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          bufferStatus: this.audioAggregator.getBufferStatus(job.session_id),
        },
        'PipelineOrchestrator: Audio chunk buffered, waiting for more chunks or trigger. Returning empty result.'
      );
      return {
        audioForASR: '',
        audioFormatForASR: 'pcm16',
        shouldReturnEmpty: true,
      };
    }
    
    // 音频已聚合，继续处理
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedAudioLength: aggregatedAudio.length,
      },
      'PipelineOrchestrator: Audio aggregated, proceeding to ASR'
    );
    
    // Opus 解码：强制要求输入格式必须是 Opus，在 Pipeline 中解码为 PCM16
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
    
    // 验证聚合后的音频长度是否为2的倍数（PCM16要求）
    let finalAudio = aggregatedAudio;
    if (aggregatedAudio.length % 2 !== 0) {
      logger.error(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          aggregatedAudioLength: aggregatedAudio.length,
          isOdd: aggregatedAudio.length % 2 !== 0,
        },
        '🚨 CRITICAL: Aggregated audio length is not a multiple of 2 before sending to ASR! This will cause 400 error.'
      );
      // 修复：截断最后一个字节
      const fixedLength = aggregatedAudio.length - (aggregatedAudio.length % 2);
      finalAudio = aggregatedAudio.slice(0, fixedLength);
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          originalLength: aggregatedAudio.length,
          fixedLength: finalAudio.length,
          bytesRemoved: aggregatedAudio.length - finalAudio.length,
        },
        'Fixed aggregated audio length by truncating last byte(s) before sending to ASR'
      );
    }
    
    // 使用聚合后的音频（已经是PCM16格式）
    // 将 PCM16 Buffer 转换为 base64 字符串
    const audioForASR = finalAudio.toString('base64');
    const audioFormatForASR = 'pcm16';
    
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedAudioLength: finalAudio.length,
        originalLength: aggregatedAudio.length,
        wasFixed: finalAudio.length !== aggregatedAudio.length,
        sampleRate: job.sample_rate || 16000,
        isLengthValid: finalAudio.length % 2 === 0,
      },
      'PipelineOrchestrator: Aggregated audio ready for ASR (PCM16 format)'
    );
    
    return {
      audioForASR,
      audioFormatForASR,
      shouldReturnEmpty: false,
    };
  }
}
