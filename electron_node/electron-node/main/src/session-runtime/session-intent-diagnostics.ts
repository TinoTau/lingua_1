/**
 * Session-level Lexicon V2 Intent diagnostics (Observability Fix Plan §3–§4).
 */

import type { IntentHealthSnapshot } from '../lexicon-v2/intent-health-check';
import type { IntentLastOutcome } from '../lexicon-v2/intent-outcome';
import { isIntentInferenceSuccess } from '../lexicon-v2/intent-outcome';
import { isLexiconV2Enabled, isLexiconV2IntentEnabled } from '../lexicon-v2/lexicon-v2-config';
import { buildIntentRuntimeDiagnosticsExtra } from '../lexicon-v2/intent-runtime-metrics';
import type { SessionObject } from './types';

export type SessionIntentDiagnostics = {
  lexiconV2Configured: boolean;
  intentServiceReachable: boolean;
  intentModelLoaded: boolean;
  intentInferenceAttempted: boolean;
  intentInferenceSucceeded: boolean;
  intentLastOutcome: IntentLastOutcome;
  intentHealth?: IntentHealthSnapshot;
  pendingProfilePrimary?: string;
};

export function createInitialIntentDiagnostics(): SessionIntentDiagnostics {
  return {
    lexiconV2Configured: isLexiconV2Enabled(),
    intentServiceReachable: false,
    intentModelLoaded: false,
    intentInferenceAttempted: false,
    intentInferenceSucceeded: false,
    intentLastOutcome: isLexiconV2Enabled() ? 'not_configured' : 'disabled',
  };
}

export function recordIntentHealth(
  session: SessionObject,
  health: IntentHealthSnapshot
): void {
  session.intentDiagnostics = {
    ...session.intentDiagnostics,
    lexiconV2Configured: isLexiconV2Enabled(),
    intentServiceReachable: health.reachable,
    intentModelLoaded: health.modelLoaded,
    intentHealth: health,
    intentLastOutcome: session.intentDiagnostics.intentLastOutcome,
  };
}

export function recordIntentOutcome(
  session: SessionObject,
  outcome: IntentLastOutcome,
  options?: { attempted?: boolean; health?: IntentHealthSnapshot; pendingPrimary?: string }
): void {
  const attempted = options?.attempted ?? session.intentDiagnostics.intentInferenceAttempted;
  session.intentDiagnostics = {
    ...session.intentDiagnostics,
    lexiconV2Configured: isLexiconV2Enabled(),
    intentInferenceAttempted: attempted || outcome !== 'disabled',
    intentInferenceSucceeded: isIntentInferenceSuccess(outcome),
    intentLastOutcome: outcome,
    intentServiceReachable: options?.health?.reachable ?? session.intentDiagnostics.intentServiceReachable,
    intentModelLoaded: options?.health?.modelLoaded ?? session.intentDiagnostics.intentModelLoaded,
    intentHealth: options?.health ?? session.intentDiagnostics.intentHealth,
    pendingProfilePrimary:
      options?.pendingPrimary ?? session.pendingProfile?.primaryDomain ?? session.intentDiagnostics.pendingProfilePrimary,
  };
}

export function buildIntentDiagnosticsExtra(session: SessionObject | undefined): Record<string, unknown> {
  const configured = isLexiconV2Enabled();
  const intentEnabled = isLexiconV2IntentEnabled();
  const diag = session?.intentDiagnostics ?? createInitialIntentDiagnostics();

  return {
    /** @deprecated use lexiconV2Configured + intentLastOutcome */
    lexiconV2Enabled: configured,
    lexiconV2Configured: configured,
    lexiconV2IntentEnabled: intentEnabled,
    intentServiceReachable: diag.intentServiceReachable,
    intentModelLoaded: diag.intentModelLoaded,
    intentInferenceAttempted: diag.intentInferenceAttempted,
    intentInferenceSucceeded: diag.intentInferenceSucceeded,
    intentLastOutcome: diag.intentLastOutcome,
    intentHealth: diag.intentHealth,
    pendingProfilePrimary: diag.pendingProfilePrimary ?? session?.pendingProfile?.primaryDomain,
    ...buildIntentRuntimeDiagnosticsExtra(),
  };
}
