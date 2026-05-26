import { describe, expect, it } from '@jest/globals';
import { buildIntentDiagnosticsExtra, createInitialIntentDiagnostics } from './session-intent-diagnostics';
import { INTENT_LAST_OUTCOMES } from '../lexicon-v2/intent-outcome';

describe('session-intent-diagnostics', () => {
  it('exposes split intent fields in extra', () => {
    const extra = buildIntentDiagnosticsExtra(undefined);
    expect(extra.lexiconV2Configured).toBeDefined();
    expect(extra.intentLastOutcome).toBeDefined();
    expect(extra.lexiconV2IntentEnabled).toBeDefined();
    expect(typeof extra.lexiconV2Enabled).toBe('boolean');
  });

  it('freezes intentLastOutcome enum', () => {
    expect(INTENT_LAST_OUTCOMES).toContain('profile_updated');
    expect(INTENT_LAST_OUTCOMES).toContain('service_unreachable');
    expect(INTENT_LAST_OUTCOMES).toContain('model_not_loaded');
  });

  it('initial diagnostics use disabled when not configured', () => {
    const diag = createInitialIntentDiagnostics();
    expect(diag.intentInferenceAttempted).toBe(false);
    expect(['disabled', 'not_configured']).toContain(diag.intentLastOutcome);
  });
});
