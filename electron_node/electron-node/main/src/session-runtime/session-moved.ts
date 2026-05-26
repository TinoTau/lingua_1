/**
 * Per-node tombstone after evacuate — old node must reject further jobs (Phase 2 freeze R-01).
 */

import logger from '../logger';

export type SessionMovedRecord = {
  sessionId: string;
  evacuatedAtMs: number;
  /** Node that performed evacuate — only this node rejects further jobs */
  evacuatedOnNodeId: string;
  targetNodeId?: string;
};

const evacuatedSessions = new Map<string, SessionMovedRecord>();

export class SessionMovedError extends Error {
  readonly code = 'SESSION_MOVED' as const;
  readonly sessionId: string;
  readonly assignedNodeId?: string;

  constructor(sessionId: string, assignedNodeId?: string) {
    super('SESSION_MOVED');
    this.name = 'SessionMovedError';
    this.sessionId = sessionId;
    this.assignedNodeId = assignedNodeId;
  }
}

export function markSessionEvacuated(
  sessionId: string,
  evacuatedOnNodeId: string,
  targetNodeId?: string
): void {
  const id = sessionId.trim();
  const nodeId = evacuatedOnNodeId.trim();
  if (!id || !nodeId) {
    return;
  }
  evacuatedSessions.set(id, {
    sessionId: id,
    evacuatedAtMs: Date.now(),
    evacuatedOnNodeId: nodeId,
    targetNodeId: targetNodeId?.trim() || undefined,
  });
  logger.info(
    { sessionId: id, evacuatedOnNodeId: nodeId, targetNodeId },
    '[SessionMoved] session evacuated on this node'
  );
}

export function getSessionMovedRecord(sessionId: string): SessionMovedRecord | undefined {
  return evacuatedSessions.get(sessionId.trim());
}

export function assertSessionAcceptedOnNode(sessionId: string, localNodeId: string): void {
  const record = getSessionMovedRecord(sessionId);
  if (!record || record.evacuatedOnNodeId !== localNodeId.trim()) {
    return;
  }
  throw new SessionMovedError(sessionId, record.targetNodeId);
}

export function buildSessionMovedRejectBody(sessionId: string): Record<string, unknown> {
  const record = getSessionMovedRecord(sessionId);
  return {
    error: 'SESSION_MOVED',
    sessionId,
    assignedNodeId: record?.targetNodeId,
  };
}

/** Test-only */
export function clearSessionMovedRecords(): void {
  evacuatedSessions.clear();
}
