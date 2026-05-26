import { describe, expect, it } from '@jest/globals';
import { handleSessionMigrationHttp } from './session-migration-http';
import { clearAllSessions, ensureSession, getSession } from './session-store';
import type { JobAssignMessage } from '@shared/protocols/messages';

describe('session-migration-http', () => {
  it('export and import via HTTP handler', () => {
    clearAllSessions();
    ensureSession(
      { job_id: 'j1', session_id: 'http-s1', src_lang: 'zh', tgt_lang: 'en' } as JobAssignMessage,
      'node-a'
    );

    const exported = handleSessionMigrationHttp(
      'POST',
      '/session-migration/evacuate',
      JSON.stringify({ sessionId: 'http-s1', sourceNodeId: 'node-a' })
    );
    expect(exported?.status).toBe(200);
    const payload = (exported?.body.payload ?? {}) as Record<string, unknown>;
    expect(payload.sessionId).toBe('http-s1');
    expect(getSession('http-s1')).toBeUndefined();

    const imported = handleSessionMigrationHttp(
      'POST',
      '/session-migration/import',
      JSON.stringify({ targetNodeId: 'node-b', payload })
    );
    expect(imported?.status).toBe(200);
    expect(getSession('http-s1')?.assignedNodeId).toBe('node-b');
  });
});
