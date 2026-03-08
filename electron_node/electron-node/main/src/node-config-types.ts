/** 按 serviceId 存储运行状态，由用户安装的服务动态决定 */
export type ServicePreferences = Record<string, boolean>;

/**
 * 指标收集配置
 * 支持热插拔：根据配置和服务状态动态决定收集哪些指标
 */
export interface MetricsConfig {
  enabled?: boolean;
  metrics?: {
    rerun?: boolean;
    asr?: boolean;
    nmt?: boolean;
    tts?: boolean;
    [key: string]: boolean | undefined;
  };
}

export interface NodeConfig {
  servicePreferences: ServicePreferences;
  scheduler?: { url?: string };
  modelHub?: { url?: string };
  services?: {
    baseUrl?: string;
    phoneticCorrectionUrl?: string;
    punctuationRestoreUrl?: string;
  };
  testServer?: { port?: number };
  lid?: {
    enabled?: boolean;
    modelPath?: string;
    encoderFile?: string;
    decoderFile?: string;
  };
  metrics?: MetricsConfig;
  features?: {
    enablePostProcessTranslation?: boolean;
    enableS1PromptBias?: boolean;
    enableS2Rescoring?: boolean;
    semanticRepair?: {
      zh?: { qualityThreshold?: number; forceForShortSentence?: boolean };
      en?: { qualityThreshold?: number };
      cache?: { maxSize?: number; ttlMs?: number; modelVersion?: string };
      modelIntegrityCheck?: { enabled?: boolean; checkInterval?: number };
    };
  };
  gpuArbiter?: {
    enabled?: boolean;
    gpuKeys?: string[];
    defaultQueueLimit?: number;
    defaultHoldMaxMs?: number;
    gpuUsageThreshold?: number;
    gpuUsage?: {
      sampleIntervalMs?: number;
      cacheTtlMs?: number;
      baseHighWater?: number;
      baseLowWater?: number;
      dynamicAdjustment?: {
        enabled?: boolean;
        longAudioThresholdMs?: number;
        highWaterBoost?: number;
        lowWaterBoost?: number;
        adjustmentTtlMs?: number;
      };
    };
    policies?: {
      ASR?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      NMT?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      TTS?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      SEMANTIC_REPAIR?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      PHONETIC_CORRECTION?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
      PUNCTUATION_RESTORE?: { priority?: number; maxWaitMs?: number; busyPolicy?: 'WAIT' | 'SKIP' | 'FALLBACK_CPU' };
    };
  };
  sequentialExecutor?: {
    enabled?: boolean;
    maxWaitMs?: number;
    timeoutCheckIntervalMs?: number;
  };
  textLength?: {
    minLengthToKeep?: number;
    minLengthToSend?: number;
    maxLengthToWait?: number;
    waitTimeoutMs?: number;
  };
}
