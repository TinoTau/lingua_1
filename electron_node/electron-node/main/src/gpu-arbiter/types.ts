/**
 * GPU 仲裁器类型定义
 */

export type GpuTaskType = "ASR" | "NMT" | "TTS" | "SEMANTIC_REPAIR" | "OTHER";

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
  | { status: "SKIPPED"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT"; }
  | { status: "FALLBACK_CPU"; reason: "GPU_BUSY" | "QUEUE_FULL" | "TIMEOUT"; };

export interface GpuLease {
  leaseId: string;
  gpuKey: string;
  taskType: GpuTaskType;
  acquiredAt: number;
  holdMaxMs: number;
  release(): void;
}

export interface GpuArbiterConfig {
  enabled: boolean;
  gpuKeys: string[];              // e.g. ["gpu:0"]
  defaultQueueLimit: number;
  defaultHoldMaxMs: number;
  gpuUsageThreshold?: number;    // GPU使用率阈值（默认85%），超过此值会记录详细日志
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
}
