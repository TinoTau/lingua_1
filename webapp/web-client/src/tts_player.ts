import { StateMachine } from './state_machine';
import { createAudioDecoder, AudioCodecConfig, AudioDecoder } from './audio_codec';
import { MemoryManager, getMaxBufferDuration, getDeviceType, MemoryPressureCallback } from './tts_player/memory_manager';

export type PlaybackFinishedCallback = () => void;
export type PlaybackIndexChangeCallback = (utteranceIndex: number) => void;

/**
 * TTS 播放模块
 * 支持流式播放 PCM16 音频
 * 支持手动播放/暂停控制
 * 支持自适应缓存限制（根据设备类型）
 */
interface AudioBufferWithIndex {
  audio: Float32Array;
  utteranceIndex: number;
}

export class TtsPlayer {
  private audioContext: AudioContext | null = null;
  private audioBuffers: AudioBufferWithIndex[] = []; // 修改为包含 utteranceIndex 的结构
  private isPlaying: boolean = false;
  private isPaused: boolean = false;
  private stateMachine: StateMachine;
  private playbackFinishedCallback: PlaybackFinishedCallback | null = null;
  private playbackIndexChangeCallback: PlaybackIndexChangeCallback | null = null; // 播放索引变化回调
  private currentSource: AudioBufferSourceNode | null = null; // 当前播放的音频源
  private currentPlaybackIndex: number = -1; // 当前播放的索引（从0开始）
  private sampleRate: number = 16000; // 采样率
  private playbackRate: number = 1.0; // 播放倍速（1.0 = 正常速度）
  private readonly playbackRates: number[] = [1.0, 1.25, 1.5, 2.0]; // 可用的倍速选项
  private currentRateIndex: number = 0; // 当前倍速索引
  private maxBufferDuration: number; // 最大缓存时长（秒）
  private memoryManager: MemoryManager; // 内存管理器
  private audioDecoder: AudioDecoder | null = null; // 音频解码器（支持PCM16和Opus）
  private currentTtsFormat: string = 'pcm16'; // 当前TTS音频格式

