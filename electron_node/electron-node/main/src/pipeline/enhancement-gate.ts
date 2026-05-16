/**
 * 增强服务统一门控：disabled / not registered / not running → skip（在 GPU lease 与 HTTP 之前）
 */

import { JobContext } from './context/job-context';
import {
  getServiceRegistry,
  isServiceRegistryInitialized,
} from '../service-layer/ServiceRegistrySingleton';

export const ENHANCEMENT_SERVICE_IDS = {
  PHONETIC: 'phonetic-correction-zh',
  PUNCTUATION: 'punctuation-restore',
  SEMANTIC: 'semantic-repair-en-zh',
} as const;

export type EnhancementSkipReason =
  | 'DISABLED'
  | 'NOT_REGISTERED'
  | 'NOT_RUNNING';

export interface EnhancementGateResult {
  shouldRun: boolean;
  skipReason?: EnhancementSkipReason;
}

/** 配置已允许 + registry 中服务 running */
export function checkEnhancementService(
  serviceId: string,
  enabled: boolean
): EnhancementGateResult {
  if (!enabled) {
    return { shouldRun: false, skipReason: 'DISABLED' };
  }
  if (!isServiceRegistryInitialized()) {
    return { shouldRun: false, skipReason: 'NOT_REGISTERED' };
  }
  const entry = getServiceRegistry().get(serviceId);
  if (!entry) {
    return { shouldRun: false, skipReason: 'NOT_REGISTERED' };
  }
  if (entry.runtime.status !== 'running') {
    return { shouldRun: false, skipReason: 'NOT_RUNNING' };
  }
  return { shouldRun: true };
}

export function markPhoneticCorrectionSkipped(
  ctx: JobContext,
  reason: string,
  options?: { degraded?: boolean }
): void {
  ctx.phoneticCorrectionSkipped = true;
  ctx.phoneticCorrectionSkipReason = reason;
  ctx.phoneticCorrectionDegraded = options?.degraded === true;
  ctx.phoneticCorrectionHttpCalled = false;
  ctx.phoneticCorrectionApplied = false;
}

export function markPhoneticCorrectionApplied(ctx: JobContext, stepMs: number, httpMs: number): void {
  ctx.phoneticCorrectionSkipped = false;
  ctx.phoneticCorrectionSkipReason = undefined;
  ctx.phoneticCorrectionDegraded = false;
  ctx.phoneticCorrectionHttpCalled = true;
  ctx.phoneticCorrectionApplied = true;
  ctx.phoneticCorrectionStepMs = stepMs;
  ctx.phoneticCorrectionHttpMs = httpMs;
}

export function markPunctuationRestoreSkipped(
  ctx: JobContext,
  reason: string,
  options?: { degraded?: boolean }
): void {
  ctx.punctuationRestoreSkipped = true;
  ctx.punctuationRestoreSkipReason = reason;
  ctx.punctuationRestoreDegraded = options?.degraded === true;
  ctx.punctuationRestoreHttpCalled = false;
  ctx.punctuationRestoreApplied = false;
  ctx.punctuationRestoreCalls = 0;
  ctx.punctuationRestoreHttpMs = 0;
}

export function markPunctuationRestoreApplied(
  ctx: JobContext,
  stepMs: number,
  httpMs: number
): void {
  ctx.punctuationRestoreSkipped = false;
  ctx.punctuationRestoreSkipReason = undefined;
  ctx.punctuationRestoreDegraded = false;
  ctx.punctuationRestoreHttpCalled = true;
  ctx.punctuationRestoreApplied = true;
  ctx.punctuationRestoreCalls = 1;
  ctx.punctuationRestoreStepMs = stepMs;
  ctx.punctuationRestoreHttpMs = httpMs;
}
