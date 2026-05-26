/**
 * Session migration — 节点迁出 / 迁入（Final Freeze Spec §5，调度对接前节点自洽）。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import { cloneProfile } from './active-lexicon-profile-manager';
import { createInitialIntentDiagnostics } from './session-intent-diagnostics';
import {
  getSession,
  listActiveSessions,
  removeSession,
  updateSession,
} from './session-store';
import { markSessionEvacuated } from './session-moved';
import type {
  RollingTurn,
  SessionMigrationExportResult,
  SessionMigrationImportResult,
  SessionMigrationPayload,
  SessionObject,
} from './types';
import { MAX_ROLLING_TURNS, SESSION_MIGRATION_SCHEMA_VERSION, SESSION_TTL_MAX_MS } from './types';

function nowMs(): number {
  return Date.now();
}

function cloneRollingTurn(turn: RollingTurn): RollingTurn {
  return {
    ...turn,
    recoverStats: { ...turn.recoverStats },
  };
}

function cloneIntentDiagnostics(session: SessionObject) {
  const diag = session.intentDiagnostics;
  return {
    ...diag,
    intentHealth: diag.intentHealth ? { ...diag.intentHealth } : undefined,
  };
}

export type SessionMigrationBody = Omit<SessionMigrationPayload, 'checksum'>;

const CHECKSUM_PREFIX = 'sha256:';

export function computeSessionMigrationChecksum(body: SessionMigrationBody): string {
  const hex = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return `${CHECKSUM_PREFIX}${hex}`;
}

function normalizeChecksum(checksum: string): string {
  const trimmed = checksum.trim();
  if (trimmed.startsWith(CHECKSUM_PREFIX)) {
    return trimmed;
  }
  return `${CHECKSUM_PREFIX}${trimmed}`;
}

export function buildSessionMigrationPayload(
  session: SessionObject,
  sourceNodeId: string
): SessionMigrationPayload {
  const body: SessionMigrationBody = {
    schemaVersion: 'session-migration-v1',
    exportedAtMs: nowMs(),
    sourceNodeId: sourceNodeId.trim(),
    sessionId: session.sessionId,
    assignedNodeId: session.assignedNodeId,
    sourceLang: session.sourceLang,
    targetLangs: [...session.targetLangs],
    rollingContext: session.rollingContext.map(cloneRollingTurn),
    activeLexiconProfile: cloneProfile(session.activeLexiconProfile),
    pendingProfile: session.pendingProfile ? cloneProfile(session.pendingProfile) : undefined,
    lexiconIntentSummary: session.lexiconIntentSummary
      ? { ...session.lexiconIntentSummary }
      : undefined,
    profileHistory: session.profileHistory.map((e) => ({
      ...e,
      reason: [...e.reason],
    })),
    finalizedTurnCount: session.finalizedTurnCount,
    lastIntentAtMs: session.lastIntentAtMs,
    intentDiagnostics: cloneIntentDiagnostics(session),
  };
  return {
    ...body,
    checksum: computeSessionMigrationChecksum(body),
  };
}

export function parseSessionMigrationPayload(raw: unknown): SessionMigrationPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[SessionMigration] payload must be an object');
  }
  const p = raw as SessionMigrationPayload;
  if (p.schemaVersion !== 'session-migration-v1') {
    throw new Error(
      `[SessionMigration] unsupported schemaVersion: ${String((p as { schemaVersion?: unknown }).schemaVersion)}`
    );
  }
  if (typeof p.checksum !== 'string' || !p.checksum.trim()) {
    throw new Error('[SessionMigration] missing checksum');
  }
  const { checksum, ...body } = p;
  const expected = computeSessionMigrationChecksum(body as SessionMigrationBody);
  if (normalizeChecksum(checksum) !== expected) {
    throw new Error('[SessionMigration] checksum mismatch');
  }
  if (!p.sessionId?.trim()) {
    throw new Error('[SessionMigration] missing sessionId');
  }
  if (!p.sourceNodeId?.trim()) {
    throw new Error('[SessionMigration] missing sourceNodeId');
  }
  if (!Array.isArray(p.rollingContext)) {
    throw new Error('[SessionMigration] rollingContext must be an array');
  }
  if (p.rollingContext.length > MAX_ROLLING_TURNS) {
    throw new Error(`[SessionMigration] rollingContext exceeds max ${MAX_ROLLING_TURNS}`);
  }
  if (!p.activeLexiconProfile?.primaryDomain) {
    throw new Error('[SessionMigration] missing activeLexiconProfile');
  }
  return { ...(body as SessionMigrationBody), checksum };
}

/** 迁出：导出 snapshot，session 仍保留在本节点 */
export function exportSessionForMigration(
  sessionId: string,
  sourceNodeId: string
): SessionMigrationExportResult {
  const session = getSession(sessionId.trim());
  if (!session) {
    return { found: false };
  }
  const payload = buildSessionMigrationPayload(session, sourceNodeId);
  logger.info(
    { sessionId, sourceNodeId, turnCount: payload.finalizedTurnCount },
    '[SessionMigration] exported (retained on node)'
  );
  return { found: true, payload };
}

