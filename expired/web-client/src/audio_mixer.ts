/**
 * 音频混控器
 * 用于混合原声（WebRTC）和翻译音频（TTS）
 * 支持淡入淡出效果
 */

/**
 * 音频混控器
 * 管理原声和翻译音频的混合播放
 */
export class AudioMixer {
  private audioContext: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  
  // 原声相关节点（每个远程成员一个）
  private rawVoiceSources: Map<string, MediaStreamAudioSourceNode> = new Map();
  private rawVoiceGains: Map<string, GainNode> = new Map();
  
  // 翻译音频相关节点
  private ttsGain: GainNode | null = null;
  private ttsSource: AudioBufferSourceNode | null = null;
  
  // 当前播放状态
  private isPlayingTts: boolean = false;
  private ttsQueue: Float32Array[] = [];
  private currentTtsBuffer: AudioBuffer | null = null;
  private ttsPlaybackStartTime: number = 0;
  
  // 淡入淡出参数
  private readonly FADE_OUT_DURATION = 0.3; // 300ms
  private readonly FADE_IN_DURATION = 0.2; // 200ms
  
  // 远程成员说话状态（用于判断是否恢复原声）
  private remoteSpeakingStatus: Map<string, boolean> = new Map();

  /**
   * 初始化音频上下文
   */
  private async ensureAudioContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.destination = this.audioContext.createMediaStreamDestination();
      
      // 创建 TTS GainNode
      this.ttsGain = this.audioContext.createGain();
      this.ttsGain.gain.value = 0.0; // 初始静音
      this.ttsGain.connect(this.destination);
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * 添加远程音频流（原声）
   * @param memberId 成员 ID
   * @param stream 远程音频流
   */
  async addRemoteStream(memberId: string, stream: MediaStream): Promise<void> {
    await this.ensureAudioContext();
    if (!this.audioContext || !this.destination) {
      throw new Error('Audio context not initialized');
    }

    // 如果已存在，先移除
    this.removeRemoteStream(memberId);

    // 创建音频源节点
    const source = this.audioContext.createMediaStreamSource(stream);
    const gain = this.audioContext.createGain();
    gain.gain.value = 1.0; // 初始音量

    // 连接：source -> gain -> destination
    source.connect(gain);
    gain.connect(this.destination);

    this.rawVoiceSources.set(memberId, source);
    this.rawVoiceGains.set(memberId, gain);
    this.remoteSpeakingStatus.set(memberId, false);

    console.log('已添加远程音频流:', memberId);
  }

  /**
   * 移除远程音频流
   * @param memberId 成员 ID
   */
  removeRemoteStream(memberId: string): void {
    const source = this.rawVoiceSources.get(memberId);
    const gain = this.rawVoiceGains.get(memberId);

    if (source) {
      source.disconnect();
      this.rawVoiceSources.delete(memberId);
    }

    if (gain) {
      gain.disconnect();
      this.rawVoiceGains.delete(memberId);
    }

    this.remoteSpeakingStatus.delete(memberId);
    console.log('已移除远程音频流:', memberId);
  }

  /**
   * 设置远程成员说话状态
   * @param memberId 成员 ID
   * @param isSpeaking 是否在说话
   */
  setRemoteSpeakingStatus(memberId: string, isSpeaking: boolean): void {
    this.remoteSpeakingStatus.set(memberId, isSpeaking);
  }

  /**
   * 添加翻译音频块
   * @param audioData 音频数据（Float32Array）
   */
  async addTtsAudio(audioData: Float32Array): Promise<void> {
    await this.ensureAudioContext();
    if (!this.audioContext || !this.ttsGain) {
      throw new Error('Audio context not initialized');
    }

    this.ttsQueue.push(audioData);

    // 如果当前没有播放，开始播放
    if (!this.isPlayingTts) {
      this.startTtsPlayback();
    }
  }

  /**
   * 开始播放 TTS 音频
   */
  private async startTtsPlayback(): Promise<void> {
    if (this.isPlayingTts || this.ttsQueue.length === 0) {
      return;
    }

    if (!this.audioContext || !this.ttsGain) {
      return;
    }

    this.isPlayingTts = true;

    // 淡出原声
    await this.fadeOutRawVoice();

    // 淡入 TTS
    await this.fadeInTts();

    // 播放音频块
    await this.playNextTtsChunk();
  }

