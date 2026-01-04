import { app } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export interface ServicePreferences {
  rustEnabled: boolean;
  nmtEnabled: boolean;
  ttsEnabled: boolean;
  yourttsEnabled: boolean;
  fasterWhisperVadEnabled: boolean;
  speakerEmbeddingEnabled: boolean;
}

export interface ASRConfig {
  beam_size?: number;  // Beam search 宽度，默认 10（提高准确度，减少同音字错误）
  temperature?: number;  // 采样温度，默认 0.0（更确定，减少随机性）
  patience?: number;  // Beam search 耐心值，默认 1.0
  compression_ratio_threshold?: number;  // 压缩比阈值，默认 2.4
  log_prob_threshold?: number;  // 对数概率阈值，默认 -1.0
  no_speech_threshold?: number;  // 无语音阈值，默认 0.6
}

/**
 * 指标收集配置
 * 支持热插拔：根据配置和服务状态动态决定收集哪些指标
 */
export interface MetricsConfig {
  /** 是否启用指标收集（默认 true，向后兼容） */
  enabled?: boolean;
  /** 具体指标开关配置 */
  metrics?: {
    /** 是否收集 Rerun 指标（Gate-B） */
    rerun?: boolean;
    /** 是否收集 ASR 指标（OBS-1） */
    asr?: boolean;
    /** 是否收集 NMT 指标（未来扩展） */
    nmt?: boolean;
    /** 是否收集 TTS 指标（未来扩展） */
    tts?: boolean;
    /** 支持扩展其他指标类型 */
    [key: string]: boolean | undefined;
  };
}

export interface NodeConfig {
  servicePreferences: ServicePreferences;
  scheduler?: {
    url?: string;  // 调度服务器 WebSocket URL，例如: ws://scheduler.example.com:5010/ws/node
  };
  modelHub?: {
    url?: string;  // Model Hub HTTP URL，例如: http://model-hub.example.com:5000
  };
  asr?: ASRConfig;  // ASR 配置（beam_size 等参数）
  /** 指标收集配置（支持热插拔） */
  metrics?: MetricsConfig;
  /** Feature Flags - 功能开关 */
  features?: {
    /** 是否启用 Pipeline NMT（默认 false，已迁移到 PostProcess） */
    /** 是否启用 PostProcess 翻译（默认 true） */
    enablePostProcessTranslation?: boolean;
    /** 是否启用 S1 Prompt Bias（默认 false，暂时禁用） */
    enableS1PromptBias?: boolean;
    /** 是否启用 S2 Rescoring（默认 false，已禁用） */
    enableS2Rescoring?: boolean;
    /** 语义修复配置 */
    semanticRepair?: {
      zh?: {
        qualityThreshold?: number;  // 质量分数阈值（默认0.70）
        forceForShortSentence?: boolean;  // 是否强制处理短句
      };
      en?: {
        qualityThreshold?: number;  // 质量分数阈值（默认0.70）
      };
      /** P2-1: 缓存配置 */
      cache?: {
        maxSize?: number;      // 最大缓存条目数（默认200）
        ttlMs?: number;        // TTL（默认5分钟）
        modelVersion?: string; // 模型版本（用于缓存键）
      };
      /** P2-2: 模型完整性检查配置 */
      modelIntegrityCheck?: {
        enabled?: boolean;     // 是否启用模型完整性检查（默认false）
        checkInterval?: number; // 检查间隔（默认30分钟，单位：毫秒）
      };
    };
  };
}

const DEFAULT_CONFIG: NodeConfig = {
  servicePreferences: {
    rustEnabled: false,           // 默认关闭节点推理服务（Rust）
    nmtEnabled: true,             // 默认启用 NMT
    ttsEnabled: true,             // 默认启用 Piper TTS
    yourttsEnabled: false,         // 默认关闭 YourTTS（资源较重）
    fasterWhisperVadEnabled: true, // 默认启用 Faster Whisper VAD 语音识别服务
    speakerEmbeddingEnabled: false, // 默认关闭 Speaker Embedding
  },
  scheduler: {
    url: 'ws://127.0.0.1:5010/ws/node',  // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
  },
  modelHub: {
    url: 'http://127.0.0.1:5000',  // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
  },
  asr: {
    beam_size: 10,  // 默认 10（提高准确度，减少同音字错误）
    temperature: 0.0,  // 默认 0.0（更确定，减少随机性）
    patience: 1.0,  // 默认 1.0
    compression_ratio_threshold: 2.4,  // 默认 2.4
    log_prob_threshold: -1.0,  // 默认 -1.0
    no_speech_threshold: 0.6,  // 默认 0.6
  },
  metrics: {
    enabled: true,  // 默认启用指标收集（向后兼容）
    metrics: {
      rerun: true,  // 默认启用 Rerun 指标
      asr: true,    // 默认启用 ASR 指标
      // 未来扩展：nmt, tts 等
    },
  },
  features: {
      enablePostProcessTranslation: true,  // 默认启用 PostProcess 翻译
    enableS1PromptBias: false,  // 默认禁用 S1 Prompt Bias（暂时禁用，避免错误传播）
    enableS2Rescoring: false,  // 默认禁用 S2 Rescoring（已禁用）
  },
};

function getConfigPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'electron-node-config.json');
}

// 同步版本（用于向后兼容，但尽量使用异步版本）
export function loadNodeConfig(): NodeConfig {
  try {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 简单合并，避免缺字段
    return {
      servicePreferences: {
        ...DEFAULT_CONFIG.servicePreferences,
        ...(parsed.servicePreferences || {}),
      },
      scheduler: {
        ...DEFAULT_CONFIG.scheduler,
        ...(parsed.scheduler || {}),
      },
      modelHub: {
        ...DEFAULT_CONFIG.modelHub,
        ...(parsed.modelHub || {}),
      },
      asr: {
        ...DEFAULT_CONFIG.asr,
        ...(parsed.asr || {}),
      },
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
        // 深度合并 metrics.metrics 对象
        metrics: {
          ...DEFAULT_CONFIG.metrics?.metrics,
          ...(parsed.metrics?.metrics || {}),
        },
      },
    };
  } catch (error) {
    // 读取失败时使用默认配置
    return { ...DEFAULT_CONFIG };
  }
}

// 异步版本（推荐使用，不阻塞）
export async function loadNodeConfigAsync(): Promise<NodeConfig> {
  try {
    const configPath = getConfigPath();
    try {
      await fsPromises.access(configPath);
    } catch {
      // 文件不存在，返回默认配置
      return { ...DEFAULT_CONFIG };
    }
    const raw = await fsPromises.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // 简单合并，避免缺字段
    return {
      servicePreferences: {
        ...DEFAULT_CONFIG.servicePreferences,
        ...(parsed.servicePreferences || {}),
      },
      scheduler: {
        ...DEFAULT_CONFIG.scheduler,
        ...(parsed.scheduler || {}),
      },
      modelHub: {
        ...DEFAULT_CONFIG.modelHub,
        ...(parsed.modelHub || {}),
      },
      asr: {
        ...DEFAULT_CONFIG.asr,
        ...(parsed.asr || {}),
      },
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
        // 深度合并 metrics.metrics 对象
        metrics: {
          ...DEFAULT_CONFIG.metrics?.metrics,
          ...(parsed.metrics?.metrics || {}),
        },
      },
    };
  } catch (error) {
    // 读取失败时使用默认配置
    return { ...DEFAULT_CONFIG };
  }
}

export function saveNodeConfig(config: NodeConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

