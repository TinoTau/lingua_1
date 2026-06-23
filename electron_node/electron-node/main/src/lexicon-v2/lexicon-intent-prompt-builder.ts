/**
 * Build Lexicon V2 intent inference request payload (Final Freeze Spec §4.1).
 */

import type { RollingTurn } from '../session-runtime/types';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';
import { buildLlmAllowedDomainPayload } from './runtime-domain-registry';

export type LexiconIntentRequestPayload = {
  sessionId: string;
  currentPrimary: string;
  finalizedTurnCount: number;
  turns: Array<{
    turnId: string;
    rawAsrText: string;
    finalText: string;
    activeProfileAtTurn: string;
    recoverStats: RollingTurn['recoverStats'];
  }>;
  allowedDomains: ReturnType<typeof buildLlmAllowedDomainPayload>;
  promptPackVersion: string;
};

export function buildLexiconIntentRequest(input: {
  sessionId: string;
  turns: RollingTurn[];
  currentPrimary: string;
  finalizedTurnCount: number;
}): LexiconIntentRequestPayload {
  const cfg = getLexiconV2CpuWorkerConfig();
  const maxTurns = cfg.maxContextTurns ?? 20;
  const turns = input.turns.slice(-maxTurns).map((t) => ({
    turnId: t.turnId,
    rawAsrText: t.rawAsrText,
    finalText: t.finalText,
    activeProfileAtTurn: t.activeProfileAtTurn,
    recoverStats: t.recoverStats,
  }));

  return {
    sessionId: input.sessionId,
    currentPrimary: input.currentPrimary,
    finalizedTurnCount: input.finalizedTurnCount,
    turns,
    allowedDomains: buildLlmAllowedDomainPayload(),
    promptPackVersion: cfg.promptPackVersion ?? 'v2',
  };
}
