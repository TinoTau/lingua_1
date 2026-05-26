/**
 * Scheduler ↔ Node session migration HTTP orchestrator.
 * export → import → binding (binding updated on Scheduler side after import).
 */

const MIGRATION_BACKOFF_MS = [2000, 5000, 15_000];
const MIGRATION_MAX_ATTEMPTS = 3;

export type SessionMigrationOrchestratorResult = {
  ok: boolean;
  sessionId: string;
  fromNodeId: string;
  toNodeId: string;
  reason: string;
  status: 'success' | 'failed';
  snapshotVersion: string;
  migrationAttempt: number;
  durationMs: number;
  error?: string;
  payload?: Record<string, unknown>;
};

async function postJson(
  baseUrl: string,
  route: string,
  body: Record<string, unknown>,
  timeoutMs = 15000
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `${baseUrl.replace(/\/$/, '')}${route}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: parsed };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function runMigrationAttempt(input: {
  sourceNodeBaseUrl: string;
  targetNodeBaseUrl: string;
  sessionId: string;
  sourceNodeId: string;
  targetNodeId: string;
}): Promise<{ ok: boolean; error?: string; payload?: Record<string, unknown>; snapshotVersion: string }> {
  const evacuated = await postJson(input.sourceNodeBaseUrl, '/session-migration/evacuate', {
    sessionId: input.sessionId,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
  });

  if (evacuated.status !== 200 || evacuated.body.ok !== true) {
    return {
      ok: false,
      error: String(evacuated.body.error ?? `evacuate HTTP ${evacuated.status}`),
      snapshotVersion: 'session-migration-v1',
    };
  }

  const payload = evacuated.body.payload;
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'evacuate missing payload', snapshotVersion: 'session-migration-v1' };
  }

  const snapshotVersion = String(
    (payload as { schemaVersion?: string }).schemaVersion ?? 'session-migration-v1'
  );

  const imported = await postJson(input.targetNodeBaseUrl, '/session-migration/import', {
    targetNodeId: input.targetNodeId,
    replaceExisting: true,
    payload,
  });

  if (imported.status !== 200 || imported.body.ok !== true) {
    return {
      ok: false,
      error: String(imported.body.error ?? `import HTTP ${imported.status}`),
      payload: payload as Record<string, unknown>,
      snapshotVersion,
    };
  }

  return { ok: true, payload: payload as Record<string, unknown>, snapshotVersion };
}

export async function migrateSessionBetweenNodes(input: {
  sourceNodeBaseUrl: string;
  targetNodeBaseUrl: string;
  sessionId: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason?: string;
}): Promise<SessionMigrationOrchestratorResult> {
  const reason = input.reason ?? 'node_unavailable';
  const started = Date.now();
  const base: SessionMigrationOrchestratorResult = {
    ok: false,
    sessionId: input.sessionId,
    fromNodeId: input.sourceNodeId,
    toNodeId: input.targetNodeId,
    reason,
    status: 'failed',
    snapshotVersion: 'session-migration-v1',
    migrationAttempt: 0,
    durationMs: 0,
  };

  for (let attempt = 0; attempt < MIGRATION_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(MIGRATION_BACKOFF_MS[Math.min(attempt - 1, MIGRATION_BACKOFF_MS.length - 1)] ?? 2000);
    }

    const result = await runMigrationAttempt({
      sourceNodeBaseUrl: input.sourceNodeBaseUrl,
      targetNodeBaseUrl: input.targetNodeBaseUrl,
      sessionId: input.sessionId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
    });

    if (result.ok) {
      return {
        ok: true,
        sessionId: input.sessionId,
        fromNodeId: input.sourceNodeId,
        toNodeId: input.targetNodeId,
        reason,
        status: 'success',
        snapshotVersion: result.snapshotVersion,
        migrationAttempt: attempt + 1,
        durationMs: Date.now() - started,
        payload: result.payload,
      };
    }

    base.error = result.error;
    base.snapshotVersion = result.snapshotVersion;
    base.payload = result.payload;
    base.migrationAttempt = attempt + 1;
  }

  base.durationMs = Date.now() - started;
  return base;
}
