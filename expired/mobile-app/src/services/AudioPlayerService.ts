/**
 * 音频播放服务
 * 对应 iOS 文档中的 AudioPlayerService
 * 用于播放 TTS 音频（PCM16 格式）
 */

import { Audio } from 'expo-av';
import { Platform } from 'react-native';

export interface AudioPlayerConfig {
  sampleRate?: number; // 默认 16000
  channels?: number; // 默认 1 (单声道)
  bitDepth?: number; // 默认 16
}

export class AudioPlayerService {
  private sound: Audio.Sound | null = null;
  private config: Required<AudioPlayerConfig>;
  private isPlaying = false;

  constructor(config: AudioPlayerConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16,
    };
  }

  /**
   * 播放 PCM16 音频数据
   * @param pcmData PCM 16-bit 音频数据
   */
  async playPcm16(pcmData: Uint8Array): Promise<void> {
    try {
      // 停止当前播放
      await this.stop();

      // 将 PCM16 数据转换为 WAV 格式（expo-av 需要）
      const wavData = this.pcm16ToWav(pcmData);

      // 将 WAV 数据转换为 base64
      const base64Wav = this.arrayBufferToBase64(wavData.buffer);

      // 创建临时 URI（在实际应用中，可能需要将数据写入文件）
      // 这里使用 base64 data URI（注意：expo-av 可能不支持，需要写入文件）
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'data:audio/wav;base64,' + base64Wav },
        { shouldPlay: true }
      );

      this.sound = sound;
      this.isPlaying = true;

      // 监听播放完成
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          this.isPlaying = false;
        }
      });
    } catch (error) {
      console.error('播放音频失败:', error);
      throw error;
    }
  }

  /**
   * 停止播放
   */
  async stop(): Promise<void> {
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
      } catch (error) {
        console.error('停止播放失败:', error);
      }
      this.sound = null;
      this.isPlaying = false;
    }
  }

  /**
   * 暂停播放
   */
  async pause(): Promise<void> {
    if (this.sound && this.isPlaying) {
      try {
        await this.sound.pauseAsync();
        this.isPlaying = false;
      } catch (error) {
        console.error('暂停播放失败:', error);
      }
    }
  }

  /**
   * 恢复播放
   */
  async resume(): Promise<void> {
    if (this.sound && !this.isPlaying) {
      try {
        await this.sound.playAsync();
        this.isPlaying = true;
      } catch (error) {
        console.error('恢复播放失败:', error);
      }
    }
  }

  /**
   * 将 PCM16 数据转换为 WAV 格式
   * 注意：这是一个简化的实现，实际应用中可能需要更完善的 WAV 编码
   */
  private pcm16ToWav(pcmData: Uint8Array): Uint8Array {
    const sampleRate = this.config.sampleRate;
    const channels = this.config.channels;
    const bitsPerSample = this.config.bitDepth;
    const dataSize = pcmData.length;
    const fileSize = 36 + dataSize;

    // WAV 文件头
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // RIFF header
    view.setUint8(0, 0x52); // 'R'
    view.setUint8(1, 0x49); // 'I'
    view.setUint8(2, 0x46); // 'F'
    view.setUint8(3, 0x46); // 'F'
    view.setUint32(4, fileSize, true);
    view.setUint8(8, 0x57); // 'W'
    view.setUint8(9, 0x41); // 'A'
    view.setUint8(10, 0x56); // 'V'
    view.setUint8(11, 0x45); // 'E'

    // fmt chunk
    view.setUint8(12, 0x66); // 'f'
    view.setUint8(13, 0x6d); // 'm'
    view.setUint8(14, 0x74); // 't'
    view.setUint8(15, 0x20); // ' '
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true); // byte rate
    view.setUint16(32, channels * (bitsPerSample / 8), true); // block align
    view.setUint16(34, bitsPerSample, true);

    // data chunk
    view.setUint8(36, 0x64); // 'd'
    view.setUint8(37, 0x61); // 'a'
    view.setUint8(38, 0x74); // 't'
    view.setUint8(39, 0x61); // 'a'
    view.setUint32(40, dataSize, true);

    // 合并 header 和 data
    const wavData = new Uint8Array(44 + dataSize);
    wavData.set(new Uint8Array(header), 0);
    wavData.set(pcmData, 44);

    return wavData;
  }

  /**
   * 获取播放状态
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<AudioPlayerConfig> {
    return { ...this.config };
  }

  /**
   * 将 ArrayBuffer 转换为 base64 字符串
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}

