import { StateMachine } from './state_machine';
import { SessionState, Config, DEFAULT_CONFIG, SilenceFilterConfig, DEFAULT_SILENCE_FILTER_CONFIG } from './types';

export type AudioFrameCallback = (audioData: Float32Array) => void;
export type SilenceDetectedCallback = () => void;

/**
 * 录音模块
 * 负责音频采集、静音检测（支持配置化和平滑逻辑）
 */
export class Recorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrameId: number | null = null;
  private isRecording: boolean = false;
  private silenceStartTime: number = 0;
  private config: Config;
  private stateMachine: StateMachine;
  private silenceFilterConfig: SilenceFilterConfig;

  // 回调
  private audioFrameCallback: AudioFrameCallback | null = null;
  private silenceDetectedCallback: SilenceDetectedCallback | null = null;
  
  // 静音过滤平滑状态
  private consecutiveVoiceFrames: number = 0; // 连续语音帧数
  private consecutiveSilenceFrames: number = 0; // 连续静音帧数
  private isSendingAudio: boolean = false; // 当前是否在发送音频
  private frameCounter: number = 0; // 帧计数器（用于调试日志）

  constructor(stateMachine: StateMachine, config: Partial<Config> = {}) {
    this.stateMachine = stateMachine;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.silenceFilterConfig = this.config.silenceFilter || DEFAULT_SILENCE_FILTER_CONFIG;
  }
  
  /**
   * 更新静音过滤配置
   */
  updateSilenceFilterConfig(config: Partial<SilenceFilterConfig>): void {
    this.silenceFilterConfig = { ...this.silenceFilterConfig, ...config };
    // 重置状态
    this.consecutiveVoiceFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.isSendingAudio = false;
  }
  
  /**
   * 获取静音过滤配置
   */
  getSilenceFilterConfig(): SilenceFilterConfig {
    return { ...this.silenceFilterConfig };
  }

  /**
   * 设置音频帧回调
   */
  setAudioFrameCallback(callback: AudioFrameCallback): void {
    this.audioFrameCallback = callback;
  }

  /**
   * 设置静音检测回调
   */
  setSilenceDetectedCallback(callback: SilenceDetectedCallback): void {
    this.silenceDetectedCallback = callback;
  }

  /**
   * 初始化音频上下文
   */
  async initialize(): Promise<void> {
    try {
      // 请求麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 创建音频上下文
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 创建分析器用于音量检测
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      source.connect(this.analyser);

      // 创建数据数组
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      // 创建 ScriptProcessorNode 用于获取 PCM 数据
      const bufferSize = 4096;
      const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      processor.onaudioprocess = (event) => {
        if (!this.isRecording) {
          return;
        }

        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        const audioData = new Float32Array(inputData);
        
        // 静音过滤处理
        if (this.silenceFilterConfig.enabled) {
          const shouldSend = this.processSilenceFilter(audioData);
          if (shouldSend && this.audioFrameCallback) {
            this.audioFrameCallback(audioData);
          }
        } else {
          // 未启用静音过滤，直接回调
          if (this.audioFrameCallback) {
            this.audioFrameCallback(audioData);
          }
        }
      };

      source.connect(processor);
      processor.connect(this.audioContext.destination);

      console.log('Recorder initialized');
    } catch (error) {
      console.error('Failed to initialize recorder:', error);
      throw error;
    }
  }

  /**
   * 开始录音
   */
  async start(): Promise<void> {
    if (this.isRecording) {
      return;
    }

    if (!this.audioContext || !this.mediaStream) {
      await this.initialize();
    }

    this.isRecording = true;
    this.silenceStartTime = 0;
    // 重置静音过滤状态
    this.consecutiveVoiceFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.isSendingAudio = false;
    this.frameCounter = 0; // 重置帧计数器
    this.startSilenceDetection();
    console.log('[Recorder] 录音已开始，VAD 静音过滤已启用', {
      threshold: this.silenceFilterConfig.threshold,
      enabled: this.silenceFilterConfig.enabled
    });
  }

  /**
   * 停止录音
   */
  stop(): void {
    if (!this.isRecording) {
      return;
    }

    this.isRecording = false;
    this.stopSilenceDetection();
    // 重置静音过滤状态
    this.consecutiveVoiceFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.isSendingAudio = false;
    console.log('Recording stopped');
  }

  /**
   * 关闭麦克风（释放资源）
   */
  close(): void {
    this.stop();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
    this.dataArray = null;
    console.log('Recorder closed');
  }

  /**
   * 处理静音过滤（带平滑逻辑）
   * 核心功能：过滤静音片段，只发送有效语音给调度服务器
   * 这样可以避免调度服务器一直处于"翻译中"状态
   * 
   * @param audioData 音频数据
   * @returns 是否应该发送该帧（true=有效语音，false=静音，不发送）
   */
  private processSilenceFilter(audioData: Float32Array): boolean {
    // 计算 RMS 值（均方根，用于衡量音频能量）
    const rms = this.calculateRMS(audioData);
    
    // 获取阈值（Attack/Release 使用不同阈值）
    const attackThreshold = this.silenceFilterConfig.attackThreshold ?? this.silenceFilterConfig.threshold;
    const releaseThreshold = this.silenceFilterConfig.releaseThreshold ?? this.silenceFilterConfig.threshold;
    
    // 判断当前帧是否为语音
    const isVoice = rms >= (this.isSendingAudio ? releaseThreshold : attackThreshold);
    
    // 调试日志：每100帧记录一次（避免日志过多）
    if (!this.frameCounter) this.frameCounter = 0;
    this.frameCounter++;
    const shouldLog = this.frameCounter % 100 === 0;
    
    if (isVoice) {
      // 检测到语音
      this.consecutiveVoiceFrames++;
      this.consecutiveSilenceFrames = 0;
      
      // 如果连续 N 帧语音，开始发送（避免误触发）
      if (!this.isSendingAudio && this.consecutiveVoiceFrames >= this.silenceFilterConfig.attackFrames) {
        this.isSendingAudio = true;
        console.log('[VAD] ✅ 检测到语音，开始发送音频', {
          rms: rms.toFixed(4),
          threshold: attackThreshold.toFixed(4),
          consecutiveVoiceFrames: this.consecutiveVoiceFrames,
          frameCounter: this.frameCounter
        });
      } else if (shouldLog && this.isSendingAudio) {
        // 定期日志：正在发送语音
        console.log('[VAD] 🔊 正在发送语音', {
          rms: rms.toFixed(4),
          threshold: releaseThreshold.toFixed(4),
          frameCounter: this.frameCounter
        });
      }
      
      // 如果已经在发送，继续发送有效语音
      return this.isSendingAudio;
    } else {
      // 检测到静音
      this.consecutiveSilenceFrames++;
      this.consecutiveVoiceFrames = 0;
      
      // 如果已经在发送
      if (this.isSendingAudio) {
        // 如果连续 M 帧静音，停止发送（过滤静音片段）
        if (this.consecutiveSilenceFrames >= this.silenceFilterConfig.releaseFrames) {
          this.isSendingAudio = false;
          console.log('[VAD] 🔇 检测到静音，停止发送音频（过滤静音片段）', {
            rms: rms.toFixed(4),
            threshold: releaseThreshold.toFixed(4),
            consecutiveSilenceFrames: this.consecutiveSilenceFrames,
            frameCounter: this.frameCounter
          });
          return false; // 静音片段不发送
        } else if (shouldLog) {
          // 定期日志：正在平滑过渡（静音帧但仍在发送）
          console.log('[VAD] ⏸️  平滑过渡中（静音帧但继续发送）', {
            rms: rms.toFixed(4),
            consecutiveSilenceFrames: this.consecutiveSilenceFrames,
            releaseFrames: this.silenceFilterConfig.releaseFrames,
            frameCounter: this.frameCounter
          });
        }
        // 否则继续发送（平滑过渡，避免频繁启停）
        return true;
      } else {
        // 未在发送，静音片段不发送
        if (shouldLog) {
          console.log('[VAD] 🔕 静音片段，不发送', {
            rms: rms.toFixed(4),
            threshold: attackThreshold.toFixed(4),
            frameCounter: this.frameCounter
          });
        }
        return false;
      }
    }
  }
  
  /**
   * 计算 RMS 值
   */
  private calculateRMS(audioData: Float32Array): number {
    if (audioData.length === 0) {
      return 0;
    }
    
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
      const sample = audioData[i];
      sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / audioData.length);
  }

  /**
   * 开始静音检测（用于静音超时检测，与静音过滤不同）
   */
  private startSilenceDetection(): void {
    if (!this.analyser || !this.dataArray) {
      return;
    }

    const detectSilence = () => {
      if (!this.isRecording || !this.analyser || !this.dataArray) {
        return;
      }

      this.analyser.getByteFrequencyData(this.dataArray);
      
      // 计算平均音量
      const average = this.dataArray.reduce((sum, value) => sum + value, 0) / this.dataArray.length;
      const threshold = 20; // 静音阈值（可调整）

      if (average < threshold) {
        // 检测到静音
        const now = Date.now();
        if (this.silenceStartTime === 0) {
          this.silenceStartTime = now;
        } else if (now - this.silenceStartTime > this.config.silenceTimeoutMs) {
          // 静音超时，追加尾部缓冲
          setTimeout(() => {
            if (this.silenceDetectedCallback && this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
              this.silenceDetectedCallback();
            }
          }, this.config.tailBufferMs);
        }
      } else {
        // 检测到语音，重置静音计时
        this.silenceStartTime = 0;
      }

      this.animationFrameId = requestAnimationFrame(detectSilence);
    };

    detectSilence();
  }

  /**
   * 停止静音检测
   */
  private stopSilenceDetection(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.silenceStartTime = 0;
  }

  /**
   * 检查是否正在录音
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }
}