  constructor(stateMachine: StateMachine) {
    this.stateMachine = stateMachine;
    this.maxBufferDuration = getMaxBufferDuration();
    console.log(`[TtsPlayer] 初始化，最大缓存时长: ${this.maxBufferDuration}秒 (设备类型: ${getDeviceType()})`);

    // 初始化内存管理器
    this.memoryManager = new MemoryManager(
      this.maxBufferDuration,
      () => this.getTotalDuration(),
      () => this.removeOldestBuffer()
    );

    // 监听页面可见性变化（手机端后台标签页处理）
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.memoryManager.handlePageHidden(() => this.removeOldestBuffer());
        } else {
          // 页面恢复可见时，重新开始内存监控
          this.memoryManager.startMemoryMonitoring();
        }
      });
    }

    // 开始内存监控
    this.memoryManager.startMemoryMonitoring();
  }

  /**
   * 移除最旧的音频缓冲区
   */
  private removeOldestBuffer(): void {
    if (this.audioBuffers.length > 0) {
      this.audioBuffers.shift();
    }
  }

  /**
   * 设置播放完成回调
   */
  setPlaybackFinishedCallback(callback: PlaybackFinishedCallback): void {
    this.playbackFinishedCallback = callback;
  }

  /**
   * 设置播放索引变化回调（用于文本显示同步）
   */
  setPlaybackIndexChangeCallback(callback: PlaybackIndexChangeCallback): void {
    this.playbackIndexChangeCallback = callback;
  }

  /**
   * 设置内存压力回调
   */
  setMemoryPressureCallback(callback: MemoryPressureCallback): void {
    this.memoryManager.setMemoryPressureCallback(callback);
  }

  /**
   * 获取当前内存压力状态
   */
  getMemoryPressure(): 'normal' | 'warning' | 'critical' {
    return this.memoryManager.getMemoryPressure();
  }

  /**
   * 初始化音频上下文
   */
  private async ensureAudioContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * 添加音频块（流式）
   * @param base64Data base64编码的音频数据
   * @param utteranceIndex 对应的 utterance_index（用于文本显示同步）
   * @param ttsFormat 音频格式（'pcm16' | 'opus'），默认为 'pcm16'
   */
  async addAudioChunk(base64Data: string, utteranceIndex: number, ttsFormat: string = 'pcm16'): Promise<void> {
    if (!base64Data || base64Data.length === 0) {
      console.warn('TtsPlayer: 收到空的音频数据，跳过');
      return;
    }

    console.log('TtsPlayer: 添加音频块，当前状态:', this.stateMachine.getState(), 'base64长度:', base64Data.length, 'utteranceIndex:', utteranceIndex, 'format:', ttsFormat);

    try {
      await this.ensureAudioContext();

      // 如果格式变化，需要重新初始化解码器
      if (ttsFormat !== this.currentTtsFormat || !this.audioDecoder) {
        this.currentTtsFormat = ttsFormat;
        const codecConfig: AudioCodecConfig = {
          codec: ttsFormat === 'opus' ? 'opus' : 'pcm16',
          sampleRate: this.sampleRate,
          channelCount: 1, // 单声道
        };
        this.audioDecoder = createAudioDecoder(codecConfig);
        console.log('TtsPlayer: 初始化音频解码器，格式:', ttsFormat);
      }

      // 解码 base64
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 根据格式解码音频
      let float32Array: Float32Array;
      if (ttsFormat === 'opus') {
        // Opus 格式：使用解码器解码
        if (!this.audioDecoder) {
          throw new Error('Opus decoder not initialized');
        }
        float32Array = await this.audioDecoder.decode(bytes);
      } else {
        // PCM16 格式：直接转换
        const int16Array = new Int16Array(bytes.buffer);
        float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }
      }

      // 将音频块与 utteranceIndex 关联
      this.audioBuffers.push({
        audio: float32Array,
        utteranceIndex: utteranceIndex
      });

      // 检查并限制缓存大小（只在未播放时清理，避免播放时丢失音频）
      const durationBefore = this.getTotalDuration();
      if (!this.isPlaying) {
        this.memoryManager.enforceMaxBufferDuration(() => this.removeOldestBuffer(), this.isPlaying);
      }
      const durationAfter = this.getTotalDuration();
      const wasTrimmed = durationBefore > durationAfter;

      console.log('TtsPlayer: ✅ 音频块已添加到缓冲区', {
        utterance_index: utteranceIndex,
        buffer_count: this.audioBuffers.length,
        is_playing: this.isPlaying,
        total_duration: durationAfter.toFixed(2) + '秒',
        was_trimmed: wasTrimmed,
        duration_before: durationBefore.toFixed(2) + '秒',
        duration_after: durationAfter.toFixed(2) + '秒',
        audio_length_samples: float32Array.length,
        audio_duration_seconds: (float32Array.length / this.sampleRate).toFixed(2) + '秒'
      });

      if (wasTrimmed) {
        console.warn('TtsPlayer: ⚠️ 缓存已满，已丢弃最旧的音频块');
      }

      // 不再自动播放，等待用户手动触发
    } catch (error) {
      console.error('TtsPlayer: 添加音频块时出错:', error);
      throw error;
    }
  }

  /**
   * 开始播放（手动触发）
   */
  async startPlayback(): Promise<void> {
    if (this.isPaused) {
      // 如果已暂停，恢复播放
      this.isPaused = false;
      console.log('TtsPlayer: 恢复播放');
      return;
    }

    if (this.isPlaying || this.audioBuffers.length === 0) {
      console.log('TtsPlayer: 跳过播放，isPlaying:', this.isPlaying, 'buffers:', this.audioBuffers.length);
      return;
    }

    await this.ensureAudioContext();
    if (!this.audioContext) {
      console.error('TtsPlayer: AudioContext 不可用');
      return;
    }

    console.log('TtsPlayer: 开始播放，当前状态机状态:', this.stateMachine.getState(), '缓冲区大小:', this.audioBuffers.length);
    this.isPlaying = true;
    this.isPaused = false;
    this.currentPlaybackIndex = -1; // 重置播放索引
    this.stateMachine.startPlaying();
    console.log('TtsPlayer: 状态已更新为 PLAYING_TTS');

    // 创建音频缓冲区并播放
    const playNext = async () => {
      // 检查是否被暂停
      if (this.isPaused) {
        console.log('TtsPlayer: 播放已暂停');
        return;
      }

      if (this.audioBuffers.length === 0) {
        // 所有音频块已播放完成
        this.isPlaying = false;
        this.isPaused = false;
        this.currentSource = null;
        this.currentPlaybackIndex = -1; // 重置播放索引
        this.stateMachine.finishPlaying();
        if (this.playbackFinishedCallback) {
          this.playbackFinishedCallback();
        }
        return;
      }

      // 获取当前播放的音频块（不移除，先播放）
      this.currentPlaybackIndex++;
      const currentBuffer = this.audioBuffers[0]; // 获取第一个音频块
      const utteranceIndex = currentBuffer.utteranceIndex;

      // 通知 App 显示对应的文本
      if (this.playbackIndexChangeCallback) {
        console.log('TtsPlayer: 播放索引变化，显示 utteranceIndex:', utteranceIndex);
        this.playbackIndexChangeCallback(utteranceIndex);
      }

      // 移除音频块（边播放边清理，减少内存占用）
      const bufferWithIndex = this.audioBuffers.shift()!;
      const buffer = bufferWithIndex.audio;
      const audioBuffer = this.audioContext!.createBuffer(1, buffer.length, this.sampleRate);
      // 类型转换：Float32Array<ArrayBufferLike> -> Float32Array
      const channelData = new Float32Array(buffer.length);
      channelData.set(buffer);
      audioBuffer.copyToChannel(channelData, 0);

      const source = this.audioContext!.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = this.playbackRate; // 设置播放倍速
      source.connect(this.audioContext!.destination);
      this.currentSource = source;

      source.onended = () => {
        // 播放下一个块
        playNext();
      };

      source.start(0);
    };

    playNext();
  }

  /**
   * 暂停播放
   */
  pausePlayback(): void {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      // 停止当前播放的音频源
      if (this.currentSource) {
        try {
          this.currentSource.stop();
        } catch (error) {
          // 可能已经停止，忽略错误
        }
        this.currentSource = null;
      }
      // 更新状态机
      this.stateMachine.pausePlaying();
      console.log('TtsPlayer: 播放已暂停');
    }
  }

  /**
   * 获取总音频时长（秒）
   */
  getTotalDuration(): number {
    if (!this.sampleRate || this.sampleRate <= 0) {
      console.warn('TtsPlayer: sampleRate 未初始化或无效，返回0');
      return 0;
    }
    const totalSamples = this.audioBuffers.reduce((sum, buffer) => sum + (buffer.audio?.length || 0), 0);
    const duration = totalSamples / this.sampleRate;
    // 防御性检查：确保返回值是有效数字
    if (isNaN(duration) || !isFinite(duration)) {
      console.warn('TtsPlayer: getTotalDuration 计算出无效值，返回0', { totalSamples, sampleRate: this.sampleRate });
      return 0;
    }
    return duration;
  }

  /**
   * 获取缓冲区中的音频块数量
   */
  getBufferCount(): number {
    return this.audioBuffers.length;
  }

  /**
   * 检查是否有待播放的音频
   */
  hasPendingAudio(): boolean {
    return this.audioBuffers.length > 0;
  }

  /**
   * 清空缓冲区
   */
  clearBuffers(): void {
    const bufferCount = this.audioBuffers.length;
    const totalDuration = this.getTotalDuration();
    const stackTrace = new Error().stack;
    this.audioBuffers = [];
    console.warn('TtsPlayer: ⚠️ 缓冲区已清空', {
      buffer_count: bufferCount,
      total_duration: totalDuration.toFixed(2) + '秒',
      is_playing: this.isPlaying,
      stack_trace: stackTrace?.split('\n').slice(0, 5).join('\n')
    });
  }

  /**
   * 销毁播放器（清理资源）
   */
  destroy(): void {
    this.memoryManager.stopMemoryMonitoring();
    this.stop();
    this.clearBuffers();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * 停止播放
   */
  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (error) {
        // 可能已经停止
      }
      this.currentSource = null;
    }
    this.audioBuffers = [];
    this.isPlaying = false;
    this.isPaused = false;
  }

  /**
   * 检查是否正在播放
   */
  getIsPlaying(): boolean {
    return this.isPlaying && !this.isPaused;
  }

  /**
   * 检查是否已暂停
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 切换播放倍速
   * 循环：1x → 1.25x → 1.5x → 2x → 1x
   */
  togglePlaybackRate(): number {
    // 移动到下一个倍速
    this.currentRateIndex = (this.currentRateIndex + 1) % this.playbackRates.length;
    this.playbackRate = this.playbackRates[this.currentRateIndex];

    // 如果正在播放，更新当前音频源的倍速
    if (this.currentSource && this.isPlaying && !this.isPaused) {
      this.currentSource.playbackRate.value = this.playbackRate;
    }

    console.log('TtsPlayer: 播放倍速已切换为', this.playbackRate, 'x');
    return this.playbackRate;
  }

  /**
   * 获取当前播放倍速
   */
  getPlaybackRate(): number {
    return this.playbackRate;
  }

  /**
   * 获取当前播放倍速的显示文本
   */
  getPlaybackRateText(): string {
    return `${this.playbackRate}x`;
  }

  /**
   * 获取最大缓存时长
   */
  getMaxBufferDuration(): number {
    return this.maxBufferDuration;
  }
}
