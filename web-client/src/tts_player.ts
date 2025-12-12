import { StateMachine, SessionState } from './state_machine';

export type PlaybackFinishedCallback = () => void;

/**
 * TTS 播放模块
 * 支持流式播放 PCM16 音频
 */
export class TtsPlayer {
  private audioContext: AudioContext | null = null;
  private audioBuffers: Float32Array[] = [];
  private isPlaying: boolean = false;
  private stateMachine: StateMachine;
  private playbackFinishedCallback: PlaybackFinishedCallback | null = null;

  constructor(stateMachine: StateMachine) {
    this.stateMachine = stateMachine;
  }

  /**
   * 设置播放完成回调
   */
  setPlaybackFinishedCallback(callback: PlaybackFinishedCallback): void {
    this.playbackFinishedCallback = callback;
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
   */
  async addAudioChunk(base64Data: string): Promise<void> {
    await this.ensureAudioContext();

    // 解码 base64
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 转换为 Int16Array
    const int16Array = new Int16Array(bytes.buffer);

    // 转换为 Float32Array
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    this.audioBuffers.push(float32Array);

    // 如果当前没有播放，开始播放
    if (!this.isPlaying) {
      this.startPlayback();
    }
  }

  /**
   * 开始播放
   */
  private async startPlayback(): Promise<void> {
    if (this.isPlaying || this.audioBuffers.length === 0) {
      return;
    }

    await this.ensureAudioContext();
    if (!this.audioContext) {
      return;
    }

    this.isPlaying = true;
    this.stateMachine.startPlaying();

    // 创建音频缓冲区并播放
    const playNext = async () => {
      if (this.audioBuffers.length === 0) {
        // 所有音频块已播放完成
        this.isPlaying = false;
        this.stateMachine.finishPlaying();
        if (this.playbackFinishedCallback) {
          this.playbackFinishedCallback();
        }
        return;
      }

      const buffer = this.audioBuffers.shift()!;
      const audioBuffer = this.audioContext!.createBuffer(1, buffer.length, 16000);
      audioBuffer.copyToChannel(buffer, 0);

      const source = this.audioContext!.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext!.destination);

      source.onended = () => {
        // 播放下一个块
        playNext();
      };

      source.start(0);
    };

    playNext();
  }

  /**
   * 停止播放
   */
  stop(): void {
    this.audioBuffers = [];
    this.isPlaying = false;
  }

  /**
   * 检查是否正在播放
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

