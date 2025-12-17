import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface ServicePreferences {
  rustEnabled: boolean;
  nmtEnabled: boolean;
  ttsEnabled: boolean;
  yourttsEnabled: boolean;
}

export interface NodeConfig {
  servicePreferences: ServicePreferences;
  scheduler?: {
    url?: string;  // 调度服务器 WebSocket URL，例如: ws://scheduler.example.com:5010/ws/node
  };
}

const DEFAULT_CONFIG: NodeConfig = {
  servicePreferences: {
    rustEnabled: true,      // 默认启用推理服务
    nmtEnabled: true,       // 默认启用 NMT
    ttsEnabled: true,       // 默认启用 Piper TTS
    yourttsEnabled: false,  // 默认关闭 YourTTS（资源较重）
  },
  scheduler: {
    url: 'ws://127.0.0.1:5010/ws/node',  // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
  },
};

function getConfigPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'electron-node-config.json');
}

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

