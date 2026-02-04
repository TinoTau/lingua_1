/**
 * GPU 仲裁器类型定义
 */

export type GpuTaskType = "ASR" | "NMT" | "TTS" | "SEMANTIC_REPAIR" | "PHONETIC_CORRECTION" | "PUNCTUATION_RESTORE" | "OTHER";

export type BusyPolicy = "WAIT" | "SKIP" | "FALLBACK_CPU";

export interface GpuLeaseRequest {
  gpuKey: string;                 // e.g. "gpu:0"
  taskType: GpuTaskType;
  priority: number;               // 0..100 (higher = more important)
  maxWaitMs: number;              // hard wait limit
  holdMaxMs: number;              // safety cap for execution (watchdog)
  queueLimit: number;             // maximum pending requests
  busyPolicy: BusyPolicy;
  trace: {
    jobId?: string;
    sessionId?: string;
    utteranceIndex?: number;
    stage?: string;
  };
}

export type GpuLeaseAcquireResult =
  | { status: "ACQUIRED"; leaseId: string; acquiredAt: number; queueWaitMs: number; }
  | { status: "SKIPPED"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT" | "GPU_USAGE_HIGH"; }
  | { status: "FALLBACK_CPU"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT" | "GPU_USAGE_HIGH"; }
  | { status: "TIMEOUT"; reason: "GPU_USAGE_HIGH"; };

export interface GpuLease {
  leaseId: string;
  gpuKey: string;
  taskType: GpuTaskType;
  acquiredAt: number;
  holdMaxMs: number;
  release(): void;
}

export interface GpuUsageCache {
  usagePercent: number;
  sampledAt: number;
}

export enum GpuAdmissionState {
  NORMAL = "NORMAL",
  HIGH_PRESSURE = "HIGH_PRESSURE"
}

export interface GpuUsageConfig {
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
}

export interface AsrGpuHint {
  estimatedAudioMs: number;
  estimatedGpuHoldMs: number;
}

export interface GpuArbiterConfig {
  enabled: boolean;
  gpuKeys: string[];              // e.g. ["gpu:0"]
  defaultQueueLimit: number;
  defaultHoldMaxMs: number;
  gpuUsageThreshold?: number;    // GPU使用率阈值（默认85%），超过此值会记录详细日志（已废弃，使用gpuUsage.baseHighWater）
  gpuUsage?: GpuUsageConfig;     // GPU使用率控制配置
  policies?: {
    [key in GpuTaskType]?: {
      priority: number;
      maxWaitMs: number;
      busyPolicy: BusyPolicy;
    };
  };
}

export interface GpuArbiterSnapshot {
  gpuKey: string;
  currentLease: {
    leaseId: string;
    taskType: GpuTaskType;
    acquiredAt: number;
    holdTimeMs: number;
  } | null;
  queueLength: number;
  queue: Array<{
    leaseId: string;
    taskType: GpuTaskType;
    priority: number;
    waitTimeMs: number;
  }>;
  metrics: {
    acquireTotal: {
      ACQUIRED: number;
      SKIPPED: number;
      FALLBACK_CPU: number;
    };
    queueWaitMs: number[];         // 历史等待时间
    holdMs: number[];              // 历史占用时间
    timeoutsTotal: number;
    queueFullTotal: number;
    watchdogExceededTotal: number;
  };
  gpuAdmissionState?: GpuAdmissionState;  // GPU准入状态
  gpuUsage?: number;                      // 当前GPU使用率
  gpuUsageCacheAgeMs?: number;            // GPU使用率缓存年龄
}
