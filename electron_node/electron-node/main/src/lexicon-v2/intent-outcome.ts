/**
 * Lexicon V2 Intent — frozen outcome enum (Observability Fix Plan §3).
 */

import type { LexiconProfileDecision } from '../session-runtime/types';

export const INTENT_LAST_OUTCOMES = [
  'disabled',
  'not_configured',
  'service_unreachable',
  'model_not_loaded',
  'skipped_by_debounce',
  'skipped_no_finalized_turns',
  'inference_timeout',
  'schema_invalid',
  'unknown_domain',
  'confidence_below_threshold',
  'no_switch_needed',
  'profile_updated',
  'profile_kept',
  'error',
] as const;

export type IntentLastOutcome = (typeof INTENT_LAST_OUTCOMES)[number];

export type IntentInferenceResult = {
  decision: LexiconProfileDecision | null;
  outcome: IntentLastOutcome;
};

export function intentInferenceResult(
  outcome: IntentLastOutcome,
  decision: LexiconProfileDecision | null = null
): IntentInferenceResult {
  return { outcome, decision };
}

export function isIntentInferenceSuccess(outcome: IntentLastOutcome): boolean {
  return outcome === 'profile_updated' || outcome === 'no_switch_needed' || outcome === 'profile_kept';
}
