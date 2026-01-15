/**
 * WebSocket 音频发送模块
 * 负责音频数据的编码和发送
 */

import { AudioEncoder, AudioCodecConfig } from '../audio_codec';
import { encodeAudioChunkFrame, encodeFinalFrame, BinaryFrameType, AudioChunkBinaryFrame, FinalBinaryFrame } from '../binary_protocol';
import { BackpressureManager, BackpressureState } from './backpressure_manager';
import { logger } from '../logger';

/**
 * 音频发送器
 */
export class AudioSender {
  private audioEncoder: AudioEncoder | null = null;
  private audioCodecConfig: AudioCodecConfig | null = null;
  private useBinaryFrame: boolean = false;
  private negotiatedCodec: string = 'pcm16';
  private sequence: number = 0;
  private backpressureManager: BackpressureManager;
  private sendCallback: (data: string | ArrayBuffer) => void;
  private sessionId: string | null = null;

  constructor(
    backpressureManager: BackpressureManager,
    sendCallback: (data: string | ArrayBuffer) => void
  ) {
    this.backpressureManager = backpressureManager;
    this.sendCallback = sendCallback;
  }

  /**
   * 设置会话 ID
   */
  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  /**
   * 设置音频编解码器配置
   */
  setAudioCodecConfig(config: AudioCodecConfig): void {
    this.audioCodecConfig = config;
    if (this.audioEncoder) {
      this.audioEncoder.close();
    }
    this.audioEncoder = createAudioEncoder(config);
    logger.info('AudioSender', 'Audio encoder created', { codec: config.codec });
  }

  /**
   * 设置音频编码器（从 MessageHandler 获取）
   */
  setAudioEncoder(encoder: AudioEncoder | null): void {
    if (this.audioEncoder && this.audioEncoder !== encoder) {
      this.audioEncoder.close();
    }
    this.audioEncoder = encoder;
  }

  /**
   * 设置协议配置
   */
  setProtocolConfig(useBinaryFrame: boolean, negotiatedCodec: string): void {
    this.useBinaryFrame = useBinaryFrame;
    this.negotiatedCodec = negotiatedCodec;
  }

  /**
   * 发送音频块
   */
  async sendAudioChunk(audioData: Float32Array, isFinal: boolean = false): Promise<void> {
    if (!this.sessionId) {
      logger.warn('AudioSender', 'Session ID not set, cannot send audio chunk');
      return;
    }

    // 根据背压状态决定发送策略
    if (this.backpressureManager.shouldPause()) {
      // 暂停：加入队列
      this.backpressureManager.enqueueAudio(audioData, isFinal);
      return;
    }

    if (!this.backpressureManager.shouldSendImmediately()) {
      // 降速：加入队列
      this.backpressureManager.enqueueAudio(audioData, isFinal);
      return;
    }

    // 正常：直接发送
    await this.sendAudioChunkInternal(audioData, isFinal);
  }

  /**
   * 获取发送回调（用于 BackpressureManager）
   */
  getSendCallback(): (data: Float32Array, isFinal: boolean) => Promise<void> {
    return async (data: Float32Array, isFinal: boolean) => {
      await this.sendAudioChunkInternal(data, isFinal);
    };
  }

