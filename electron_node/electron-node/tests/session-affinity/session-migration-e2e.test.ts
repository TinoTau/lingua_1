import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../main/src/lexicon-v2/lexicon-v2-config', () => ({
  isLexiconV2Enabled: () => true,
  isLexiconV2IntentEnabled: () => true,
  isSessionIntentSchedulingEnabled: () => true,
  getLexiconV2PatchProposalDir: () => undefined,
  getLexiconV2CpuWorkerConfig: () => ({ maxSummaryChars: 300, timeoutMs: 7500 }),
}));

import {
  beginSessionTurnProfile,
  finalizeSessionTurn,
} from '../../main/src/session-runtime/session-finalize';
import { clearAllSessions, getSession } from '../../main/src/session-runtime/session-store';
import { initJobContext } from '../../main/src/pipeline/context/job-context';
import {
  resetIntentWorker,
} from '../../main/src/lexicon-v2/cpu-intent-llm-worker';
import {
  resetIntentRunnerState,
  setIntentInferenceOverride,
} from '../../main/src/lexicon-v2/cpu-llm-model-runner';
import { intentInferenceResult } from '../../main/src/lexicon-v2/intent-outcome';
import { handleSessionMigrationHttp } from '../../main/src/session-runtime/session-migration-http';
import { migrateSessionBetweenNodes } from '../../main/src/session-runtime/session-migration-orchestrator';
import {
  clearSessionMovedRecords,
  getSessionMovedRecord,
} from '../../main/src/session-runtime/session-moved';
import {
  appendProfileHistory,
  createInitialProfile,
  stagePendingProfile,
} from '../../main/src/session-runtime/active-lexicon-profile-manager';
import type { JobAssignMessage } from '@shared/protocols/messages';

const NODE_A = 'node-a';
const NODE_B = 'node-b';
const BASE_URL = 'http://127.0.0.1:5020';

function job(sessionId: string, turnIndex: number, text: string): JobAssignMessage {
  return {
    job_id: `j-${sessionId}-${turnIndex}`,
    session_id: sessionId,
    utterance_index: turnIndex,
    src_lang: 'zh',
    tgt_lang: 'en',
    pipeline: { use_asr: true, use_nmt: false, use_tts: false, use_lexicon: true },
    turn_id: `t-${turnIndex}`,
    is_manual_cut: true,
  } as JobAssignMessage;
}

function ctxWithText(j: JobAssignMessage, text: string) {
  const ctx = initJobContext(j);
  ctx.asrText = text;
  ctx.segmentForJobResult = text;
  ctx.segmentForJobResult = text;
  ctx.v5Metrics = { lexicon_pinyin_topk_candidate_count: 1 } as any;
  return ctx;
}

function runTurn(sessionId: string, turnIndex: number, text: string, nodeId: string) {
  const j = job(sessionId, turnIndex, text);
  const ctx = ctxWithText(j, text);
  beginSessionTurnProfile(j, ctx, nodeId);
  finalizeSessionTurn(j, ctx, nodeId);
}

async function mockFetch(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url);
  const routePath = u.pathname;
  const method = init?.method ?? 'GET';
  const bodyText = typeof init?.body === 'string' ? init.body : '';
  const handled = handleSessionMigrationHttp(method, routePath, bodyText);
  if (!handled) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }
  return new Response(JSON.stringify(handled.body), { status: handled.status });
}

