import { describe, expect, it, beforeEach } from '@jest/globals';
import type { JobAssignMessage } from '@shared/protocols/messages';
import { stagePendingProfile, createInitialProfile } from './active-lexicon-profile-manager';
import { clearAllSessions, ensureSession, getSession, getSessionCount } from './session-store';
import {
  buildSessionMigrationPayload,
  computeSessionMigrationChecksum,
  evacuateSessionForMigration,
  exportSessionForMigration,
  importSessionMigration,
  parseSessionMigrationPayload,
} from './session-migration';
import {
  clearSessionMovedRecords,
  getSessionMovedRecord,
} from './session-moved';
import { appendRollingTurn } from './rolling-context-manager';
import type { RollingTurn } from './types';

function job(sessionId: string): JobAssignMessage {
  return {
    job_id: 'j1',
    session_id: sessionId,
    src_lang: 'zh',
    tgt_lang: 'en',
    is_manual_cut: true,
  } as JobAssignMessage;
}

function turn(sessionId: string): RollingTurn {
  return {
    turnId: 't1',
    timestamp: Date.now(),
    rawAsrText: 'hello',
    repairedText: 'hello fixed',
    sourceLang: 'zh',
    targetLang: 'en',
    activeProfileAtTurn: 'general',
    recoverStats: { noTopkCandidate: 0, domainBoostApplied: 0 },
  };
}

describe('session-migration', () => {
  beforeEach(() => {
    clearAllSessions();
    clearSessionMovedRecords();
  });

  it('export payload includes pending profile and rolling context', () => {
    const session = ensureSession(job('s-migrate'), 'node-a');
    session.rollingContext = appendRollingTurn([], turn('s-migrate'));
    session.finalizedTurnCount = 1;
    stagePendingProfile(session, {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v2',
      effectiveFromTurn: 2,
      confidence: 0.9,
    });

    const payload = buildSessionMigrationPayload(session, 'node-a');
    expect(payload.schemaVersion).toBe('session-migration-v1');
    expect(payload.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(payload.sourceNodeId).toBe('node-a');
    expect(payload.rollingContext.length).toBe(1);
    expect(payload.pendingProfile?.primaryDomain).toBe('travel');
    expect(payload.finalizedTurnCount).toBe(1);
  });

  it('evacuate removes session from source node and sets tombstone', () => {
    ensureSession(job('s1'), 'node-a');
    const evacuated = evacuateSessionForMigration('s1', 'node-a', 'node-b');
    expect(evacuated.found).toBe(true);
    expect(getSession('s1')).toBeUndefined();
    expect(getSessionCount()).toBe(0);
    expect(getSessionMovedRecord('s1')?.targetNodeId).toBe('node-b');
  });

  it('computeSessionMigrationChecksum uses sha256: prefix', () => {
    const session = ensureSession(job('s1b'), 'node-a');
    const payload = buildSessionMigrationPayload(session, 'node-a');
    const { checksum, ...body } = payload;
    expect(checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(computeSessionMigrationChecksum(body)).toBe(checksum);
  });

  it('import restores session on target node', () => {
    const session = ensureSession(job('s2'), 'node-a');
    session.finalizedTurnCount = 1;
    session.rollingContext = appendRollingTurn([], turn('s2'));
    const payload = buildSessionMigrationPayload(session, 'node-a');
    evacuateSessionForMigration('s2', 'node-a');

    const result = importSessionMigration(payload, { targetNodeId: 'node-b' });
    expect(result.sessionId).toBe('s2');
    expect(result.replaced).toBe(false);

    const restored = getSession('s2');
    expect(restored?.assignedNodeId).toBe('node-b');
    expect(restored?.rollingContext.length).toBe(1);
    expect(restored?.finalizedTurnCount).toBe(1);
  });

  it('import rejects duplicate session unless replaceExisting', () => {
    ensureSession(job('s3'), 'node-b');
    const payload = buildSessionMigrationPayload(getSession('s3')!, 'node-a');

    expect(() => importSessionMigration(payload, { targetNodeId: 'node-b' })).toThrow(
      /already exists/
    );

    const replaced = importSessionMigration(payload, {
      targetNodeId: 'node-b',
      replaceExisting: true,
    });
    expect(replaced.replaced).toBe(true);
  });

  it('parseSessionMigrationPayload validates schema', () => {
    const session = ensureSession(job('s4'), 'node-a');
    const payload = buildSessionMigrationPayload(session, 'node-a');
    expect(parseSessionMigrationPayload(payload).sessionId).toBe('s4');
    expect(() => parseSessionMigrationPayload({ schemaVersion: 'v0' })).toThrow();
  });

  it('parseSessionMigrationPayload rejects checksum mismatch', () => {
    const session = ensureSession(job('s5'), 'node-a');
    const payload = buildSessionMigrationPayload(session, 'node-a');
    expect(() =>
      parseSessionMigrationPayload({ ...payload, checksum: 'deadbeef' })
    ).toThrow(/checksum mismatch/);
  });

  it('import restores intentDiagnostics from payload', () => {
    const session = ensureSession(job('s6'), 'node-a');
    session.intentDiagnostics = {
      ...session.intentDiagnostics,
      intentServiceReachable: true,
      intentModelLoaded: true,
      intentLastOutcome: 'success',
      intentHealth: {
        service: '5018',
        reachable: true,
        modelLoaded: true,
        modelName: 'test',
        device: 'cpu',
        lastHealthCheckAt: 1,
        lastError: null,
        lastFailureAt: null,
        lastFailureReason: null,
      },
    };
    const payload = buildSessionMigrationPayload(session, 'node-a');
    evacuateSessionForMigration('s6', 'node-a');
    importSessionMigration(payload, { targetNodeId: 'node-b' });
    const restored = getSession('s6');
    expect(restored?.intentDiagnostics.intentModelLoaded).toBe(true);
    expect(restored?.intentDiagnostics.intentHealth?.reachable).toBe(true);
  });

  it('exportSessionForMigration returns found=false for missing session', () => {
    expect(exportSessionForMigration('missing', 'node-a').found).toBe(false);
  });
});
