import { StateMachine } from './state_machine';
import { SessionState } from './types';
import { Config, DEFAULT_CONFIG } from './types';

export type AudioFrameCallback = (audioData: Float32Array) => void;
export type SilenceDetectedCallback = () => void;

/**
 * 录音模块
 * 负责音频采集、静音检测
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

  // 回调
  private audioFrameCallback: AudioFrameCallback | null = null;
  private silenceDetectedCallback: SilenceDetectedCallback | null = null;

  constructor(stateMachine: StateMachine, config: Partial<Config> = {}) {
    this.stateMachine = stateMachine;
    this.config = { ...DEFAULT_CONFIG, ...config };
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
        
        // 转换为 Float32Array 并回调
        if (this.audioFrameCallback) {
          this.audioFrameCallback(new Float32Array(inputData));
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
    this.startSilenceDetection();
    console.log('Recording started');
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
   * 开始静音检测
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