  /**
   * 内部发送方法
   */
  private async sendAudioChunkInternal(audioData: Float32Array, isFinal: boolean): Promise<void> {
    try {
      if (this.useBinaryFrame && this.audioEncoder && this.sessionId) {
        // Binary Frame 模式
        // Opus 必须使用 Plan A 格式（packet 格式），与 JSON 模式保持一致
        let encodedAudio: Uint8Array;
        
        if (this.audioCodecConfig?.codec === 'opus') {
          const encoder = this.audioEncoder as any;
          if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
            const opusPackets = await encoder.encodePackets(audioData);
            
            // Plan A 格式打包：每个 packet 前面加上 2 字节的长度前缀
            const packetDataParts: Uint8Array[] = [];
            let totalSize = 0;
            
            for (const packet of opusPackets) {
              if (packet.length === 0) {
                continue; // 跳过空 packet
              }
              
              if (packet.length > 65535) {
                logger.error('AudioSender', `Packet too large: ${packet.length} bytes (max 65535)`);
                throw new Error(`Opus packet too large: ${packet.length} bytes`);
              }
              
              const lenBuffer = new ArrayBuffer(2);
              const lenView = new DataView(lenBuffer);
              lenView.setUint16(0, packet.length, true); // little-endian
              
              packetDataParts.push(new Uint8Array(lenBuffer));
              packetDataParts.push(packet);
              totalSize += 2 + packet.length;
            }
            
            if (packetDataParts.length === 0) {
              throw new Error('No valid Opus packets after encoding');
            }
            
            encodedAudio = new Uint8Array(totalSize);
            let offset = 0;
            for (const part of packetDataParts) {
              encodedAudio.set(part, offset);
              offset += part.length;
            }
          } else {
            throw new Error('Opus encoder does not support encodePackets()');
          }
        } else {
          // PCM16 或其他格式，使用 encode() 方法
          encodedAudio = await this.audioEncoder.encode(audioData);
        }
        
        const sendTimestamp = Date.now();
        const frame: AudioChunkBinaryFrame = {
          frameType: BinaryFrameType.AUDIO_CHUNK,
          sessionId: this.sessionId,
          seq: this.sequence++,
          timestamp: sendTimestamp,
          isFinal: isFinal,
          audioData: encodedAudio,
        };
        logger.debug('AudioSender', '发送 audio_chunk 二进制帧', {
          timestamp: sendTimestamp,
          timestampIso: new Date(sendTimestamp).toISOString(),
          seq: frame.seq,
          is_final: isFinal,
          audioDataSize: encodedAudio.length,
          sessionId: this.sessionId,
        });
        const binaryFrame = encodeAudioChunkFrame(frame);
        // 将 Uint8Array 转换为 ArrayBuffer（确保是 ArrayBuffer 而不是 SharedArrayBuffer）
        const arrayBuffer = binaryFrame.buffer instanceof SharedArrayBuffer
          ? binaryFrame.buffer.slice(binaryFrame.byteOffset, binaryFrame.byteOffset + binaryFrame.byteLength)
          : binaryFrame.buffer.slice(binaryFrame.byteOffset, binaryFrame.byteOffset + binaryFrame.byteLength);
        this.sendCallback(arrayBuffer as ArrayBuffer);
      } else {
        // JSON 模式
        let base64: string;
        if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
          // Opus 必须使用 Plan A 格式（packet 格式）
          const encoder = this.audioEncoder as any;
          if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
            const opusPackets = await encoder.encodePackets(audioData);
            
            // Plan A 格式打包：每个 packet 前面加上 2 字节的长度前缀
            const packetDataParts: Uint8Array[] = [];
            let totalSize = 0;
            
            for (const packet of opusPackets) {
              if (packet.length === 0) {
                continue; // 跳过空 packet
              }
              
              if (packet.length > 65535) {
                logger.error('AudioSender', `Packet too large: ${packet.length} bytes (max 65535)`);
                throw new Error(`Opus packet too large: ${packet.length} bytes`);
              }
              
              const lenBuffer = new ArrayBuffer(2);
              const lenView = new DataView(lenBuffer);
              lenView.setUint16(0, packet.length, true);
              
              packetDataParts.push(new Uint8Array(lenBuffer));
              packetDataParts.push(packet);
              totalSize += 2 + packet.length;
            }
            
            if (packetDataParts.length === 0) {
              throw new Error('No valid Opus packets after encoding');
            }
            
            const encodedAudio = new Uint8Array(totalSize);
            let offset = 0;
            for (const part of packetDataParts) {
              encodedAudio.set(part, offset);
              offset += part.length;
            }
            
            base64 = this.arrayBufferToBase64(encodedAudio);
          } else {
            throw new Error('Opus encoder does not support encodePackets()');
          }
        } else {
          // PCM16
          const int16Array = new Int16Array(audioData.length);
          for (let i = 0; i < audioData.length; i++) {
            const s = Math.max(-1, Math.min(1, audioData[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          base64 = this.arrayBufferToBase64(new Uint8Array(int16Array.buffer));
        }

        const message = {
          type: 'audio_chunk',
          session_id: this.sessionId,
          seq: this.sequence++,
          is_final: isFinal,
          payload: base64,
        };
        this.sendCallback(JSON.stringify(message));
      }
    } catch (error) {
      logger.error('AudioSender', 'Failed to send audio chunk', { error });
      throw error;
    }
  }

  /**
   * 发送最终帧
   * 在 JSON 模式下，发送一个空的 audio_chunk 消息，is_final=true，触发服务器 finalize
   */
  async sendFinal(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      if (this.useBinaryFrame && this.sessionId) {
        // Binary Frame 模式：发送 FINAL 帧
        const sendFinalTimestamp = Date.now();
        const frame: FinalBinaryFrame = {
          frameType: BinaryFrameType.FINAL,
          sessionId: this.sessionId,
          seq: this.sequence++,
          timestamp: sendFinalTimestamp,
        };
        logger.info('AudioSender', '📤 发送 finalize 信号（Binary Frame: FINAL）', {
          timestamp: sendFinalTimestamp,
          timestampIso: new Date(sendFinalTimestamp).toISOString(),
          sessionId: this.sessionId,
          seq: frame.seq,
        });
        const binaryFrame = encodeFinalFrame(frame);
        // 将 Uint8Array 转换为 ArrayBuffer（确保是 ArrayBuffer 而不是 SharedArrayBuffer）
        const arrayBuffer = binaryFrame.buffer instanceof SharedArrayBuffer
          ? new Uint8Array(binaryFrame).buffer
          : binaryFrame.buffer.slice(binaryFrame.byteOffset, binaryFrame.byteOffset + binaryFrame.byteLength);
        this.sendCallback(arrayBuffer as ArrayBuffer);
      } else {
        // JSON 模式：发送一个空的 audio_chunk 消息，is_final=true
        // 服务器会根据 is_final=true 触发 finalize
        const message = {
          type: 'audio_chunk',
          session_id: this.sessionId,
          seq: this.sequence++,
          is_final: true,
          payload: '', // 空 payload，只用于触发 finalize
        };
        const sendFinalTimestamp = Date.now();
        logger.info('AudioSender', '📤 发送 finalize 信号（is_final=true 的 audio_chunk）', {
          timestamp: sendFinalTimestamp,
          timestampIso: new Date(sendFinalTimestamp).toISOString(),
          sessionId: this.sessionId,
          seq: message.seq,
          is_final: true,
        });
        this.sendCallback(JSON.stringify(message));
      }
    } catch (error) {
      logger.error('AudioSender', 'Failed to send final', { error });
      throw error;
    }
  }

