import { loadNodeConfig } from '../node-config';
import { getConfigLoadDiagnostics } from '../config-load-diagnostics';
import {
  getConfiguredLexiconIntentModelPath,
  resolveLexiconIntentModelPath,
} from './lexicon-intent-model-path';

export type LexiconV2IntentMode = 'cpu_llm';

export type LexiconV2CpuWorkerConfig = {
  serviceUrl?: string;
  modelPath?: string;
  timeoutMs?: number;
  promptPackVersion?: string;
  maxContextTurns?: number;
  maxSummaryChars?: number;
  metricsEnabled?: boolean;
  warmupEnabled?: boolean;
  warmupTimeoutMs?: number;
  healthRefreshIntervalMs?: number;
  recoveryEnabled?: boolean;
  recoveryMaxRetries?: number;
  recoveryBackoffMs?: number[];
  recoveryRestartService?: boolean;
};

const DEFAULT_CPU_WORKER: Required<LexiconV2CpuWorkerConfig> = {
  serviceUrl: 'http://127.0.0.1:5018',
  modelPath: 'models/lexicon-intent/qwen2.5-3b-instruct-q4_k_m.gguf',
  timeoutMs: 7500,
  promptPackVersion: 'v1',
  maxContextTurns: 20,
  maxSummaryChars: 300,
  metricsEnabled: true,
  warmupEnabled: true,
  warmupTimeoutMs: 120_000,
  healthRefreshIntervalMs: 180_000,
  recoveryEnabled: true,
  recoveryMaxRetries: 3,
  recoveryBackoffMs: [2000, 5000, 15_000],
  recoveryRestartService: false,
};

export function isLexiconV2Enabled(): boolean {
  if (getConfigLoadDiagnostics().runtimeFeatureDowngrade) {
    return false;
  }
  return loadNodeConfig()?.features?.lexiconV2?.enabled === true;
}

/** CPU LLM Intent 调度开关（与 lexicon recall 解耦，批测可关） */
export function isLexiconV2IntentEnabled(): boolean {
  if (!isLexiconV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.lexiconV2?.intentEnabled !== false;
}

export function isSessionIntentSchedulingEnabled(session: {
  intentSchedulingEnabled?: boolean;
}): boolean {
  if (session.intentSchedulingEnabled === false) {
    return false;
  }
  return isLexiconV2IntentEnabled();
}

export function getLexiconV2IntentMode(): LexiconV2IntentMode {
  const mode = loadNodeConfig()?.features?.lexiconV2?.intentMode;
  if (mode && mode !== 'cpu_llm') {
    throw new Error(`Unsupported lexiconV2.intentMode: ${mode}. Only cpu_llm is allowed.`);
  }
  return 'cpu_llm';
}

export function getLexiconV2CpuWorkerConfig(): LexiconV2CpuWorkerConfig {
  const cfg = loadNodeConfig()?.features?.lexiconV2?.cpuWorker ?? {};
  return {
    serviceUrl: cfg.serviceUrl ?? DEFAULT_CPU_WORKER.serviceUrl,
    modelPath: cfg.modelPath ?? getConfiguredLexiconIntentModelPath(),
    timeoutMs: cfg.timeoutMs ?? DEFAULT_CPU_WORKER.timeoutMs,
    promptPackVersion: cfg.promptPackVersion ?? DEFAULT_CPU_WORKER.promptPackVersion,
    maxContextTurns: cfg.maxContextTurns ?? DEFAULT_CPU_WORKER.maxContextTurns,
    maxSummaryChars: cfg.maxSummaryChars ?? DEFAULT_CPU_WORKER.maxSummaryChars,
    metricsEnabled: cfg.metricsEnabled ?? DEFAULT_CPU_WORKER.metricsEnabled,
    warmupEnabled: cfg.warmupEnabled ?? DEFAULT_CPU_WORKER.warmupEnabled,
    warmupTimeoutMs: cfg.warmupTimeoutMs ?? DEFAULT_CPU_WORKER.warmupTimeoutMs,
    healthRefreshIntervalMs:
      cfg.healthRefreshIntervalMs ?? DEFAULT_CPU_WORKER.healthRefreshIntervalMs,
    recoveryEnabled: cfg.recoveryEnabled ?? DEFAULT_CPU_WORKER.recoveryEnabled,
    recoveryMaxRetries: cfg.recoveryMaxRetries ?? DEFAULT_CPU_WORKER.recoveryMaxRetries,
    recoveryBackoffMs: cfg.recoveryBackoffMs ?? DEFAULT_CPU_WORKER.recoveryBackoffMs,
    recoveryRestartService:
      cfg.recoveryRestartService ?? DEFAULT_CPU_WORKER.recoveryRestartService,
  };
}

export { resolveLexiconIntentModelPath, getConfiguredLexiconIntentModelPath };

export function getLexiconV2PatchProposalDir(): string | undefined {
  const dir = loadNodeConfig()?.features?.lexiconV2?.patchProposalDir?.trim();
  return dir || undefined;
}

export function isSessionAffinityEnabled(): boolean {
  return loadNodeConfig()?.features?.sessionAffinity?.enabled === true;
}
