/**
 * CPU LLM model runner — HTTP client to lexicon_intent_cpu service (Final Freeze Spec §4.1).
 */

import logger from '../logger';
import type { RollingTurn } from '../session-runtime/types';
import { buildLexiconIntentRequest } from './lexicon-intent-prompt-builder';
import {
  classifyLexiconIntentParseFailure,
  parseLexiconIntentResponse,
  type ParseContext,
} from './lexicon-profile-decision-parser';
import type { LexiconProfileDecision } from '../session-runtime/types';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';
import { checkIntentHealth } from './intent-health-check';
import {
  intentInferenceResult,
  type IntentInferenceResult,
  type IntentLastOutcome,
} from './intent-outcome';
import { isIntentRecoveryInProgress, maybeScheduleIntentRecovery } from './intent-recovery';
import { isIntentWarmupCompleted } from './intent-warmup';

export type IntentInferenceInput = {
  sessionId: string;
  turns: RollingTurn[];
  currentPrimary: string;
  finalizedTurnCount: number;
};

export type IntentInferenceFn = (
  input: IntentInferenceInput
) => Promise<IntentInferenceResult>;

let inferenceOverride: IntentInferenceFn | null = null;
let skipFirstRunHealthCheck = false;

/** Test-only: inject mock CPU LLM inference. */
export function setIntentInferenceOverride(fn: IntentInferenceFn | null): void {
  inferenceOverride = fn;
}

export function setSkipFirstRunHealthCheck(skip: boolean): void {
  skipFirstRunHealthCheck = skip;
}

export function resetIntentRunnerState(): void {
  skipFirstRunHealthCheck = false;
}

function normalizeOverrideResult(
  value: IntentInferenceResult | LexiconProfileDecision | null
): IntentInferenceResult {
  if (value === null) {
    return intentInferenceResult('error');
  }
  if ('outcome' in value) {
    return value;
  }
  return intentInferenceResult('profile_kept', value);
}

export async function inferLexiconProfileDecision(
  input: IntentInferenceInput
): Promise<IntentInferenceResult> {
  if (inferenceOverride) {
    return normalizeOverrideResult(await inferenceOverride(input));
  }

  if (isIntentRecoveryInProgress()) {
    return intentInferenceResult('service_unreachable');
  }

  if (!skipFirstRunHealthCheck && !isIntentWarmupCompleted()) {
    const health = await checkIntentHealth(true);
    if (!health.reachable) {
      const result = intentInferenceResult('service_unreachable');
      maybeScheduleIntentRecovery(result.outcome);
      return result;
    }
    if (!health.modelLoaded) {
      const result = intentInferenceResult('model_not_loaded');
      maybeScheduleIntentRecovery(result.outcome);
      return result;
    }
    skipFirstRunHealthCheck = true;
  }

  const cfg = getLexiconV2CpuWorkerConfig();
  const serviceUrl = (cfg.serviceUrl ?? 'http://127.0.0.1:5018').replace(/\/$/, '');
  const timeoutMs = cfg.timeoutMs ?? 7500;
  const payload = buildLexiconIntentRequest(input);
  const ctx: ParseContext = {
    currentPrimary: input.currentPrimary,
    finalizedTurnCount: input.finalizedTurnCount,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${serviceUrl}/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      logger.warn(
        { sessionId: input.sessionId, status: response.status, detail: detail.slice(0, 200) },
        '[LexiconIntentRunner] service error, keep current profile'
      );
      const outcome: IntentLastOutcome =
        response.status === 503 ? 'model_not_loaded' : 'service_unreachable';
      const result = intentInferenceResult(outcome);
      maybeScheduleIntentRecovery(result.outcome);
      return result;
    }

    const body = (await response.json()) as unknown;
    const decision = parseLexiconIntentResponse(body, ctx);
    if (!decision) {
      const failure = classifyLexiconIntentParseFailure(body, ctx);
      logger.warn(
        { sessionId: input.sessionId, failure },
        '[LexiconIntentRunner] invalid LLM schema, discard'
      );
      const result = intentInferenceResult(failure);
      maybeScheduleIntentRecovery(result.outcome);
      return result;
    }
    const result = intentInferenceResult('profile_kept', decision);
    return result;
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    const outcome: IntentLastOutcome = isTimeout ? 'inference_timeout' : 'service_unreachable';
    logger.warn(
      { sessionId: input.sessionId, err: String(err), outcome },
      '[LexiconIntentRunner] inference failed, keep current profile'
    );
    const result = intentInferenceResult(outcome);
    maybeScheduleIntentRecovery(result.outcome);
    return result;
  } finally {
    clearTimeout(timer);
  }
}