  /**
   * 发送 Utterance 消息
   */
  async sendUtterance(
    audioData: Float32Array,
    utteranceIndex: number,
    srcLang: string,
    tgtLang: string,
    traceId?: string,
    pipeline?: {
      use_asr?: boolean;
      use_nmt?: boolean;
      use_tts?: boolean;
      use_tone?: boolean;
    }
  ): Promise<void> {
    if (!this.sessionId) {
      logger.warn('AudioSender', 'Session ID not set, cannot send utterance');
      return;
    }

    try {
      let encodedAudio: Uint8Array;
      let audioFormat: string;

      if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
        const encoder = this.audioEncoder as any;
        let opusPackets: Uint8Array[];

        logger.debug('AudioSender', 'Encoding audio with Opus', {
          audio_samples: audioData.length,
          sample_rate: this.audioCodecConfig.sampleRate,
          frame_size_ms: this.audioCodecConfig.frameSizeMs,
        });

        if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
          opusPackets = await encoder.encodePackets(audioData);
          logger.debug('AudioSender', 'Opus encoding complete', {
            packet_count: opusPackets.length,
            total_packets_size: opusPackets.reduce((sum, p) => sum + p.length, 0),
            packet_sizes: opusPackets.map(p => p.length),
          });
        } else {
          throw new Error('Opus encoder does not support encodePackets()');
        }

        // 验证编码结果
        if (!opusPackets || opusPackets.length === 0) {
          throw new Error('Opus encoding produced no packets');
        }

        const flushData = await this.audioEncoder.flush();
        if (flushData.length > 0) {
          logger.debug('AudioSender', `Flush data: ${flushData.length} bytes`);
          opusPackets.push(flushData);
        }

        // Plan A 格式打包
        const packetDataParts: Uint8Array[] = [];
        let totalSize = 0;
        let validPackets = 0;
        let emptyPackets = 0;

        for (const packet of opusPackets) {
          if (packet.length === 0) {
            emptyPackets++;
            logger.warn('AudioSender', `Skipping empty packet (${emptyPackets} total)`);
            continue;
          }

          if (packet.length > 65535) {
            console.error(`[AudioSender] Packet too large: ${packet.length} bytes (max 65535)`);
            throw new Error(`Opus packet too large: ${packet.length} bytes`);
          }

          const lenBuffer = new ArrayBuffer(2);
          const lenView = new DataView(lenBuffer);
          lenView.setUint16(0, packet.length, true);

          packetDataParts.push(new Uint8Array(lenBuffer));
          packetDataParts.push(packet);
          totalSize += 2 + packet.length;
          validPackets++;
        }

        if (validPackets === 0) {
          throw new Error('No valid Opus packets after encoding (all packets were empty)');
        }

        logger.debug('AudioSender', 'Plan A format packing', {
          valid_packets: validPackets,
          empty_packets: emptyPackets,
          total_size_bytes: totalSize,
          header_size: validPackets * 2,
          audio_size: totalSize - validPackets * 2,
        });

        encodedAudio = new Uint8Array(totalSize);
        let offset = 0;
        for (const part of packetDataParts) {
          encodedAudio.set(part, offset);
          offset += part.length;
        }

        // 验证最终数据
        if (encodedAudio.length === 0) {
          throw new Error('Encoded audio is empty after Plan A packing');
        }

        audioFormat = 'opus';
      } else {
        throw new Error('Opus encoder not available');
      }

