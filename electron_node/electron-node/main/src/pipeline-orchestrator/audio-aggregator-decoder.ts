/**
 * Audio Aggregator - Audio Decoder Helper
 * 音频解码辅助方法
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { decodeOpusToPcm16 } from '../utils/opus-codec';

export interface DecodeResult {
  audio: Buffer;
  durationMs: number;
}

/**
 * 解码音频块
 */
export async function decodeAudioChunk(
  job: JobAssignMessage,
  sampleRate: number,
  bytesPerSample: number
): Promise<DecodeResult> {
  const sessionId = job.session_id;
  
    // 解码当前音频块（从Opus base64字符串解码为PCM16 Buffer）
    let currentAudio: Buffer;
    try {
      if (job.audio_format === 'opus') {
        // Opus格式：需要解码
        const decoded = await decodeOpusToPcm16(job.audio, sampleRate);
        // 确保返回的是Buffer类型
        currentAudio = Buffer.isBuffer(decoded) ? decoded : Buffer.from(decoded);
      } else if (job.audio_format === 'pcm16') {
        // PCM16格式：直接解码base64
        currentAudio = Buffer.from(job.audio, 'base64');
      } else {
      logger.error(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          audioFormat: job.audio_format,
        },
        'AudioAggregator: Unsupported audio format'
      );
      throw new Error(`Unsupported audio format: ${job.audio_format}`);
    }
    
    // 验证解码后的音频长度是否为2的倍数（PCM16要求）
    if (currentAudio.length % 2 !== 0) {
      logger.error(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          audioFormat: job.audio_format,
          audioLength: currentAudio.length,
          isOdd: currentAudio.length % 2 !== 0,
          audioBase64Length: job.audio.length,
        },
        '🚨 CRITICAL: Decoded audio chunk length is not a multiple of 2! This will cause ASR service to fail.'
      );
      // 修复：截断最后一个字节，确保长度是2的倍数
      const fixedLength = currentAudio.length - (currentAudio.length % 2);
      const fixedAudio = currentAudio.slice(0, fixedLength);
      logger.warn(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          originalLength: currentAudio.length,
          fixedLength: fixedAudio.length,
          bytesRemoved: currentAudio.length - fixedAudio.length,
        },
        'Fixed audio chunk length by truncating last byte(s)'
      );
      currentAudio = fixedAudio;
    }
    
    logger.debug(
      {
        jobId: job.job_id,
        sessionId,
        utteranceIndex: job.utterance_index,
        audioFormat: job.audio_format,
        audioLength: currentAudio.length,
        isLengthValid: currentAudio.length % 2 === 0,
        audioBase64Length: job.audio.length,
      },
      'AudioAggregator: Audio chunk decoded and validated'
    );
  } catch (error) {
    logger.error(
      {
        error,
        jobId: job.job_id,
        sessionId,
        utteranceIndex: job.utterance_index,
        audioFormat: job.audio_format,
        audioBase64Length: job.audio?.length || 0,
      },
      'AudioAggregator: Failed to decode audio chunk'
    );
    throw error;
  }

  const currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
  
  return {
    audio: currentAudio,
    durationMs: currentDurationMs,
  };
}
