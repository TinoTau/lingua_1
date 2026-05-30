/**
 * Smoke test against running lexicon_intent_cpu service + downloaded GGUF.
 * Requires service at http://127.0.0.1:5018 with model_loaded=true.
 */

import { describe, expect, it } from '@jest/globals';
import { resolveLexiconIntentModelPath } from './lexicon-intent-model-path';
import { inferLexiconProfileDecision, setIntentInferenceOverride } from './cpu-llm-model-runner';
import type { RollingTurn } from '../session-runtime/types';

const SERVICE_URL = process.env.LEXICON_INTENT_SERVICE_URL ?? 'http://127.0.0.1:5018';

function travelTurn(): RollingTurn {
  return {
    turnId: 't1',
    timestamp: Date.now(),
    rawAsrText: '我想订机票去机场旁边的酒店',
    finalText: '我想订机票去机场旁边的酒店',
    sourceLang: 'zh',
    targetLang: 'en',
    activeProfileAtTurn: 'general',
    recoverStats: { noTopkCandidate: 0, domainBoostApplied: 0 },
  };
}

describe('lexicon-intent integration smoke', () => {
  it('model file exists on disk', () => {
    const model = resolveLexiconIntentModelPath();
    expect(model.exists).toBe(true);
    expect(model.resolvedPath).toMatch(/qwen2\.5-3b-instruct-q4_k_m\.gguf$/i);
  });

  it('health reports model_loaded', async () => {
    const res = await fetch(`${SERVICE_URL}/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { model_loaded?: boolean; gpu_layers?: number };
    expect(body.model_loaded).toBe(true);
    expect(body.gpu_layers).toBe(0);
  });

  it('CPU LLM returns valid profile decision for travel context', async () => {
    setIntentInferenceOverride(null);
    const decision = await inferLexiconProfileDecision({
      sessionId: 'smoke-travel',
      turns: [travelTurn()],
      currentPrimary: 'general',
      finalizedTurnCount: 1,
    });
    expect(decision).not.toBeNull();
    expect(decision!.primaryDomain).toBeTruthy();
    expect(decision!.confidence).toBeGreaterThan(0);
    expect(decision!.summary.length).toBeGreaterThan(0);
    expect(['travel', 'transport', 'restaurant', 'tech_ai', 'medical', 'meeting']).toContain(
      decision!.primaryDomain
    );
  }, 120000);
});
