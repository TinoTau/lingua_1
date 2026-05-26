/**
 * Lexicon V2 Intent — health probe (Observability Fix Plan §4).
 * Fail-open: health failure does not block Recover; diagnostics only.
 */

import logger from '../logger';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';

export type IntentHealthSnapshot = {
  service: string;
  reachable: boolean;
  modelLoaded: boolean;
  modelName: string;
  device: string;
  lastHealthCheckAt: number;
  lastError: string | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  warmupDone?: boolean;
  inferenceCount?: number;
  lastInferenceMs?: number;
};

function healthCacheMs(): number {
  return getLexiconV2CpuWorkerConfig().healthRefreshIntervalMs ?? 180_000;
}
const DEFAULT_MODEL_NAME = 'Qwen2.5-3B-Instruct-Q4_K_M';

let cachedHealth: IntentHealthSnapshot | null = null;

function emptyHealth(lastError: string | null): IntentHealthSnapshot {
  const now = Date.now();
  return {
    service: '5018',
    reachable: false,
    modelLoaded: false,
    modelName: DEFAULT_MODEL_NAME,
    device: 'cpu',
    lastHealthCheckAt: now,
    lastError,
    lastFailureAt: lastError ? now : null,
    lastFailureReason: lastError,
  };
}

export function getCachedIntentHealth(): IntentHealthSnapshot | null {
  return cachedHealth;
}

export function resetIntentHealthCache(): void {
  cachedHealth = null;
}

export async function checkIntentHealth(force = false): Promise<IntentHealthSnapshot> {
  const now = Date.now();
  if (!force && cachedHealth && now - cachedHealth.lastHealthCheckAt < healthCacheMs()) {
    return cachedHealth;
  }

  const cfg = getLexiconV2CpuWorkerConfig();
  const serviceUrl = (cfg.serviceUrl ?? 'http://127.0.0.1:5018').replace(/\/$/, '');
  const timeoutMs = Math.min(cfg.timeoutMs ?? 7500, 5000);

  try {
    const response = await fetch(`${serviceUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const snapshot = emptyHealth(`health HTTP ${response.status}`);
      snapshot.reachable = true;
      cachedHealth = snapshot;
      return snapshot;
    }

    const body = (await response.json()) as {
      model_loaded?: boolean;
      gpu_layers?: number;
      warmup_done?: boolean;
      inference_count?: number;
      last_inference_ms?: number;
    };
    const modelLoaded = body.model_loaded === true;
    const snapshot: IntentHealthSnapshot = {
      service: '5018',
      reachable: true,
      modelLoaded,
      modelName: DEFAULT_MODEL_NAME,
      device: (body.gpu_layers ?? 0) > 0 ? 'gpu' : 'cpu',
      lastHealthCheckAt: now,
      lastError: modelLoaded ? null : 'model_not_loaded',
      lastFailureAt: modelLoaded ? null : now,
      lastFailureReason: modelLoaded ? null : 'model_not_loaded',
      warmupDone: body.warmup_done === true,
      inferenceCount:
        typeof body.inference_count === 'number' ? body.inference_count : undefined,
      lastInferenceMs:
        typeof body.last_inference_ms === 'number' ? body.last_inference_ms : undefined,
    };
    cachedHealth = snapshot;
    return snapshot;
  } catch (err) {
    const snapshot = emptyHealth(String(err));
    cachedHealth = snapshot;
    logger.warn({ err: snapshot.lastError }, '[IntentHealth] check failed');
    return snapshot;
  }
}
