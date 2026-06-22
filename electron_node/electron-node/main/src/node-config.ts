import { app } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import type { NodeConfig, ServicePreferences, MetricsConfig } from './node-config-types';
import { isFwDetectorEngineEnabled } from './fw-detector/fw-mode';
import { DEFAULT_CONFIG } from './node-config-defaults';
import { getAsrRepairQualityConfig } from './asr-repair-quality/quality-config';
import {
  createMissingFileDiagnostics,
  createParseFailedDiagnostics,
  createSuccessDiagnostics,
  getConfigLoadDiagnostics,
  logConfigLoadFailure,
  setConfigLoadDiagnostics,
} from './config-load-diagnostics';
import { parseConfigJson } from './config-file-reader';

export type { NodeConfig, ServicePreferences, ServiceLastRuntimeState, MetricsConfig } from './node-config-types';

export function getConfigPath(): string {
  const fromEnv = process.env.ELECTRON_NODE_CONFIG_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const userData = app.getPath('userData');
    return path.join(userData, 'electron-node-config.json');
  } catch {
    return path.join(process.cwd(), 'electron-node-config.json');
  }
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

/** job.pipeline.use_lexicon 缺省为 false */
export function resolveJobUseLexicon(job: { pipeline?: { use_lexicon?: boolean } }): boolean {
  const p = job.pipeline;
  if (!p || !('use_lexicon' in p)) {
    return false;
  }
  return p.use_lexicon === true;
}

/** 节点 features.lexiconRecall.enabled 缺省为 false */
export function isLexiconRecallFeatureEnabled(): boolean {
  if (getConfigLoadDiagnostics().runtimeFeatureDowngrade) {
    return false;
  }
  const c = loadNodeConfig();
  return c.features?.lexiconRecall?.enabled === true;
}

export function isLexiconRecallEnabled(job: { pipeline?: { use_lexicon?: boolean } }): boolean {
  if (isFwDetectorEngineEnabled()) {
    return false;
  }
  return resolveJobUseLexicon(job) && isLexiconRecallFeatureEnabled();
}

export function isFwDetectorFeatureEnabled(): boolean {
  if (getConfigLoadDiagnostics().runtimeFeatureDowngrade) {
    return false;
  }
  const c = loadNodeConfig();
  if (c.asr?.engine !== 'fw_detector_v1') {
    return false;
  }
  return c.features?.fwDetector?.enabled === true;
}

/** 供 pipeline / 日志：说明 LEXICON_RECALL 被跳过的原因 */
export function getLexiconRecallSkipReason(
  job: { pipeline?: { use_lexicon?: boolean }; src_lang?: string },
  ctx: { detectedSourceLang?: string }
): string | null {
  if (!resolveJobUseLexicon(job)) {
    return 'job_use_lexicon_false';
  }
  if (!isLexiconRecallFeatureEnabled()) {
    return 'feature_lexicon_recall_disabled';
  }
  if (!isLexiconRecallLanguage(job, ctx)) {
    return 'unsupported_source_language';
  }
  return null;
}

/** P1 recall 仅中文源语言 */
export function isLexiconRecallLanguage(
  job: { src_lang?: string },
  ctx: { detectedSourceLang?: string }
): boolean {
  const lang =
    job.src_lang === 'auto' ? (ctx.detectedSourceLang ?? '') : (job.src_lang ?? '');
  if (!lang) {
    return false;
  }
  const base = lang.toLowerCase().split('-')[0];
  return base === 'zh' || base === 'yue';
}

