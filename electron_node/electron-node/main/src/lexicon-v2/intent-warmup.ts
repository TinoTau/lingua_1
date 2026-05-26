/**
 * Lexicon Intent warmup — dummy /intent after 5018 health ready (Runtime Hardening Final).
 */

import logger from '../logger';
import { loadLexiconProfileRegistry } from './profile-registry';
import { getLexiconV2CpuWorkerConfig, isLexiconV2Enabled } from './lexicon-v2-config';
import { recordWarmupResult } from './intent-runtime-metrics';
import { setSkipFirstRunHealthCheck } from './cpu-llm-model-runner';

const WARMUP_SESSION_ID = '__warmup__';

let warmupInFlight: Promise<void> | null = null;
let warmupCompleted = false;

export function isIntentWarmupCompleted(): boolean {
  return warmupCompleted;
}

export function resetIntentWarmupForTest(): void {
  warmupInFlight = null;
  warmupCompleted = false;
}

function buildWarmupPayload() {
  const cfg = getLexiconV2CpuWorkerConfig();
  const allowedDomains = loadLexiconProfileRegistry().filter((d) => d.enabled && d.allowLLMSelect);
  return {
    sessionId: WARMUP_SESSION_ID,
    currentPrimary: 'general',
    finalizedTurnCount: 1,
    turns: [
      {
        turnId: 'warmup-1',
        rawAsrText: '你好',
        repairedText: '你好',
        activeProfileAtTurn: 'general',
        recoverStats: { noTopkCandidate: 0, domainBoostApplied: 0 },
      },
    ],
    allowedDomains: allowedDomains.length ? allowedDomains : [{ id: 'general', displayName: 'General', enabled: true, allowLLMSelect: true }],
    promptPackVersion: cfg.promptPackVersion ?? 'v1',
  };
}

async function postWarmupInference(): Promise<{ ok: boolean; latencyMs: number }> {
  const cfg = getLexiconV2CpuWorkerConfig();
  if (cfg.warmupEnabled === false) {
    return { ok: true, latencyMs: 0 };
  }

  const serviceUrl = (cfg.serviceUrl ?? 'http://127.0.0.1:5018').replace(/\/$/, '');
  const timeoutMs = cfg.warmupTimeoutMs ?? 120_000;
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const healthRes = await fetch(`${serviceUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!healthRes.ok) {
      return { ok: false, latencyMs: Date.now() - started };
    }
    const healthBody = (await healthRes.json()) as { model_loaded?: boolean };
    if (healthBody.model_loaded !== true) {
      return { ok: false, latencyMs: Date.now() - started };
    }

    const response = await fetch(`${serviceUrl}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildWarmupPayload()),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return { ok: false, latencyMs };
    }
    const body = (await response.json()) as { decision?: unknown };
    return { ok: body.decision != null, latencyMs };
  } catch (err) {
    logger.debug({ err: String(err) }, '[IntentWarmup] failed (fail-open)');
    return { ok: false, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run once per process after lexicon-intent-cpu health ready. Fail-open.
 */
export function scheduleIntentRuntimeWarmup(): void {
  if (!isLexiconV2Enabled()) {
    return;
  }
  const cfg = getLexiconV2CpuWorkerConfig();
  if (cfg.warmupEnabled === false) {
    warmupCompleted = true;
    setSkipFirstRunHealthCheck(true);
    return;
  }
  if (warmupCompleted || warmupInFlight) {
    return;
  }

  warmupInFlight = (async () => {
    const result = await postWarmupInference();
    recordWarmupResult(result.ok, result.latencyMs);
    warmupCompleted = true;
    if (result.ok) {
      setSkipFirstRunHealthCheck(true);
      logger.info({ latencyMs: result.latencyMs }, '[IntentWarmup] completed');
    } else {
      logger.warn({ latencyMs: result.latencyMs }, '[IntentWarmup] failed (fail-open, runtime continues)');
    }
  })().finally(() => {
    warmupInFlight = null;
  });
}

export async function runIntentRuntimeWarmupForTest(): Promise<void> {
  resetIntentWarmupForTest();
  await postWarmupInference().then((r) => {
    recordWarmupResult(r.ok, r.latencyMs);
    warmupCompleted = true;
    if (r.ok) {
      setSkipFirstRunHealthCheck(true);
    }
  });
}
