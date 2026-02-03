/**
 * Opus 解码：初始化解码器、解码 Base64 Opus 为 PCM16（Plan A length-prefixed packets）
 */

import logger from '../logger';

type OpusDecoderType = any;

let decoderInstance: OpusDecoderType | null = null;
let decoderConfig: { sampleRate: number; channels: number } | null = null;
let decoderInitPromise: Promise<void> | null = null;

async function initializeOpusDecoder(
  sampleRate: number = 16000,
  channels: number = 1
): Promise<void> {
  if (decoderInstance && decoderConfig) {
    if (decoderConfig.sampleRate === sampleRate && decoderConfig.channels === channels) {
      return;
    }
    if (decoderInstance.free) {
      decoderInstance.free();
    }
    decoderInstance = null;
    decoderConfig = null;
  }

  if (decoderInitPromise) {
    await decoderInitPromise;
    return;
  }

  decoderInitPromise = (async () => {
    try {
      let opusDecoderModule: any;
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        opusDecoderModule = await dynamicImport('opus-decoder');
      } catch (importError: any) {
        if (importError.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG') {
          try {
            opusDecoderModule = require('opus-decoder');
          } catch (requireError) {
            throw new Error('opus-decoder is not available. Please install it: npm install opus-decoder');
          }
        } else {
          throw importError;
        }
      }
      const { OpusDecoder } = opusDecoderModule;

      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(sampleRate)) {
        const closestRate = validSampleRates.reduce((prev, curr) => {
          return Math.abs(curr - sampleRate) < Math.abs(prev - sampleRate) ? curr : prev;
        });
        logger.warn(
          {
            originalRate: sampleRate,
            targetRate: closestRate,
          },
          `Sample rate ${sampleRate} not supported by Opus decoder, using ${closestRate} instead`
        );
        sampleRate = closestRate as 8000 | 12000 | 16000 | 24000 | 48000;
      }

      decoderInstance = new OpusDecoder({
        sampleRate: sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        channels: channels,
      });

      if (decoderInstance.ready) {
        await decoderInstance.ready;
      }

      decoderConfig = { sampleRate, channels };
      logger.info(`Opus decoder initialized: sampleRate=${sampleRate}, channels=${channels}`);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to initialize Opus decoder');
      decoderInstance = null;
      decoderConfig = null;
      throw error;
    } finally {
      decoderInitPromise = null;
    }
  })();

  await decoderInitPromise;
}

/**
 * 解码 Opus 音频为 PCM16（与 Web 客户端一致，opus-decoder 库，Plan A 格式）
 */
