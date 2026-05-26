/**
 * Global Lexicon Intent runtime metrics (Phase 1 Runtime Hardening Final).
 * Process-lifetime counters; reset on process restart only.
 */

import type { IntentLastOutcome } from './intent-outcome';
import { getLexiconV2CpuWorkerConfig, isLexiconV2Enabled } from './lexicon-v2-config';

export type IntentRuntimeGlobalSnapshot = {
  intentLatencyMs: number;
  intentLastLatencyMs: number;
  intentQueueDepth: number;
  intentDroppedJobs: number;
  intentLatestOnlyReplaceCount: number;
  intentTimeoutCount: number;
  intentSuccessCount: number;
  intentFailureCount: number;
  llmWorkerBusy: boolean;
  warmupAttempted: boolean;
  warmupSucceeded: boolean;
  warmupLatencyMs: number | null;
  recoveryAttempts: number;
  lastRecoveryAt: number | null;
  consecutiveTimeoutFailures: number;
};

const FAILURE_OUTCOMES = new Set<IntentLastOutcome>([
  'not_configured',
  'service_unreachable',
  'model_not_loaded',
  'inference_timeout',
  'schema_invalid',
  'unknown_domain',
  'error',
]);

const SUCCESS_OUTCOMES = new Set<IntentLastOutcome>([
  'confidence_below_threshold',
  'no_switch_needed',
  'profile_updated',
  'profile_kept',
]);

let intentLatencyMs = 0;
let intentLastLatencyMs = 0;
let intentQueueDepth = 0;
let intentDroppedJobs = 0;
let intentLatestOnlyReplaceCount = 0;
let intentTimeoutCount = 0;
let intentSuccessCount = 0;
let intentFailureCount = 0;
let llmWorkerBusy = false;
let warmupAttempted = false;
let warmupSucceeded = false;
let warmupLatencyMs: number | null = null;
let recoveryAttempts = 0;
let lastRecoveryAt: number | null = null;
let consecutiveTimeoutFailures = 0;
let metricsForceEnabled: boolean | null = null;

export function forceIntentRuntimeMetricsForTest(enabled: boolean | null): void {
  metricsForceEnabled = enabled;
}

export function isIntentRuntimeMetricsEnabled(): boolean {
  if (metricsForceEnabled !== null) {
    return metricsForceEnabled;
  }
  if (!isLexiconV2Enabled()) {
    return false;
  }
  return getLexiconV2CpuWorkerConfig().metricsEnabled !== false;
}

export function recordIntentQueueDepth(depth: number, busy: boolean): void {
  if (!isIntentRuntimeMetricsEnabled()) {
    return;
  }
  intentQueueDepth = Math.min(2, Math.max(0, depth));
  llmWorkerBusy = busy;
}

export function recordPendingJobReplaced(): void {
  if (!isIntentRuntimeMetricsEnabled()) {
    return;
  }
  intentLatestOnlyReplaceCount += 1;
  intentDroppedJobs += 1;
}

const NON_METRIC_OUTCOMES = new Set<IntentLastOutcome>([
  'disabled',
  'skipped_by_debounce',
  'skipped_no_finalized_turns',
]);

export function recordIntentJobFinished(
  outcome: IntentLastOutcome,
  latencyMs: number
): void {
  if (!isIntentRuntimeMetricsEnabled()) {
    return;
  }
  if (!NON_METRIC_OUTCOMES.has(outcome)) {
    intentLastLatencyMs = latencyMs;
    intentLatencyMs = latencyMs;
  }

  if (outcome === 'inference_timeout') {
    intentTimeoutCount += 1;
    consecutiveTimeoutFailures += 1;
  } else {
    consecutiveTimeoutFailures = 0;
  }

  if (SUCCESS_OUTCOMES.has(outcome)) {
    intentSuccessCount += 1;
  } else if (FAILURE_OUTCOMES.has(outcome)) {
    intentFailureCount += 1;
  }
}

export function getConsecutiveTimeoutFailures(): number {
  return consecutiveTimeoutFailures;
}

export function resetConsecutiveTimeoutFailures(): void {
  consecutiveTimeoutFailures = 0;
}

export function recordWarmupResult(succeeded: boolean, latencyMs: number | null): void {
  warmupAttempted = true;
  warmupSucceeded = succeeded;
  warmupLatencyMs = latencyMs;
}

export function recordRecoveryAttempt(): void {
  recoveryAttempts += 1;
  lastRecoveryAt = Date.now();
}

export function getIntentRuntimeGlobalSnapshot(): IntentRuntimeGlobalSnapshot {
  return {
    intentLatencyMs,
    intentLastLatencyMs,
    intentQueueDepth,
    intentDroppedJobs,
    intentLatestOnlyReplaceCount,
    intentTimeoutCount,
    intentSuccessCount,
    intentFailureCount,
    llmWorkerBusy,
    warmupAttempted,
    warmupSucceeded,
    warmupLatencyMs,
    recoveryAttempts,
    lastRecoveryAt,
    consecutiveTimeoutFailures,
  };
}

/** Flat keys for result.extra — namespace intentRuntime.* */
export function buildIntentRuntimeDiagnosticsExtra(): Record<string, unknown> {
  if (!isIntentRuntimeMetricsEnabled()) {
    return {};
  }
  const s = getIntentRuntimeGlobalSnapshot();
  return {
    'intentRuntime.intentLatencyMs': s.intentLatencyMs,
    'intentRuntime.intentLastLatencyMs': s.intentLastLatencyMs,
    'intentRuntime.intentQueueDepth': s.intentQueueDepth,
    'intentRuntime.intentDroppedJobs': s.intentDroppedJobs,
    'intentRuntime.intentLatestOnlyReplaceCount': s.intentLatestOnlyReplaceCount,
    'intentRuntime.intentTimeoutCount': s.intentTimeoutCount,
    'intentRuntime.intentSuccessCount': s.intentSuccessCount,
    'intentRuntime.intentFailureCount': s.intentFailureCount,
    'intentRuntime.llmWorkerBusy': s.llmWorkerBusy,
    'intentRuntime.warmupAttempted': s.warmupAttempted,
    'intentRuntime.warmupSucceeded': s.warmupSucceeded,
    'intentRuntime.warmupLatencyMs': s.warmupLatencyMs,
    'intentRuntime.recoveryAttempts': s.recoveryAttempts,
    'intentRuntime.lastRecoveryAt': s.lastRecoveryAt,
  };
}

/** Node / batch diagnostics payload */
export function buildIntentRuntimeDiagnosticsReport(): {
  intentRuntime: IntentRuntimeGlobalSnapshot;
  intentHealthFailures: number;
} {
  return {
    intentRuntime: getIntentRuntimeGlobalSnapshot(),
    intentHealthFailures: intentFailureCount,
  };
}

/** Test-only */
export function resetIntentRuntimeMetricsForTest(): void {
  metricsForceEnabled = null;
  intentLatencyMs = 0;
  intentLastLatencyMs = 0;
  intentQueueDepth = 0;
  intentDroppedJobs = 0;
  intentLatestOnlyReplaceCount = 0;
  intentTimeoutCount = 0;
  intentSuccessCount = 0;
  intentFailureCount = 0;
  llmWorkerBusy = false;
  warmupAttempted = false;
  warmupSucceeded = false;
  warmupLatencyMs = null;
  recoveryAttempts = 0;
  lastRecoveryAt = null;
  consecutiveTimeoutFailures = 0;
}