  /**
   * 播放下一个 TTS 音频块
   */
  private async playNextTtsChunk(): Promise<void> {
    if (this.ttsQueue.length === 0) {
      // 所有音频块已播放完成
      this.isPlayingTts = false;
      
      // 检查是否有远程成员仍在说话
      const hasSpeakingMember = Array.from(this.remoteSpeakingStatus.values()).some(status => status);
      
      if (hasSpeakingMember) {
        // 恢复原声
        await this.fadeInRawVoice();
      } else {
        // 保持静音
        await this.fadeOutTts();
      }

      return;
    }

    if (!this.audioContext || !this.ttsGain) {
      return;
    }

    const audioData = this.ttsQueue.shift()!;
    const audioBuffer = this.audioContext.createBuffer(1, audioData.length, 16000);
    audioBuffer.copyToChannel(audioData, 0);

    const source = this.audioContext.createAudioBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ttsGain);

    this.ttsPlaybackStartTime = this.audioContext.currentTime;
    source.start(this.ttsPlaybackStartTime);

    // 计算播放时长
    const duration = audioBuffer.duration;

    // 播放完成后继续播放下一个块
    source.onended = () => {
      this.playNextTtsChunk();
    };
  }

  /**
   * 淡出原声
   */
  private async fadeOutRawVoice(): Promise<void> {
    if (!this.audioContext) {
      return;
    }

    const currentTime = this.audioContext.currentTime;

    // 对所有远程成员的原声进行淡出
    for (const [memberId, gain] of this.rawVoiceGains.entries()) {
      gain.gain.cancelScheduledValues(currentTime);
      gain.gain.setValueAtTime(gain.gain.value, currentTime);
      gain.gain.linearRampToValueAtTime(0.0, currentTime + this.FADE_OUT_DURATION);
    }
  }

  /**
   * 淡入原声
   */
  private async fadeInRawVoice(): Promise<void> {
    if (!this.audioContext) {
      return;
    }

    const currentTime = this.audioContext.currentTime;

    // 对所有远程成员的原声进行淡入
    for (const [memberId, gain] of this.rawVoiceGains.entries()) {
      gain.gain.cancelScheduledValues(currentTime);
      gain.gain.setValueAtTime(0.0, currentTime);
      gain.gain.linearRampToValueAtTime(1.0, currentTime + this.FADE_IN_DURATION);
    }
  }

  /**
   * 淡入 TTS
   */
  private async fadeInTts(): Promise<void> {
    if (!this.audioContext || !this.ttsGain) {
      return;
    }

    const currentTime = this.audioContext.currentTime;
    this.ttsGain.gain.cancelScheduledValues(currentTime);
    this.ttsGain.gain.setValueAtTime(0.0, currentTime);
    this.ttsGain.gain.linearRampToValueAtTime(1.0, currentTime + this.FADE_IN_DURATION);
  }

  /**
   * 淡出 TTS
   */
  private async fadeOutTts(): Promise<void> {
    if (!this.audioContext || !this.ttsGain) {
      return;
    }

    const currentTime = this.audioContext.currentTime;
    this.ttsGain.gain.cancelScheduledValues(currentTime);
    this.ttsGain.gain.setValueAtTime(this.ttsGain.gain.value, currentTime);
    this.ttsGain.gain.linearRampToValueAtTime(0.0, currentTime + this.FADE_OUT_DURATION);
  }

  /**
   * 获取输出流（用于播放）
   */
  getOutputStream(): MediaStream | null {
    return this.destination?.stream || null;
  }

  /**
   * 停止所有播放
   */
  stop(): void {
    // 停止 TTS 播放
    this.isPlayingTts = false;
    this.ttsQueue = [];

    if (this.ttsSource) {
      try {
        this.ttsSource.stop();
      } catch (e) {
        // 可能已经停止
      }
      this.ttsSource = null;
    }

    // 移除所有远程流
    for (const memberId of this.rawVoiceSources.keys()) {
      this.removeRemoteStream(memberId);
    }

    // 关闭音频上下文
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
      this.destination = null;
      this.ttsGain = null;
    }
  }

  /**
   * 检查是否正在播放 TTS
   */
  getIsPlayingTts(): boolean {
    return this.isPlayingTts;
  }
}