/** P3 selector：maxReplacements / minPhoneticScore（节点配置，与 job 无关） */
export function getLexiconRecallSelectorConfig(): {
  maxReplacements: number;
  minPhoneticScore: number;
} {
  const q = getAsrRepairQualityConfig();
  return {
    maxReplacements: q.maxReplacements,
    minPhoneticScore: q.selectionMinPhoneticScore,
  };
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

function mergeFeatures(
  parsed: NodeConfig['features'] | undefined
): NodeConfig['features'] {
  const base = DEFAULT_CONFIG.features!;
  const p = parsed || {};
  const fwDetector = { ...base.fwDetector, ...p.fwDetector };
  const lexiconRecall = { ...base.lexiconRecall, ...p.lexiconRecall };
  if (fwDetector.enabled === true && lexiconRecall.enabled === true) {
    lexiconRecall.enabled = false;
  }
  return {
    ...base,
    ...p,
    phoneticCorrection: { ...base.phoneticCorrection, ...p.phoneticCorrection },
    semanticRepair: { ...base.semanticRepair, ...p.semanticRepair },
    punctuationRestore: { ...base.punctuationRestore, ...p.punctuationRestore },
    lexiconRecall,
    lexiconV2: { ...base.lexiconV2, ...p.lexiconV2, cpuWorker: { ...base.lexiconV2?.cpuWorker, ...p.lexiconV2?.cpuWorker } },
    lexiconRuntimeV2: { ...base.lexiconRuntimeV2, ...p.lexiconRuntimeV2 },
    sessionAffinity: { ...base.sessionAffinity, ...p.sessionAffinity },
    fwDetector,
  };
}

function mergeConfigFromParsed(parsed: Record<string, unknown>): NodeConfig {
  return {
    servicePreferences: {
      ...DEFAULT_CONFIG.servicePreferences,
      ...(parsed.servicePreferences as ServicePreferences | undefined || {}),
    },
    serviceLastRuntimeState: parsed.serviceLastRuntimeState as NodeConfig['serviceLastRuntimeState'],
    scheduler: {
      ...DEFAULT_CONFIG.scheduler,
      ...(parsed.scheduler as NodeConfig['scheduler'] | undefined || {}),
    },
    modelHub: {
      ...DEFAULT_CONFIG.modelHub,
      ...(parsed.modelHub as NodeConfig['modelHub'] | undefined || {}),
    },
    services: {
      ...DEFAULT_CONFIG.services,
      ...(parsed.services as NodeConfig['services'] | undefined || {}),
    },
    testServer: {
      ...DEFAULT_CONFIG.testServer,
      ...(parsed.testServer as NodeConfig['testServer'] | undefined || {}),
    },
    lid: {
      ...DEFAULT_CONFIG.lid,
      ...(parsed.lid as NodeConfig['lid'] | undefined || {}),
    },
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...(parsed.metrics as NodeConfig['metrics'] | undefined || {}),
      metrics: {
        ...DEFAULT_CONFIG.metrics?.metrics,
        ...((parsed.metrics as NodeConfig['metrics'] | undefined)?.metrics || {}),
      },
    },
    asr: {
      ...DEFAULT_CONFIG.asr,
      ...(parsed.asr as NodeConfig['asr'] | undefined || {}),
    },
    features: mergeFeatures(parsed.features as NodeConfig['features']),
    gpuArbiter: (parsed.gpuArbiter as NodeConfig['gpuArbiter']) || DEFAULT_CONFIG.gpuArbiter,
    sequentialExecutor: {
      ...(DEFAULT_CONFIG.sequentialExecutor || {}),
      ...(parsed.sequentialExecutor as NodeConfig['sequentialExecutor'] | undefined || {}),
    },
    textLength: {
      ...(DEFAULT_CONFIG.textLength || {}),
      ...(parsed.textLength as NodeConfig['textLength'] | undefined || {}),
    },
  };
}

function readAndMergeConfigFile(raw: string): NodeConfig {
  const { parsed, hadBom } = parseConfigJson(raw);
  setConfigLoadDiagnostics(createSuccessDiagnostics(hadBom));
  return mergeConfigFromParsed(parsed as Record<string, unknown>);
}

// 同步版本（用于向后兼容，但尽量使用异步版本）
export function loadNodeConfig(): NodeConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    setConfigLoadDiagnostics(createMissingFileDiagnostics());
    return { ...DEFAULT_CONFIG };
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  try {
    return readAndMergeConfigFile(raw);
  } catch (err) {
    const diagnostics = createParseFailedDiagnostics(err, rawStartsWithBom(raw));
    setConfigLoadDiagnostics(diagnostics);
    logConfigLoadFailure(diagnostics);
    return { ...DEFAULT_CONFIG };
  }
}

function rawStartsWithBom(raw: string): boolean {
  return raw.charCodeAt(0) === 0xfeff;
}

// 异步版本（推荐使用，不阻塞）
export async function loadNodeConfigAsync(): Promise<NodeConfig> {
  const configPath = getConfigPath();
  try {
    await fsPromises.access(configPath);
  } catch {
    setConfigLoadDiagnostics(createMissingFileDiagnostics());
    return { ...DEFAULT_CONFIG };
  }

  const raw = await fsPromises.readFile(configPath, 'utf-8');
  try {
    return readAndMergeConfigFile(raw);
  } catch (err) {
    const diagnostics = createParseFailedDiagnostics(err, rawStartsWithBom(raw));
    setConfigLoadDiagnostics(diagnostics);
    logConfigLoadFailure(diagnostics);
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
    serviceLastRuntimeState: config.serviceLastRuntimeState,
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
    asr: {
      ...DEFAULT_CONFIG.asr,
      ...(config.asr || {}),
    },
    features: mergeFeatures(config.features),
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