/** 迁出：导出本节点全部 session，不删除 */
export function exportAllSessionsForMigration(sourceNodeId: string): SessionMigrationPayload[] {
  return listActiveSessions().map((s) => buildSessionMigrationPayload(s, sourceNodeId));
}

/** 迁出并删除：节点故障 / 主动 evacuate */
export function evacuateSessionForMigration(
  sessionId: string,
  sourceNodeId: string,
  targetNodeId?: string
): SessionMigrationExportResult {
  const exported = exportSessionForMigration(sessionId, sourceNodeId);
  if (!exported.found || !exported.payload) {
    return exported;
  }
  const sid = sessionId.trim();
  removeSession(sid);
  markSessionEvacuated(sid, sourceNodeId, targetNodeId);
  logger.info({ sessionId: sid, sourceNodeId, targetNodeId }, '[SessionMigration] evacuated (removed from node)');
  return exported;
}

/** 迁出并删除本节点全部 session */
export function evacuateAllSessionsForMigration(
  sourceNodeId: string,
  targetNodeId?: string
): SessionMigrationPayload[] {
  const payloads = exportAllSessionsForMigration(sourceNodeId);
  for (const p of payloads) {
    removeSession(p.sessionId);
    markSessionEvacuated(p.sessionId, sourceNodeId, targetNodeId);
  }
  if (payloads.length > 0) {
    logger.info({ count: payloads.length, sourceNodeId }, '[SessionMigration] evacuated all sessions');
  }
  return payloads;
}

export type SessionMigrationImportOptions = {
  /** 目标节点 id，写入 assignedNodeId */
  targetNodeId: string;
  /** 本节点已有同 sessionId 时是否覆盖（默认 false → 抛错） */
  replaceExisting?: boolean;
};

/** 迁入：从 migration payload 恢复 SessionObject */
export function importSessionMigration(
  payload: SessionMigrationPayload,
  options: SessionMigrationImportOptions
): SessionMigrationImportResult {
  const parsed = parseSessionMigrationPayload(payload);
  const targetNodeId = options.targetNodeId.trim();
  if (!targetNodeId) {
    throw new Error('[SessionMigration] targetNodeId required');
  }

  const existing = getSession(parsed.sessionId);
  if (existing && !options.replaceExisting) {
    throw new Error(
      `[SessionMigration] session ${parsed.sessionId} already exists on this node; set replaceExisting=true to overwrite`
    );
  }

  const createdAt = nowMs();
  const session: SessionObject = {
    sessionId: parsed.sessionId,
    assignedNodeId: targetNodeId,
    sourceLang: parsed.sourceLang || 'zh',
    targetLangs: parsed.targetLangs?.length ? [...parsed.targetLangs] : ['en'],
    createdAt,
    updatedAt: createdAt,
    expiresAt: createdAt + SESSION_TTL_MAX_MS,
    rollingContext: parsed.rollingContext.map(cloneRollingTurn),
    activeLexiconProfile: cloneProfile(parsed.activeLexiconProfile),
    pendingProfile: parsed.pendingProfile ? cloneProfile(parsed.pendingProfile) : undefined,
    lexiconIntentSummary: parsed.lexiconIntentSummary
      ? { ...parsed.lexiconIntentSummary }
      : undefined,
    profileHistory: parsed.profileHistory.map((e) => ({
      ...e,
      reason: [...e.reason],
    })),
    status: 'active',
    finalizedTurnCount: parsed.finalizedTurnCount,
    lastIntentAtMs: parsed.lastIntentAtMs,
    currentTurnId: undefined,
    turnProfileSnapshot: undefined,
    intentDiagnostics: parsed.intentDiagnostics
      ? {
          ...parsed.intentDiagnostics,
          intentHealth: parsed.intentDiagnostics.intentHealth
            ? { ...parsed.intentDiagnostics.intentHealth }
            : undefined,
        }
      : createInitialIntentDiagnostics(),
  };

  updateSession(session);
  logger.info(
    {
      sessionId: session.sessionId,
      targetNodeId,
      fromNodeId: parsed.sourceNodeId,
      turnCount: session.finalizedTurnCount,
      replaced: Boolean(existing),
    },
    '[SessionMigration] imported'
  );

  return { sessionId: session.sessionId, replaced: Boolean(existing) };
}

/** 可选：turn finalize / profile change 时写本地 migration 文件（批测 / 调度前调试） */
export function persistSessionMigrationSnapshot(
  session: SessionObject,
  sourceNodeId: string,
  outDir: string
): string {
  const payload = buildSessionMigrationPayload(session, sourceNodeId);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${session.sessionId}.migration.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
  return file;
}

/** 从本地 migration 文件迁入 */
export function importSessionMigrationFromFile(
  filePath: string,
  options: SessionMigrationImportOptions
): SessionMigrationImportResult {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  return importSessionMigration(parseSessionMigrationPayload(raw), options);
}

export { SESSION_MIGRATION_SCHEMA_VERSION };