describe('session-migration-e2e', () => {
  beforeEach(() => {
    clearAllSessions();
    clearSessionMovedRecords();
    resetIntentWorker();
    resetIntentRunnerState();
    setIntentInferenceOverride(null);
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('3 finalized turns + travel profile → evacuate → import → append on node B', async () => {
    const sessionId = 'session-migration-e2e-1';

    runTurn(sessionId, 0, '我想去机场', NODE_A);
    runTurn(sessionId, 1, '明天需要 taxi', NODE_A);
    runTurn(sessionId, 2, '酒店 check in 是几点', NODE_A);

    const before = getSession(sessionId)!;
    expect(before.finalizedTurnCount).toBe(3);
    expect(before.rollingContext.length).toBe(3);
    expect(before.activeLexiconProfile.primaryDomain).toBe('general');

    stagePendingProfile(before, {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v4',
      effectiveFromTurn: 4,
      confidence: 0.9,
    });
    before.activeLexiconProfile = {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v4',
      effectiveFromTurn: 4,
      confidence: 0.9,
    };
    before.profileHistory = appendProfileHistory(before.profileHistory, {
      from: 'general',
      to: 'travel',
      confidence: 0.9,
      reason: ['airport', 'taxi', 'hotel'],
      trigger: 'bootstrap',
      effectiveFromTurn: 4,
      timestamp: Date.now(),
    });

    const migrated = await migrateSessionBetweenNodes({
      sourceNodeBaseUrl: BASE_URL,
      targetNodeBaseUrl: BASE_URL,
      sessionId,
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
      reason: 'node_unavailable',
    });

    expect(migrated.ok).toBe(true);
    expect(migrated.status).toBe('success');
    expect(getSessionMovedRecord(sessionId)?.targetNodeId).toBe(NODE_B);

    const restored = getSession(sessionId)!;
    expect(restored.assignedNodeId).toBe(NODE_B);
    expect(restored.rollingContext.length).toBe(3);
    expect(restored.activeLexiconProfile.primaryDomain).toBe('travel');
    expect(restored.profileHistory.length).toBeGreaterThanOrEqual(1);

    runTurn(sessionId, 3, '第四句继续对话', NODE_B);
    const after = getSession(sessionId)!;
    expect(after.finalizedTurnCount).toBe(4);
    expect(after.rollingContext.length).toBe(4);
    expect(after.assignedNodeId).toBe(NODE_B);
  });

  it(
    'export failed keeps binding unchanged (no import)',
    async () => {
    const result = await migrateSessionBetweenNodes({
      sourceNodeBaseUrl: BASE_URL,
      targetNodeBaseUrl: BASE_URL,
      sessionId: 'missing-session',
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    },
    25_000
  );

  it('GET export returns snapshot without partial ASR fields', () => {
    const sessionId = 'get-export-session';
    runTurn(sessionId, 0, '测试导出', NODE_A);
    const resp = handleSessionMigrationHttp(
      'GET',
      `/session-migration/export/${sessionId}?sourceNodeId=${NODE_A}`,
      ''
    );
    expect(resp?.status).toBe(200);
    const payload = resp?.body.payload as Record<string, unknown>;
    expect(payload?.sessionId).toBe(sessionId);
    expect(payload?.rollingContext).toBeTruthy();
    expect(payload).not.toHaveProperty('audio');
    expect(payload).not.toHaveProperty('candidateCache');
  });

  it('evacuated session on node A rejects further turns (SESSION_MOVED fail-open)', async () => {
    const sessionId = 'session-moved-reject';
    runTurn(sessionId, 0, '第一句', NODE_A);
    const migrated = await migrateSessionBetweenNodes({
      sourceNodeBaseUrl: BASE_URL,
      targetNodeBaseUrl: BASE_URL,
      sessionId,
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(migrated.ok).toBe(true);
    expect(getSessionMovedRecord(sessionId)?.targetNodeId).toBe(NODE_B);

    const beforeReject = getSession(sessionId)?.finalizedTurnCount ?? 0;
    runTurn(sessionId, 1, '旧节点误收', NODE_A);
    expect(getSession(sessionId)?.finalizedTurnCount ?? 0).toBe(beforeReject);
  });

  it('unfinished turn is not in rollingContext', () => {
    const sessionId = 'unfinished-turn';
    const j = job(sessionId, 0, '未完成');
    const ctx = ctxWithText(j, '未完成');
    beginSessionTurnProfile(j, ctx, NODE_A);
    const s = getSession(sessionId)!;
    expect(s.rollingContext.length).toBe(0);
    expect(s.currentTurnId).toBeTruthy();
  });
});

describe('session-migration-e2e intent profile via worker', () => {
  beforeEach(() => {
    clearAllSessions();
    clearSessionMovedRecords();
    resetIntentWorker();
    resetIntentRunnerState();
    setIntentInferenceOverride(async () =>
      intentInferenceResult('profile_kept', {
        summary: 'travel context',
        primaryDomain: 'travel',
        secondaryDomains: [],
        confidence: 0.88,
        shouldSwitch: true,
        reason: ['airport'],
        effectiveFromTurn: 2,
      })
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it('pending profile migrates to target node', async () => {
    const sessionId = 'intent-migrate';
    runTurn(sessionId, 0, '我想去机场', NODE_A);

    const before = getSession(sessionId)!;
    stagePendingProfile(before, {
      ...createInitialProfile(),
      primaryDomain: 'travel',
      profileVersion: 'travel-v4',
      effectiveFromTurn: 2,
      confidence: 0.88,
    });
    expect(before.pendingProfile?.primaryDomain).toBe('travel');

    const migrated = await migrateSessionBetweenNodes({
      sourceNodeBaseUrl: BASE_URL,
      targetNodeBaseUrl: BASE_URL,
      sessionId,
      sourceNodeId: NODE_A,
      targetNodeId: NODE_B,
    });
    expect(migrated.ok).toBe(true);

    const restored = getSession(sessionId)!;
    expect(restored.pendingProfile?.primaryDomain).toBe('travel');
  });
});