export async function decodeOpusToPcm16(
  opusDataBase64: string,
  sampleRate: number = 16000
): Promise<Buffer> {
  try {
    await initializeOpusDecoder(sampleRate, 1);

    if (!decoderInstance) {
      throw new Error('Opus decoder initialization failed');
    }

    const opusData = Buffer.from(opusDataBase64, 'base64');

    const decodedChunks: Float32Array[] = [];
    let offset = 0;
    const frameHeaderSize = 2;
    let packetCount = 0;
    let validPacketCount = 0;
    let invalidPacketCount = 0;
    let decodeErrorCount = 0;

    logger.debug(
      {
        opusDataLength: opusData.length,
        sampleRate,
      },
      'Starting Opus packet decoding (Plan A format)'
    );

    while (offset < opusData.length) {
      if (offset + frameHeaderSize > opusData.length) {
        logger.warn(
          {
            offset,
            totalLength: opusData.length,
            remainingBytes: opusData.length - offset,
          },
          'Incomplete Opus packet header at end of data'
        );
        break;
      }

      const packetLength = opusData.readUInt16LE(offset);
      offset += frameHeaderSize;
      packetCount++;

      if (packetLength === 0) {
        logger.warn(
          { packetIndex: packetCount, offset },
          'Zero-length Opus packet detected, skipping'
        );
        invalidPacketCount++;
        continue;
      }

      if (packetLength > 4096) {
        logger.warn(
          { packetIndex: packetCount, packetLength, offset },
          'Opus packet length exceeds maximum (4096 bytes), skipping'
        );
        invalidPacketCount++;
        continue;
      }

      if (offset + packetLength > opusData.length) {
        logger.warn(
          {
            packetIndex: packetCount,
            packetLength,
            offset,
            totalLength: opusData.length,
            availableBytes: opusData.length - offset,
          },
          'Incomplete Opus packet data'
        );
        break;
      }

      const packetData = opusData.slice(offset, offset + packetLength);
      offset += packetLength;

      try {
        const decoded = decoderInstance.decodeFrame(packetData);

        if (decoded && decoded.channelData && decoded.channelData.length > 0) {
          if (decoded.channelData.length === 1) {
            if (decoded.channelData[0].length > 0) {
              decodedChunks.push(decoded.channelData[0]);
              validPacketCount++;
            } else {
              logger.debug(
                { packetIndex: packetCount, packetLength },
                'Decoded packet has empty channel data, skipping'
              );
            }
          } else {
            const merged = new Float32Array(decoded.channelData[0].length);
            for (let i = 0; i < merged.length; i++) {
              let sum = 0;
              for (let ch = 0; ch < decoded.channelData.length; ch++) {
                sum += decoded.channelData[ch][i];
              }
              merged[i] = sum / decoded.channelData.length;
            }
            if (merged.length > 0) {
              decodedChunks.push(merged);
              validPacketCount++;
            } else {
              logger.debug(
                { packetIndex: packetCount, packetLength },
                'Merged multi-channel packet has empty data, skipping'
              );
            }
          }
        } else {
          logger.debug(
            {
              packetIndex: packetCount,
              packetLength,
              hasDecoded: !!decoded,
              hasChannelData: decoded && !!decoded.channelData,
              channelDataLength: decoded && decoded.channelData ? decoded.channelData.length : 0,
            },
            'Decoded packet has no valid channel data, skipping'
          );
        }
      } catch (decodeError) {
        decodeErrorCount++;
        logger.warn(
          {
            error: decodeError instanceof Error ? decodeError.message : String(decodeError),
            packetIndex: packetCount,
            packetLength,
            offset,
            packetDataPreview: packetData.slice(0, Math.min(16, packetData.length)).toString('hex'),
          },
          'Failed to decode Opus packet, skipping'
        );
      }
    }

    logger.info(
      {
        totalPackets: packetCount,
        validPackets: validPacketCount,
        invalidPackets: invalidPacketCount,
        decodeErrors: decodeErrorCount,
        decodedChunks: decodedChunks.length,
        opusDataLength: opusData.length,
      },
      'Opus packet decoding summary'
    );

    if (decodedChunks.length === 0) {
      const errorMessage = `No audio data decoded from Opus packets. Processed ${packetCount} packets: ${validPacketCount} valid, ${invalidPacketCount} invalid, ${decodeErrorCount} decode errors. Opus data length: ${opusData.length} bytes. This may indicate that the audio data is not in Plan A format (length-prefixed packets).`;
      logger.error(
        {
          packetCount,
          validPacketCount,
          invalidPacketCount,
          decodeErrorCount,
          opusDataLength: opusData.length,
          opusDataPreview: opusData.slice(0, Math.min(32, opusData.length)).toString('hex'),
        },
        errorMessage
      );
      throw new Error(errorMessage);
    }

    const totalLength = decodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const mergedAudio = new Float32Array(totalLength);
    let mergedOffset = 0;
    for (const chunk of decodedChunks) {
      mergedAudio.set(chunk, mergedOffset);
      mergedOffset += chunk.length;
    }

    const pcm16BufferLength = mergedAudio.length * 2;
    const pcm16Buffer = Buffer.allocUnsafe(pcm16BufferLength);
    for (let i = 0; i < mergedAudio.length; i++) {
      const int16Value = Math.max(-32768, Math.min(32767, Math.round(mergedAudio[i] * 32768)));
      pcm16Buffer.writeInt16LE(int16Value, i * 2);
    }

    if (pcm16Buffer.length % 2 !== 0) {
      logger.error(
        {
          pcm16BufferLength: pcm16Buffer.length,
          decodedSamples: mergedAudio.length,
          expectedLength: mergedAudio.length * 2,
          isOdd: pcm16Buffer.length % 2 !== 0,
          opusDataLength: opusData.length,
        },
        '🚨 CRITICAL: PCM16 buffer length is not a multiple of 2! This will cause ASR service to fail.'
      );
      const fixedLength = pcm16Buffer.length - (pcm16Buffer.length % 2);
      const fixedBuffer = pcm16Buffer.slice(0, fixedLength);
      logger.warn(
        {
          originalLength: pcm16Buffer.length,
          fixedLength: fixedBuffer.length,
          bytesRemoved: pcm16Buffer.length - fixedBuffer.length,
        },
        'Fixed PCM16 buffer length by truncating last byte(s)'
      );
      logger.info(
        {
          opusDataLength: opusData.length,
          pcm16DataLength: fixedBuffer.length,
          decodedSamples: mergedAudio.length,
          sampleRate,
          duration: (fixedBuffer.length / 2 / sampleRate).toFixed(2) + 's',
          wasFixed: true,
        },
        'Opus audio decoded to PCM16 successfully (length was fixed)'
      );
      return fixedBuffer;
    }

    logger.info(
      {
        opusDataLength: opusData.length,
        pcm16DataLength: pcm16Buffer.length,
        decodedSamples: mergedAudio.length,
        sampleRate,
        duration: (mergedAudio.length / sampleRate).toFixed(2) + 's',
        isLengthValid: pcm16Buffer.length % 2 === 0,
      },
      'Opus audio decoded to PCM16 successfully'
    );

    return pcm16Buffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        error,
        opusDataLength: opusDataBase64.length,
        sampleRate,
        errorMessage,
      },
      'Failed to decode Opus audio'
    );
    throw new Error(`Opus decoding failed: ${errorMessage}`);
  }
}
