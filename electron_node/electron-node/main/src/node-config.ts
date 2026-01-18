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
  // 语义修复服务自动启动配置
  semanticRepairZhEnabled?: boolean;    // semantic-repair-zh 自动启动（已弃用）
  semanticRepairEnEnabled?: boolean;    // semantic-repair-en 自动启动（已弃用）
  enNormalizeEnabled?: boolean;         // en-normalize 自动启动（已弃用）
  semanticRepairEnZhEnabled?: boolean;  // semantic-repair-en-zh 自动启动（推荐）
}

// ASR配置已移除：各服务的参数应该随着服务走，避免节点端与服务强制绑定
// ASR服务的参数（如beam_size）应该在ASR服务自己的配置文件中设置（config.py）

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
  // ASR配置已移除：各服务的参数应该随着服务走，避免节点端与服务强制绑定
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
  /** GPU 仲裁器配置 */
  gpuArbiter?: {
    enabled?: boolean;
    gpuKeys?: string[];
    defaultQueueLimit?: number;
    defaultHoldMaxMs?: number;
    gpuUsageThreshold?: number;  // 向后兼容，已废弃，使用gpuUsage.baseHighWater
    gpuUsage?: {
      sampleIntervalMs?: number;      // 采样间隔（默认800ms）
      cacheTtlMs?: number;            // 缓存TTL（默认2000ms）
      baseHighWater?: number;          // 基础高水位（默认85%）
      baseLowWater?: number;           // 基础低水位（默认78%）
      dynamicAdjustment?: {
        enabled?: boolean;             // 是否启用动态调整（默认true）
        longAudioThresholdMs?: number; // 长音频阈值（默认8000ms）
        highWaterBoost?: number;       // 高水位提升值（默认7%）
        lowWaterBoost?: number;        // 低水位提升值（默认7%）
        adjustmentTtlMs?: number;      // 调整持续时间（默认15000ms）
      };
    };
    policies?: {
      ASR?: {
        priority?: number;
        maxWaitMs?: number;
        busyPolicy?: "WAIT" | "SKIP" | "FALLBACK_CPU";
      };
      NMT?: {
        priority?: number;
        maxWaitMs?: number;
        busyPolicy?: "WAIT" | "SKIP" | "FALLBACK_CPU";
      };
      TTS?: {
        priority?: number;
        maxWaitMs?: number;
        busyPolicy?: "WAIT" | "SKIP" | "FALLBACK_CPU";
      };
      SEMANTIC_REPAIR?: {
        priority?: number;
        maxWaitMs?: number;
        busyPolicy?: "WAIT" | "SKIP" | "FALLBACK_CPU";
      };
    };
  };
  /** 顺序执行管理器配置 */
  sequentialExecutor?: {
    enabled?: boolean;
    maxWaitMs?: number;  // 最大等待时间（超时后跳过）
    timeoutCheckIntervalMs?: number;  // 超时检查间隔
  };
  /** 文本长度配置 */
  textLength?: {
    /** 最小保留长度：太短的文本直接丢弃（默认6个字符） */
    minLengthToKeep?: number;
    /** 最小发送长度：小于此长度的文本等待合并（默认20个字符） */
    minLengthToSend?: number;
    /** 最大等待长度：超过此长度的文本强制截断（默认40个字符） */
    maxLengthToWait?: number;
    /** 等待超时时间：毫秒（默认3000ms，即3秒） */
    waitTimeoutMs?: number;
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
  // ASR配置已移除：各服务的参数应该随着服务走，避免节点端与服务强制绑定
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
  textLength: {
    minLengthToKeep: 6,   // 最小保留长度：6个字符（太短的文本直接丢弃）
    minLengthToSend: 20,  // 最小发送长度：20个字符（6-20字符之间的文本等待合并）
    maxLengthToWait: 40,  // 最大等待长度：40个字符（20-40字符之间的文本等待3秒确认是否有后续输入，超过40字符强制截断）
    waitTimeoutMs: 3000,  // 等待超时：3秒
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
    // 注意：先展开默认配置，然后用用户配置覆盖，确保用户保存的值优先
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
      // ASR配置已移除：各服务的参数应该随着服务走
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
        // 深度合并 metrics.metrics 对象
        metrics: {
          ...DEFAULT_CONFIG.metrics?.metrics,
          ...(parsed.metrics?.metrics || {}),
        },
      },
      features: {
        ...DEFAULT_CONFIG.features,
        ...(parsed.features || {}),
      },
      gpuArbiter: parsed.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
      sequentialExecutor: {
        ...(DEFAULT_CONFIG.sequentialExecutor || {}),
        ...(parsed.sequentialExecutor || {}),
      },
      textLength: {
        ...(DEFAULT_CONFIG.textLength || {}),
        ...(parsed.textLength || {}),
      },
    };
  } catch (error) {
    // 读取失败时使用默认配置
    // 注意：这里不应该保存默认配置，因为可能是文件格式错误，保存会覆盖用户之前的配置
    // 保存操作应该在调用方明确知道需要保存时才执行
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
      // ASR配置已移除：各服务的参数应该随着服务走
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
        // 深度合并 metrics.metrics 对象
        metrics: {
          ...DEFAULT_CONFIG.metrics?.metrics,
          ...(parsed.metrics?.metrics || {}),
        },
      },
      features: {
        ...DEFAULT_CONFIG.features,
        ...(parsed.features || {}),
      },
      gpuArbiter: parsed.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
      sequentialExecutor: {
        ...(DEFAULT_CONFIG.sequentialExecutor || {}),
        ...(parsed.sequentialExecutor || {}),
      },
      textLength: {
        ...(DEFAULT_CONFIG.textLength || {}),
        ...(parsed.textLength || {}),
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
  
  // 确保所有必需字段都存在（合并默认配置，避免丢失字段）
  const configToSave: NodeConfig = {
    servicePreferences: {
      ...DEFAULT_CONFIG.servicePreferences,
      ...(config.servicePreferences || {}),
    },
    scheduler: {
      ...DEFAULT_CONFIG.scheduler,
      ...(config.scheduler || {}),
    },
    modelHub: {
      ...DEFAULT_CONFIG.modelHub,
      ...(config.modelHub || {}),
    },
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...(config.metrics || {}),
      metrics: {
        ...DEFAULT_CONFIG.metrics?.metrics,
        ...(config.metrics?.metrics || {}),
      },
    },
    features: {
      ...DEFAULT_CONFIG.features,
      ...(config.features || {}),
    },
    gpuArbiter: config.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
    sequentialExecutor: {
      ...(DEFAULT_CONFIG.sequentialExecutor || {}),
      ...(config.sequentialExecutor || {}),
    },
    textLength: {
      ...(DEFAULT_CONFIG.textLength || {}),
      ...(config.textLength || {}),
    },
  };
  
  fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
}

