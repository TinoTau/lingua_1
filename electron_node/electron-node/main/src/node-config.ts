import { app } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { NodeConfig, ServicePreferences, MetricsConfig } from './node-config-types';
import { DEFAULT_CONFIG } from './node-config-defaults';

export type { NodeConfig, ServicePreferences, MetricsConfig } from './node-config-types';

export function getConfigPath(): string {
  const userData = app.getPath('userData');
  return path.join(userData, 'electron-node-config.json');
}

/** 本机服务 base URL（从配置读），用于 ASR/NMT/TTS/语义修复等端点拼接及健康检查。 */
export function getServicesBaseUrl(): string {
  const c = loadNodeConfig();
  const url = c.services?.baseUrl ?? DEFAULT_CONFIG.services?.baseUrl ?? '';
  return url.replace(/localhost/g, '127.0.0.1').replace(/\/$/, '');
}

/** 同音纠错服务 base URL（从配置读）。默认值仅来自 DEFAULT_CONFIG。 */
export function getPhoneticCorrectionUrl(): string {
  const c = loadNodeConfig();
  return c.services?.phoneticCorrectionUrl ?? DEFAULT_CONFIG.services?.phoneticCorrectionUrl ?? '';
}

/** 断句服务 base URL（从配置读）。默认值仅来自 DEFAULT_CONFIG。 */
export function getPunctuationRestoreUrl(): string {
  const c = loadNodeConfig();
  return c.services?.punctuationRestoreUrl ?? DEFAULT_CONFIG.services?.punctuationRestoreUrl ?? '';
}

/** job.pipeline.use_semantic 缺省为 false（增强服务默认关闭） */
export function resolveJobUseSemantic(job: { pipeline?: { use_semantic?: boolean } }): boolean {
  const p = job.pipeline;
  if (!p || !('use_semantic' in p)) {
    return false;
  }
  return p.use_semantic === true;
}

/** 节点 features.semanticRepair.enabled 缺省为 false */
export function isSemanticRepairFeatureEnabled(): boolean {
  const c = loadNodeConfig();
  return c.features?.semanticRepair?.enabled === true;
}

export function isSemanticRepairEnabled(job: { pipeline?: { use_semantic?: boolean } }): boolean {
  return resolveJobUseSemantic(job) && isSemanticRepairFeatureEnabled();
}

/** job.pipeline.use_phonetic 缺省为 false */
export function resolveJobUsePhonetic(job: { pipeline?: { use_phonetic?: boolean } }): boolean {
  const p = job.pipeline;
  if (!p || !('use_phonetic' in p)) {
    return false;
  }
  return (p as { use_phonetic?: boolean }).use_phonetic === true;
}

/** 节点 features.phoneticCorrection.enabled 缺省为 false */
export function isPhoneticCorrectionFeatureEnabled(): boolean {
  const c = loadNodeConfig();
  return c.features?.phoneticCorrection?.enabled === true;
}

export function isPhoneticCorrectionEnabled(job: { pipeline?: { use_phonetic?: boolean } }): boolean {
  return resolveJobUsePhonetic(job) && isPhoneticCorrectionFeatureEnabled();
}

/** 节点 features.punctuationRestore.enabled 缺省为 false */
export function isPunctuationRestoreEnabled(): boolean {
  const c = loadNodeConfig();
  return c.features?.punctuationRestore?.enabled === true;
}

/** 调度服务器 WebSocket URL。从 electron-node-config.json 读 scheduler.url，localhost 规范为 127.0.0.1。 */
export function getSchedulerUrl(): string {
  const c = loadNodeConfig();
  const url = c.scheduler?.url ?? DEFAULT_CONFIG.scheduler?.url ?? '';
  return url.replace(/localhost/g, '127.0.0.1');
}

/** Model Hub HTTP URL。从 electron-node-config.json 读 modelHub.url。 */
export function getModelHubUrl(): string {
  const c = loadNodeConfig();
  const url = c.modelHub?.url ?? DEFAULT_CONFIG.modelHub?.url ?? '';
  return url.replace(/localhost/g, '127.0.0.1');
}

/** 测试服务端口（仅 test-server 使用）。从配置 testServer.port 读，缺省 5020。 */
export function getTestServerPort(): number {
  const c = loadNodeConfig();
  return c.testServer?.port ?? DEFAULT_CONFIG.testServer?.port ?? 5020;
}

/** LID 配置：从配置文件读取，缺省用 DEFAULT_CONFIG.lid。 */
export function getLidConfig(): {
  enabled: boolean;
  modelPath: string;
  encoderFile: string;
  decoderFile: string;
} {
  const c = loadNodeConfig();
  const def = DEFAULT_CONFIG.lid!;
  const base = c.lid ?? def;
  return {
    enabled: base.enabled ?? def.enabled ?? true,
    modelPath: base.modelPath ?? def.modelPath ?? 'models/sherpa-onnx-lid',
    encoderFile: base.encoderFile ?? def.encoderFile ?? 'tiny-encoder.int8.onnx',
    decoderFile: base.decoderFile ?? def.decoderFile ?? 'tiny-decoder.int8.onnx',
  };
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
      services: {
        ...DEFAULT_CONFIG.services,
        ...(parsed.services || {}),
      },
      testServer: {
        ...DEFAULT_CONFIG.testServer,
        ...(parsed.testServer || {}),
      },
      lid: {
        ...DEFAULT_CONFIG.lid,
        ...(parsed.lid || {}),
      },
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
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
  } catch {
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
      services: {
        ...DEFAULT_CONFIG.services,
        ...(parsed.services || {}),
      },
      testServer: {
        ...DEFAULT_CONFIG.testServer,
        ...(parsed.testServer || {}),
      },
      lid: {
        ...DEFAULT_CONFIG.lid,
        ...(parsed.lid || {}),
      },
      metrics: {
        ...DEFAULT_CONFIG.metrics,
        ...(parsed.metrics || {}),
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
  } catch {
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
    services: {
      ...DEFAULT_CONFIG.services,
      ...(config.services || {}),
    },
    testServer: {
      ...DEFAULT_CONFIG.testServer,
      ...(config.testServer || {}),
    },
    lid: {
      ...DEFAULT_CONFIG.lid,
      ...(config.lid || {}),
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

