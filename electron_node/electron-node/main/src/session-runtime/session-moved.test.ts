import { beforeEach, describe, expect, it } from '@jest/globals';
import type { JobAssignMessage } from '@shared/protocols/messages';
import { beginSessionTurnProfile } from './session-finalize';
import { initJobContext } from '../pipeline/context/job-context';
import {
  assertSessionAcceptedOnNode,
  buildSessionMovedRejectBody,
  clearSessionMovedRecords,
  getSessionMovedRecord,
  markSessionEvacuated,
  SessionMovedError,
} from './session-moved';
import { clearAllSessions, ensureSession, getSession } from './session-store';

describe('session-moved', () => {
  beforeEach(() => {
    clearSessionMovedRecords();
    clearAllSessions();
  });

  it('markSessionEvacuated records evacuated and target node', () => {
    markSessionEvacuated('s1', 'node-a', 'node-b');
    const record = getSessionMovedRecord('s1');
    expect(record?.evacuatedOnNodeId).toBe('node-a');
    expect(record?.targetNodeId).toBe('node-b');
  });

  it('assertSessionAcceptedOnNode throws SESSION_MOVED only on evacuated node', () => {
    markSessionEvacuated('s2', 'node-a', 'node-b');
    expect(() => assertSessionAcceptedOnNode('s2', 'node-a')).toThrow(SessionMovedError);
    try {
      assertSessionAcceptedOnNode('s2', 'node-a');
    } catch (err) {
      expect(err).toBeInstanceOf(SessionMovedError);
      expect((err as SessionMovedError).code).toBe('SESSION_MOVED');
      expect((err as SessionMovedError).assignedNodeId).toBe('node-b');
    }
  });

  it('target node may continue after evacuate on source node', () => {
    markSessionEvacuated('s2b', 'node-a', 'node-b');
    expect(() => assertSessionAcceptedOnNode('s2b', 'node-b')).not.toThrow();
  });

  it('buildSessionMovedRejectBody matches freeze contract', () => {
    markSessionEvacuated('s3', 'node-a', 'node-b');
    expect(buildSessionMovedRejectBody('s3')).toEqual({
      error: 'SESSION_MOVED',
      sessionId: 's3',
      assignedNodeId: 'node-b',
    });
  });

  it('beginSessionTurnProfile fail-open when session evacuated on node', () => {
    markSessionEvacuated('s4', 'node-a', 'node-b');
    const job = {
      job_id: 'j1',
      session_id: 's4',
      src_lang: 'zh',
      tgt_lang: 'en',
    } as JobAssignMessage;
    const ctx = initJobContext(job);
    beginSessionTurnProfile(job, ctx, 'node-a');
    expect(getSession('s4')).toBeUndefined();
  });
});
