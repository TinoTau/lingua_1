import { describe, expect, it, beforeEach } from '@jest/globals';
import type { JobAssignMessage } from '@shared/protocols/messages';
import { initJobContext } from '../pipeline/context/job-context';
import {
  beginSessionTurnProfile,
  finalizeSessionTurn,
} from './session-finalize';
import { clearAllSessions, getSession } from './session-store';
import { isFinalizedTurnJob, resolveTurnId } from './session-turn-lifecycle';
import {
  createInitialProfile,
  stagePendingProfile,
} from './active-lexicon-profile-manager';

function job(overrides: Record<string, unknown> = {}): JobAssignMessage {
  return {
    job_id: 'j1',
    session_id: 's1',
    src_lang: 'zh',
    tgt_lang: 'en',
    turn_id: 'turn-1',
    ...overrides,
  } as JobAssignMessage;
}

describe('session-turn-lifecycle', () => {
  it('resolveTurnId prefers turn_id', () => {
    expect(resolveTurnId(job({ turn_id: 't-99' }))).toBe('t-99');
    expect(resolveTurnId(job({ turn_id: undefined }))).toBe('j1');
  });

  it('isFinalizedTurnJob requires manual cut or timeout', () => {
    expect(isFinalizedTurnJob(job())).toBe(false);
    expect(isFinalizedTurnJob(job({ is_manual_cut: true }))).toBe(true);
    expect(isFinalizedTurnJob(job({ is_timeout_triggered: true }))).toBe(true);
  });
});

describe('session-finalize turn gating', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it('does not append rollingContext until turn ends', () => {
    const ctx = initJobContext(job());
    ctx.segmentForJobResult = 'hello';
    finalizeSessionTurn(job(), ctx, 'node-a');
    expect(getSession('s1')?.rollingContext.length ?? 0).toBe(0);
  });

  it('appends rollingContext on finalized turn', () => {
    const finalized = job({ is_manual_cut: true });
    const ctx = initJobContext(finalized);
    ctx.segmentForJobResult = 'final text';
    beginSessionTurnProfile(finalized, ctx, 'node-a');
    finalizeSessionTurn(finalized, ctx, 'node-a');
    const session = getSession('s1');
    expect(session?.finalizedTurnCount).toBe(1);
    expect(session?.rollingContext.length).toBe(1);
    expect(session?.rollingContext[0].turnId).toBe('turn-1');
    expect(session?.rollingContext[0].finalText).toBe('final text');
  });

  it('binds profile once per turn across jobs', () => {
    const turnJobA = job({ job_id: 'j-a', turn_id: 'turn-x' });
    beginSessionTurnProfile(turnJobA, initJobContext(turnJobA), 'node-a');

    const session = getSession('s1')!;
    stagePendingProfile(session, {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v2',
      effectiveFromTurn: 1,
    });

    const turnJobB = job({ job_id: 'j-b', turn_id: 'turn-x' });
    const ctx2 = initJobContext(turnJobB);
    beginSessionTurnProfile(turnJobB, ctx2, 'node-a');
    expect(ctx2.activeProfilePrimary).toBe('general');
  });

  it('activates pending profile on next turn', () => {
    const turn1 = job({ turn_id: 'turn-1' });
    beginSessionTurnProfile(turn1, initJobContext(turn1), 'node-a');

    const session = getSession('s1')!;
    stagePendingProfile(session, {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v2',
      effectiveFromTurn: 1,
      confidence: 0.9,
    });

    const turn1End = job({ turn_id: 'turn-1', is_manual_cut: true });
    const ctxEnd = initJobContext(turn1End);
    ctxEnd.segmentForJobResult = 't1';
    finalizeSessionTurn(turn1End, ctxEnd, 'node-a');

    const turn2 = job({ job_id: 'j2', turn_id: 'turn-2' });
    const ctxNext = initJobContext(turn2);
    beginSessionTurnProfile(turn2, ctxNext, 'node-a');
    expect(ctxNext.activeProfilePrimary).toBe('travel');
  });
});