      const base64 = this.arrayBufferToBase64(encodedAudio);

      const message: any = {
        type: 'utterance',
        session_id: this.sessionId,
        utterance_index: utteranceIndex,
        manual_cut: true,
        src_lang: srcLang,
        tgt_lang: tgtLang,
        dialect: null, // 协议要求，即使不使用也需包含
        audio: base64,
        audio_format: audioFormat,
        sample_rate: 16000,
        trace_id: traceId,
      };

      // 如果提供了 pipeline 配置，添加到消息中
      if (pipeline) {
        message.pipeline = pipeline;
      }

      logger.info('AudioSender', 'Sending utterance', {
        utterance_index: utteranceIndex,
        audio_format: audioFormat,
        audio_size_bytes: encodedAudio.length,
        base64_size: base64.length,
        trace_id: traceId,
      });

      this.sendCallback(JSON.stringify(message));
    } catch (error) {
      logger.error('AudioSender', 'Failed to send utterance', { error });
      throw error;
    }
  }

  /**
   * 将 ArrayBuffer 转换为 Base64
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    if (buffer.length < 65536) {
      return btoa(String.fromCharCode(...buffer));
    } else {
      const chunks: string[] = [];
      for (let i = 0; i < buffer.length; i += 8192) {
        const chunk = buffer.slice(i, i + 8192);
        chunks.push(String.fromCharCode(...chunk));
      }
      return btoa(chunks.join(''));
    }
  }

  /**
   * 重置序列号
   */
  resetSequence(): void {
    this.sequence = 0;
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.audioEncoder) {
      this.audioEncoder.close();
      this.audioEncoder = null;
    }
  }
}

// 导入 createAudioEncoder
import { createAudioEncoder } from '../audio_codec';

