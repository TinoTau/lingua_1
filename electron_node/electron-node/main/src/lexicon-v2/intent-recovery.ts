/**
 * Global Lexicon Intent auto-recovery — health refresh + optional service restart.
 */

import logger from '../logger';
import { checkIntentHealth } from './intent-health-check';
import { getLexiconV2CpuWorkerConfig, isLexiconV2Enabled } from './lexicon-v2-config';
import {
  getConsecutiveTimeoutFailures,
  recordRecoveryAttempt,
  resetConsecutiveTimeoutFailures,
} from './intent-runtime-metrics';
import type { IntentLastOutcome } from './intent-outcome';

const CONSECUTIVE_TIMEOUT_THRESHOLD = 2;

let recovering = false;
let recoveryChain: Promise<void> | null = null;
let recoveryForceEnabled: boolean | null = null;

export function forceIntentRecoveryForTest(enabled: boolean | null): void {
  recoveryForceEnabled = enabled;
}

function isRecoveryFeatureEnabled(): boolean {
  if (recoveryForceEnabled !== null) {
    return recoveryForceEnabled;
  }
  if (!isLexiconV2Enabled()) {
    return false;
  }
  return getLexiconV2CpuWorkerConfig().recoveryEnabled !== false;
}

export function isIntentRecoveryInProgress(): boolean {
  return recovering;
}

export function resetIntentRecoveryForTest(): void {
  recovering = false;
  recoveryChain = null;
  recoveryForceEnabled = null;
}

/** Test-only: simulate recovery in progress */
export function forceIntentRecoveryInProgressForTest(value: boolean): void {
  recovering = value;
}

function shouldTriggerRecovery(outcome: IntentLastOutcome): boolean {
  if (outcome === 'service_unreachable' || outcome === 'model_not_loaded') {
    return true;
  }
  if (outcome === 'inference_timeout') {
    return getConsecutiveTimeoutFailures() >= CONSECUTIVE_TIMEOUT_THRESHOLD;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function restartLexiconIntentService(): Promise<void> {
  const { getServiceRunner } = await import('../service-layer');
  const runner = getServiceRunner();
  const serviceId = 'lexicon-intent-cpu';
  try {
    await runner.stop(serviceId);
    await runner.start(serviceId);
    logger.info({ serviceId }, '[IntentRecovery] restarted lexicon-intent-cpu');
  } catch (err) {
    logger.warn({ err: String(err), serviceId }, '[IntentRecovery] service restart failed');
  }
}

async function runRecoveryCycle(): Promise<void> {
  if (!isRecoveryFeatureEnabled()) {
    return;
  }
  const cfg = getLexiconV2CpuWorkerConfig();

  const backoff = cfg.recoveryBackoffMs ?? [2000, 5000, 15000];
  const maxRetries = cfg.recoveryMaxRetries ?? 3;

  recovering = true;
  try {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const waitMs = backoff[Math.min(attempt, backoff.length - 1)] ?? 2000;
      await sleep(waitMs);
      recordRecoveryAttempt();

      const health = await checkIntentHealth(true);
      if (health.reachable && health.modelLoaded) {
        resetConsecutiveTimeoutFailures();
        logger.info({ attempt: attempt + 1 }, '[IntentRecovery] health restored');
        return;
      }

      if (cfg.recoveryRestartService === true && attempt === maxRetries - 1) {
        await restartLexiconIntentService();
        const after = await checkIntentHealth(true);
        if (after.reachable && after.modelLoaded) {
          resetConsecutiveTimeoutFailures();
          return;
        }
      }
    }
    logger.warn({}, '[IntentRecovery] exhausted retries (fail-open)');
  } finally {
    recovering = false;
  }
}

/**
 * Schedule global recovery after inference failure. Does not retry the failed job.
 */
export function maybeScheduleIntentRecovery(outcome: IntentLastOutcome): void {
  if (!isRecoveryFeatureEnabled()) {
    return;
  }
  if (!shouldTriggerRecovery(outcome)) {
    return;
  }
  if (recoveryChain) {
    return;
  }

  recoveryChain = runRecoveryCycle().finally(() => {
    recoveryChain = null;
  });
}
