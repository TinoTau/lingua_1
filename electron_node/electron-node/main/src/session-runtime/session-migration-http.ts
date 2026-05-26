/**
 * Session migration HTTP handlers — 5020 test server / 未来 Scheduler 对接同契约。
 */

import {
  evacuateAllSessionsForMigration,
  evacuateSessionForMigration,
  exportAllSessionsForMigration,
  exportSessionForMigration,
  importSessionMigration,
  parseSessionMigrationPayload,
} from './session-migration';

export type SessionMigrationHttpResponse = {
  status: number;
  body: Record<string, unknown>;
};

function readString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function handleSessionMigrationHttp(
  method: string,
  path: string,
  bodyText: string
): SessionMigrationHttpResponse | null {
  const normalized = path.replace(/\/$/, '') || '/';
  if (!normalized.startsWith('/session-migration')) {
    return null;
  }

  let body: Record<string, unknown> = {};
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return { status: 400, body: { error: 'Invalid JSON body' } };
    }
  }

  if (method === 'GET' && normalized.startsWith('/session-migration/export/')) {
    const [pathOnly, query = ''] = normalized.split('?');
    const sessionId = decodeURIComponent(pathOnly.slice('/session-migration/export/'.length)).trim();
    const params = new URLSearchParams(query);
    const sourceNodeId = params.get('sourceNodeId')?.trim() || readString(body, 'sourceNodeId') || 'node-local';
    if (!sessionId) {
      return { status: 400, body: { error: 'sessionId required' } };
    }
    const result = exportSessionForMigration(sessionId, sourceNodeId);
    if (!result.found) {
      return { status: 404, body: { error: 'session not found', sessionId } };
    }
    return { status: 200, body: { ok: true, payload: result.payload } };
  }

  if (method === 'POST' && normalized === '/session-migration/export') {
    const sessionId = readString(body, 'sessionId');
    const sourceNodeId = readString(body, 'sourceNodeId');
    if (!sessionId || !sourceNodeId) {
      return { status: 400, body: { error: 'sessionId and sourceNodeId required' } };
    }
    const result = exportSessionForMigration(sessionId, sourceNodeId);
    if (!result.found) {
      return { status: 404, body: { error: 'session not found', sessionId } };
    }
    return { status: 200, body: { ok: true, payload: result.payload } };
  }

  if (method === 'POST' && normalized === '/session-migration/export-all') {
    const sourceNodeId = readString(body, 'sourceNodeId');
    if (!sourceNodeId) {
      return { status: 400, body: { error: 'sourceNodeId required' } };
    }
    const payloads = exportAllSessionsForMigration(sourceNodeId);
    return { status: 200, body: { ok: true, count: payloads.length, sessions: payloads } };
  }

  if (method === 'POST' && normalized === '/session-migration/evacuate') {
    const sessionId = readString(body, 'sessionId');
    const sourceNodeId = readString(body, 'sourceNodeId');
    const targetNodeId = readString(body, 'targetNodeId') || undefined;
    if (!sessionId || !sourceNodeId) {
      return { status: 400, body: { error: 'sessionId and sourceNodeId required' } };
    }
    const result = evacuateSessionForMigration(sessionId, sourceNodeId, targetNodeId);
    if (!result.found) {
      return { status: 404, body: { error: 'session not found', sessionId } };
    }
    return { status: 200, body: { ok: true, evacuated: true, payload: result.payload } };
  }

  if (method === 'POST' && normalized === '/session-migration/evacuate-all') {
    const sourceNodeId = readString(body, 'sourceNodeId');
    const targetNodeId = readString(body, 'targetNodeId') || undefined;
    if (!sourceNodeId) {
      return { status: 400, body: { error: 'sourceNodeId required' } };
    }
    const payloads = evacuateAllSessionsForMigration(sourceNodeId, targetNodeId);
    return { status: 200, body: { ok: true, count: payloads.length, sessions: payloads } };
  }

  if (method === 'POST' && normalized === '/session-migration/import') {
    const targetNodeId = readString(body, 'targetNodeId');
    if (!targetNodeId) {
      return { status: 400, body: { error: 'targetNodeId required' } };
    }
    const replaceExisting = body.replaceExisting === true;
    try {
      const payload = parseSessionMigrationPayload(body.payload ?? body);
      const result = importSessionMigration(payload, { targetNodeId, replaceExisting });
      return { status: 200, body: { ok: true, ...result } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 400, body: { error: message } };
    }
  }

  return { status: 404, body: { error: 'session migration route not found', path: normalized } };
}
