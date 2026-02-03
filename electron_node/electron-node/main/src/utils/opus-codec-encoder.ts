/**
 * Opus 编码：PCM16 -> Opus Buffer，WAV -> Opus
 */

import logger from '../logger';
import { encodePcm16ToOpus, parseWavFile, isOpusEncoderAvailable } from './opus-encoder';

/**
 * 编码 PCM16 音频为 Opus
 */
export async function encodePcm16ToOpusBuffer(
  pcm16Data: Buffer,
  sampleRate: number = 16000,
  channels: number = 1
): Promise<Buffer> {
  if (!isOpusEncoderAvailable()) {
    const reason = process.env.OPUS_ENCODING_ENABLED === 'false'
      ? 'disabled_by_env'
      : 'not_initialized';
    logger.error(
      {
        reason,
        opusEncodingEnabled: process.env.OPUS_ENCODING_ENABLED !== 'false',
      },
      'Opus encoder is not available'
    );
    throw new Error(`Opus encoder is not available (reason: ${reason})`);
  }

  try {
    const opusData = await encodePcm16ToOpus(pcm16Data, sampleRate, channels);

    if (!opusData || opusData.length === 0) {
      throw new Error('Opus encoding produced empty data');
    }

    const hasNonZero = opusData.some((byte: number) => byte !== 0);
    if (!hasNonZero) {
      logger.error(
        {
          opusSize: opusData.length,
          pcm16Size: pcm16Data.length,
          sampleRate,
        },
        'Opus encoding produced all-zero data'
      );
      throw new Error('Opus encoding produced all-zero data');
    }

    return opusData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        error,
        pcm16Size: pcm16Data.length,
        sampleRate,
        channels,
        errorMessage,
      },
      'Opus encoding failed'
    );
    throw new Error(`Opus encoding failed: ${errorMessage}`);
  }
}

/**
 * 将 WAV Buffer 转换为 Opus 编码的 Buffer
 */
export async function convertWavToOpus(wavBuffer: Buffer): Promise<Buffer> {
  try {
    const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);

    const opusData = await encodePcm16ToOpusBuffer(pcm16Data, sampleRate, channels);

    logger.debug(
      {
        wavSize: wavBuffer.length,
        opusSize: opusData.length,
        compression: (wavBuffer.length / opusData.length).toFixed(2),
        sampleRate,
        channels,
      },
      'WAV converted to Opus successfully'
    );

    return opusData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        error,
        wavSize: wavBuffer.length,
        errorMessage,
      },
      'Failed to convert WAV to Opus'
    );
    throw new Error(`Failed to convert WAV to Opus: ${errorMessage}`);
  }
}
