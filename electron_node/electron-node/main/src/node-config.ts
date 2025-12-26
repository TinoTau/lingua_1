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

export interface NodeConfig {
  servicePreferences: ServicePreferences;
  scheduler?: {
    url?: string;  // 调度服务器 WebSocket URL，例如: ws://scheduler.example.com:5010/ws/node
  };
  modelHub?: {
    url?: string;  // Model Hub HTTP URL，例如: http://model-hub.example.com:5000
  };
  asr?: ASRConfig;  // ASR 配置（beam_size 等参数）
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

