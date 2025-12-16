/**
 * 轻量级 VAD（语音活动检测）
 * 对应 iOS 文档中的 LightweightVAD
 * 只做静音过滤，不参与断句
 */

export interface VadConfig {
  frameMs?: number; // 默认 20ms
  silenceThresholdDb?: number; // 默认 -50dB（非常保守，只过滤几乎为 0 的信号）
  minSilenceMsToDrop?: number; // 默认 200ms（连续静音超过此值才丢弃）
}

export interface VadResult {
  isSpeech: boolean;
  energyDb: number;
  silenceDurationMs: number;
}

export class LightweightVAD {
  private config: Required<VadConfig>;
  private silenceMs: number = 0;
  private lastSpeechTime: number = 0;

  constructor(config: VadConfig = {}) {
    this.config = {
      frameMs: config.frameMs || 20,
      silenceThresholdDb: config.silenceThresholdDb || -50.0,
      minSilenceMsToDrop: config.minSilenceMsToDrop || 200,
    };
  }

  /**
   * 检测音频帧是否包含语音
   * @param pcmData PCM 16-bit 数据
   * @returns VAD 结果
   */
  detect(pcmData: Int16Array): VadResult {
    const energyDb = this.calculateEnergyDb(pcmData);
    const isSpeech = energyDb > this.config.silenceThresholdDb;

    const now = Date.now();

    if (isSpeech) {
      this.silenceMs = 0;
      this.lastSpeechTime = now;
    } else {
      if (this.lastSpeechTime > 0) {
        this.silenceMs += this.config.frameMs;
      }
    }

    return {
      isSpeech,
      energyDb,
      silenceDurationMs: this.silenceMs,
    };
  }

  /**
   * 计算音频帧的能量（dB）
   */
  private calculateEnergyDb(pcmData: Int16Array): number {
    if (pcmData.length === 0) {
      return -Infinity;
    }

    // 计算 RMS（均方根）
    let sumSquares = 0;
    for (let i = 0; i < pcmData.length; i++) {
      const sample = pcmData[i] / 32768.0; // 归一化到 [-1, 1]
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / pcmData.length);

    // 转换为 dB
    // 参考电平：1.0 (0 dB)
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    return db;
  }

  /**
   * 判断是否应该丢弃当前帧（长时间静音）
   */
  shouldDrop(result: VadResult): boolean {
    return !result.isSpeech && result.silenceDurationMs >= this.config.minSilenceMsToDrop;
  }

  /**
   * 重置 VAD 状态
   */
  reset(): void {
    this.silenceMs = 0;
    this.lastSpeechTime = 0;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<VadConfig> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<VadConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }
}

