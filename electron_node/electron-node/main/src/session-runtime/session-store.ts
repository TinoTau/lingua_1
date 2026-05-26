/**
 * SessionStore — node-local session state (Final Freeze Spec §2.1).
 */

import logger from '../logger';
import type { JobAssignMessage } from '@shared/protocols/messages';
import {
  SESSION_TTL_ACTIVE_MS,
  SESSION_TTL_IDLE_MS,
  SESSION_TTL_MAX_MS,
  type SessionObject,
  type SessionSnapshot,
  type SessionStatus,
} from './types';
import { createInitialProfile } from './active-lexicon-profile-manager';
import { createInitialIntentDiagnostics } from './session-intent-diagnostics';

const sessions = new Map<string, SessionObject>();

function nowMs(): number {
  return Date.now();
}

function computeExpiresAt(createdAt: number, status: SessionStatus): number {
  const age = nowMs() - createdAt;
  const remainingMax = SESSION_TTL_MAX_MS - age;
  const ttl = status === 'active' ? SESSION_TTL_ACTIVE_MS : SESSION_TTL_IDLE_MS;
  return nowMs() + Math.min(ttl, Math.max(0, remainingMax));
}

export function getSession(sessionId: string): SessionObject | undefined {
  const s = sessions.get(sessionId);
  if (!s) {
    return undefined;
  }
  if (s.expiresAt <= nowMs()) {
    s.status = 'expired';
    sessions.delete(sessionId);
    return undefined;
  }
  return s;
}

export function ensureSession(
  job: JobAssignMessage,
  nodeId: string,
  options?: { intentSchedulingEnabled?: boolean }
): SessionObject {
  const sessionId = job.session_id?.trim();
  if (!sessionId) {
    throw new Error('[SessionStore] job missing session_id');
  }

  const existing = getSession(sessionId);
  if (existing) {
    existing.updatedAt = nowMs();
    existing.status = 'active';
    existing.expiresAt = computeExpiresAt(existing.createdAt, 'active');
    if (nodeId && !existing.assignedNodeId) {
      existing.assignedNodeId = nodeId;
    }
    return existing;
  }

  const createdAt = nowMs();
  const session: SessionObject = {
    sessionId,
    assignedNodeId: nodeId || '',
    sourceLang: job.src_lang || 'zh',
    targetLangs: [job.tgt_lang || 'en'],
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MAX_MS,
    rollingContext: [],
    activeLexiconProfile: createInitialProfile(),
    profileHistory: [],
    status: 'active',
    finalizedTurnCount: 0,
    lastIntentAtMs: 0,
    intentSchedulingEnabled: options?.intentSchedulingEnabled,
    intentDiagnostics: createInitialIntentDiagnostics(),
  };
  sessions.set(sessionId, session);
  logger.info({ sessionId, nodeId }, '[SessionStore] created session');
  return session;
}

export function updateSession(session: SessionObject): void {
  session.updatedAt = nowMs();
  session.expiresAt = computeExpiresAt(session.createdAt, session.status);
  sessions.set(session.sessionId, session);
}

export function toSessionSnapshot(session: SessionObject): SessionSnapshot {
  return {
    sessionId: session.sessionId,
    assignedNodeId: session.assignedNodeId,
    rollingContext: [...session.rollingContext],
    activeLexiconProfile: { ...session.activeLexiconProfile, boosts: { ...session.activeLexiconProfile.boosts } },
    lexiconIntentSummary: session.lexiconIntentSummary
      ? { ...session.lexiconIntentSummary }
      : undefined,
    profileHistory: [...session.profileHistory],
  };
}

export function restoreSessionSnapshot(snapshot: SessionSnapshot): SessionObject {
  const createdAt = nowMs();
  const session: SessionObject = {
    sessionId: snapshot.sessionId,
    assignedNodeId: snapshot.assignedNodeId,
    sourceLang: 'zh',
    targetLangs: ['en'],
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MAX_MS,
    rollingContext: [...snapshot.rollingContext],
    activeLexiconProfile: {
      ...snapshot.activeLexiconProfile,
      secondaryDomains: [...snapshot.activeLexiconProfile.secondaryDomains],
      boosts: { ...snapshot.activeLexiconProfile.boosts },
    },
    lexiconIntentSummary: snapshot.lexiconIntentSummary,
    profileHistory: [...snapshot.profileHistory],
    status: 'active',
    finalizedTurnCount: snapshot.rollingContext.length,
    lastIntentAtMs: 0,
    intentDiagnostics: createInitialIntentDiagnostics(),
  };
  sessions.set(session.sessionId, session);
  logger.info({ sessionId: session.sessionId }, '[SessionStore] restored from snapshot');
  return session;
}

/** Test-only */
export function clearAllSessions(): void {
  sessions.clear();
}

export function getSessionCount(): number {
  return sessions.size;
}

export function listActiveSessions(): SessionObject[] {
  const out: SessionObject[] = [];
  for (const sessionId of [...sessions.keys()]) {
    const session = getSession(sessionId);
    if (session) {
      out.push(session);
    }
  }
  return out;
}

/** 迁出成功后从本节点删除 session 状态 */
export function removeSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}
