/**
 * Build Lexicon V2 intent inference request payload (Final Freeze Spec §4.1).
 */

import type { RollingTurn } from '../session-runtime/types';
import { loadLexiconProfileRegistry } from './profile-registry';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';

export type LexiconIntentRequestPayload = {
  sessionId: string;
  currentPrimary: string;
  finalizedTurnCount: number;
  turns: Array<{
    turnId: string;
    rawAsrText: string;
    repairedText: string;
    activeProfileAtTurn: string;
    recoverStats: RollingTurn['recoverStats'];
  }>;
  allowedDomains: ReturnType<typeof loadLexiconProfileRegistry>;
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
    repairedText: t.repairedText,
    activeProfileAtTurn: t.activeProfileAtTurn,
    recoverStats: t.recoverStats,
  }));

  return {
    sessionId: input.sessionId,
    currentPrimary: input.currentPrimary,
    finalizedTurnCount: input.finalizedTurnCount,
    turns,
    allowedDomains: loadLexiconProfileRegistry(),
    promptPackVersion: cfg.promptPackVersion ?? 'v1',
  };
}
