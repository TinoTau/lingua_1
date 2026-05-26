import { describe, expect, it, beforeEach } from '@jest/globals';
import { appendRollingTurn } from './rolling-context-manager';
import { shouldScheduleIntentJob } from '../lexicon-v2/intent-job-scheduler';
import { clearAllSessions, ensureSession, getSession } from './session-store';
import { createInitialProfile } from './active-lexicon-profile-manager';
import { createInitialIntentDiagnostics } from './session-intent-diagnostics';
import type { RollingTurn, SessionObject } from './types';
import { INTENT_NO_TOPK_STREAK_TURNS } from './types';

function mockJob(sessionId: string) {
  return {
    job_id: 'j1',
    session_id: sessionId,
    src_lang: 'zh',
    tgt_lang: 'en',
  } as any;
}

function turn(noTopk: boolean): RollingTurn {
  return {
    turnId: 't',
    timestamp: Date.now(),
    rawAsrText: 'x',
    repairedText: 'x',
    sourceLang: 'zh',
    targetLang: 'en',
    activeProfileAtTurn: 'general',
    recoverStats: {
      noTopkCandidate: noTopk ? 1 : 0,
      domainBoostApplied: 0,
    },
  };
}

describe('session-runtime', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it('appendRollingTurn keeps max 20', () => {
    let ctx: RollingTurn[] = [];
    for (let i = 0; i < 25; i++) {
      ctx = appendRollingTurn(ctx, { ...turn(false), turnId: String(i) });
    }
    expect(ctx.length).toBe(20);
    expect(ctx[0].turnId).toBe('5');
  });

  it('ensureSession creates SessionObject', () => {
    const s = ensureSession(mockJob('s1'), 'node-a');
    expect(s.sessionId).toBe('s1');
    expect(s.activeLexiconProfile.primaryDomain).toBe('general');
  });

  it('no_topk surge triggers intent', () => {
    const session: SessionObject = {
      sessionId: 's1',
      assignedNodeId: 'n1',
      sourceLang: 'zh',
      targetLangs: ['en'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 999999,
      rollingContext: Array.from({ length: INTENT_NO_TOPK_STREAK_TURNS }, () => turn(true)),
      activeLexiconProfile: createInitialProfile(),
      profileHistory: [],
      status: 'active',
      finalizedTurnCount: 10,
      lastIntentAtMs: Date.now(),
      intentDiagnostics: createInitialIntentDiagnostics(),
    };
    const trigger = shouldScheduleIntentJob(session, Date.now());
    expect(trigger?.trigger).toBe('no_topk_surge');
  });
});
