/**
 * 音频采集服务
 * 对应 iOS 文档中的 AudioCaptureService
 * 使用 expo-av 实现音频采集
 */

import { Audio } from 'expo-av';
import { Platform } from 'react-native';

export interface AudioCaptureConfig {
  sampleRate?: number; // 默认 16000
  channels?: number; // 默认 1 (单声道)
  bitDepth?: number; // 默认 16
  frameDurationMs?: number; // 默认 20ms
}

export interface AudioFrame {
  data: Int16Array; // PCM 16-bit 数据
  timestamp: number;
}

export type AudioFrameCallback = (frame: AudioFrame) => void;

export class AudioCaptureService {
  private recording: Audio.Recording | null = null;
  private isRunning = false;
  private onPcmFrameCallback: AudioFrameCallback | null = null;
  private config: Required<AudioCaptureConfig>;
  private frameBuffer: Int16Array[] = [];
  private sequence = 0;

  constructor(config: AudioCaptureConfig = {}) {
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16,
      frameDurationMs: config.frameDurationMs || 20,
    };
  }

  /**
   * 设置 PCM 帧回调
   */
  setOnPcmFrame(callback: AudioFrameCallback | null) {
    this.onPcmFrameCallback = callback;
  }

  /**
   * 启动音频采集
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('音频采集已在运行');
      return;
    }

    try {
      // 请求权限
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('麦克风权限未授予');
      }

      // 配置音频模式（iOS 使用 voiceChat 模式启用 AEC）
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        // iOS 特定配置
        ...(Platform.OS === 'ios' && {
          interruptionModeIOS: Audio.InterruptionModeIOS.DoNotMix,
          interruptionModeAndroid: Audio.InterruptionModeAndroid.DoNotMix,
        }),
      });

      // 创建录音实例
      const { recording } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.wav',
            outputFormat: Audio.AndroidOutputFormat.DEFAULT,
            audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
            sampleRate: this.config.sampleRate,
            numberOfChannels: this.config.channels,
            bitRate: this.config.bitDepth,
          },
          ios: {
            extension: '.wav',
            outputFormat: Audio.IOSOutputFormat.LINEARPCM,
            audioQuality: Audio.IOSAudioQuality.HIGH,
            sampleRate: this.config.sampleRate,
            numberOfChannels: this.config.channels,
            bitRate: this.config.bitDepth,
            linearPCMBitDepth: 16,
            linearPCMIsBigEndian: false,
            linearPCMIsFloat: false,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: this.config.sampleRate * this.config.bitDepth * this.config.channels,
          },
        },
        (status) => {
          // 录音状态更新回调
          if (status.isRecording && status.durationMillis) {
            // 定期处理音频数据
            this.processAudioData();
          }
        }
      );

      this.recording = recording;
      this.isRunning = true;
      this.sequence = 0;
      this.frameBuffer = [];

      console.log('音频采集已启动');
    } catch (error) {
      console.error('启动音频采集失败:', error);
      throw error;
    }
  }

  /**
   * 停止音频采集
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.recording) {
      return;
    }

    try {
      await this.recording.stopAndUnloadAsync();
      this.recording = null;
      this.isRunning = false;
      this.frameBuffer = [];

      console.log('音频采集已停止');
    } catch (error) {
      console.error('停止音频采集失败:', error);
      throw error;
    }
  }

  /**
   * 处理音频数据
   * 注意：expo-av 不直接提供实时 PCM 数据回调
   * 这里需要从录音文件中读取数据
   * 实际实现中可能需要使用原生模块或第三方库
   */
  private async processAudioData() {
    // TODO: 实现实时音频数据处理
    // expo-av 的限制：无法直接获取实时 PCM 数据
    // 需要：
    // 1. 使用 expo-av 的录音功能，定期读取录音文件
    // 2. 或使用 react-native-audio-recorder-player 等库
    // 3. 或创建原生模块直接访问 AVAudioEngine

    // 当前为占位实现
    if (this.onPcmFrameCallback) {
      // 模拟 PCM 数据（实际应从录音缓冲区获取）
      const frameSize = (this.config.sampleRate * this.config.frameDurationMs) / 1000;
      const frameData = new Int16Array(frameSize);
      
      this.onPcmFrameCallback({
        data: frameData,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 获取当前运行状态
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<AudioCaptureConfig> {
    return { ...this.config };
  }
}

