/**
 * Bind turn profile at job start; finalize rolling context at turn end.
 */

import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../pipeline/context/job-context';
import { loadNodeConfig } from '../node-config';
import { appendRollingTurn } from './rolling-context-manager';
import type { ActiveLexiconProfileSnapshot, RollingTurn } from './types';
import {
  activatePendingProfileForTurn,
  applyProfileDecision,
  appendProfileHistory,
  cloneProfile,
  stagePendingProfile,
} from './active-lexicon-profile-manager';
import { bindProfileSnapshotToContext } from './turn-profile-binding';
import { ensureSession, getSession, updateSession } from './session-store';
import { assertSessionAcceptedOnNode, SessionMovedError } from './session-moved';
import { persistSessionMigrationSnapshot } from './session-migration';
import { shouldScheduleIntentJob } from '../lexicon-v2/intent-job-scheduler';
import { enqueueIntentJob } from '../lexicon-v2/cpu-intent-llm-worker';
import {
  isLexiconV2Enabled,
  getLexiconV2PatchProposalDir,
  isSessionIntentSchedulingEnabled,
} from '../lexicon-v2/lexicon-v2-config';
import { flushPatchProposalsToFile } from '../lexicon/replay-patch/patch-collector';
import { isFinalizedTurnJob, resolveTurnId } from './session-turn-lifecycle';
import { checkIntentHealth } from '../lexicon-v2/intent-health-check';
import type { IntentLastOutcome } from '../lexicon-v2/intent-outcome';
import { recordIntentHealth, recordIntentOutcome } from './session-intent-diagnostics';
import logger from '../logger';

function exportSessionSnapshotIfConfigured(
  session: NonNullable<ReturnType<typeof getSession>>,
  nodeId: string
): void {
  const cfg = loadNodeConfig()?.features?.sessionAffinity;
  if (!cfg?.snapshotPath || !nodeId.trim()) {
    return;
  }
  persistSessionMigrationSnapshot(session, nodeId, cfg.snapshotPath);
}

function bindSnapshotToJobContext(ctx: JobContext, snapshot: ActiveLexiconProfileSnapshot): void {
  bindProfileSnapshotToContext(ctx, snapshot);
  ctx.activeProfilePrimary = snapshot.primaryDomain;
  ctx.profileVersion = snapshot.profileVersion;
}

function buildRollingTurn(
  job: JobAssignMessage,
  ctx: JobContext,
  turnId: string,
  activeProfileAtTurn: string
): RollingTurn {
  const rawAsr = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  const repaired = (ctx.repairedText ?? rawAsr).trim();
  const topkCount = ctx.v5Metrics?.lexicon_pinyin_topk_candidate_count ?? 0;
  const picked =
    ctx.sentenceRepairExtra?.modified && ctx.sentenceRepairDecision
      ? 'lexicon_pinyin_topk'
      : undefined;

  return {
    turnId,
    timestamp: Date.now(),
    rawAsrText: rawAsr,
    repairedText: repaired,
    sourceLang: job.src_lang || 'zh',
    targetLang: job.tgt_lang || 'en',
    activeProfileAtTurn,
    recoverStats: {
      noTopkCandidate: topkCount === 0 ? 1 : 0,
      pickedSource: picked,
      domainBoostApplied: ctx.domainBoostApplied ?? 0,
    },
  };
}

function resolveApplyOutcome(applied: boolean, decisionConfidence: number): IntentLastOutcome {
  if (applied) {
    return 'profile_updated';
  }
  if (decisionConfidence < 0.75) {
    return 'confidence_below_threshold';
  }
  return 'no_switch_needed';
}

/** Job 开始：每个 turn 只读一次 profile snapshot，turn 内固定。 */
export function beginSessionTurnProfile(
  job: JobAssignMessage,
  ctx: JobContext,
  nodeId: string,
  options?: { intentSchedulingEnabled?: boolean }
): void {
  const sessionId = job.session_id?.trim();
  if (!sessionId) {
    return;
  }

  const turnId = resolveTurnId(job);
  try {
    assertSessionAcceptedOnNode(sessionId, nodeId);
  } catch (err) {
    if (err instanceof SessionMovedError) {
      logger.warn(
        { sessionId, nodeId, assignedNodeId: err.assignedNodeId },
        '[SessionTurn] SESSION_MOVED — reject job on evacuated node (fail-open)'
      );
      return;
    }
    throw err;
  }

  const session = ensureSession(job, nodeId, options);

  if (session.currentTurnId === turnId && session.turnProfileSnapshot) {
    bindSnapshotToJobContext(ctx, session.turnProfileSnapshot);
    return;
  }

  const turnNumber = session.finalizedTurnCount + 1;
  activatePendingProfileForTurn(session, turnNumber);
  const snapshot = cloneProfile(session.activeLexiconProfile);
  session.currentTurnId = turnId;
  session.turnProfileSnapshot = snapshot;
  updateSession(session);

  bindSnapshotToJobContext(ctx, snapshot);

  if (isLexiconV2Enabled() && !session.intentDiagnostics.intentHealth) {
    void checkIntentHealth(true).then((health) => {
      const s = getSession(sessionId);
      if (!s) {
        return;
      }
      recordIntentHealth(s, health);
      updateSession(s);
    });
  }

  logger.info(
    {
      sessionId,
      turnId,
      turnNumber,
      profile: snapshot.primaryDomain,
      effectiveFromTurn: snapshot.effectiveFromTurn,
    },
    '[SessionTurn] profile bound'
  );
}

function scheduleIntentIfNeeded(session: NonNullable<ReturnType<typeof getSession>>): void {
  if (!isLexiconV2Enabled()) {
    recordIntentOutcome(session, 'disabled');
    updateSession(session);
    return;
  }

  if (!isSessionIntentSchedulingEnabled(session)) {
    recordIntentOutcome(session, 'disabled');
    updateSession(session);
    return;
  }

  const trigger = shouldScheduleIntentJob(session, Date.now());
  if (!trigger) {
    return;
  }

  void enqueueIntentJob({
    sessionId: session.sessionId,
    turns: session.rollingContext.slice(-20),
    currentPrimary: session.activeLexiconProfile.primaryDomain,
    finalizedTurnCount: session.finalizedTurnCount,
  }).then(async (result) => {
    const s = getSession(session.sessionId);
    if (!s) {
      return;
    }

    const health = await checkIntentHealth(false);
    recordIntentHealth(s, health);

    if (!result.decision) {
      recordIntentOutcome(s, result.outcome, { attempted: true, health: s.intentDiagnostics.intentHealth });
      updateSession(s);
      return;
    }

    const decision = result.decision;
    s.lexiconIntentSummary = { summary: decision.summary, updatedAt: Date.now() };
    s.lastIntentAtMs = Date.now();

    const { profile, historyEntry, applied } = applyProfileDecision(
      s.activeLexiconProfile,
      decision,
      trigger.trigger,
      s.finalizedTurnCount
    );

    const outcome = resolveApplyOutcome(applied, decision.confidence);

    if (applied && historyEntry) {
      stagePendingProfile(s, profile);
      s.profileHistory = appendProfileHistory(s.profileHistory, historyEntry);
      logger.info(
        {
          sessionId: s.sessionId,
          from: historyEntry.from,
          to: historyEntry.to,
          effectiveFromTurn: profile.effectiveFromTurn,
          trigger: trigger.trigger,
        },
        '[LexiconV2] profile decision staged'
      );
      exportSessionSnapshotIfConfigured(s, s.assignedNodeId || '');
    }

    recordIntentOutcome(s, outcome, {
      attempted: true,
      health: s.intentDiagnostics.intentHealth,
      pendingPrimary: applied ? profile.primaryDomain : undefined,
    });
    updateSession(s);
  });
}

/** Turn 结束：append rollingContext + 可选 async intent。 */
export function finalizeSessionTurn(
  job: JobAssignMessage,
  ctx: JobContext,
  nodeId: string
): void {
  const sessionId = job.session_id?.trim();
  if (!sessionId) {
    return;
  }

  if (!isFinalizedTurnJob(job)) {
    return;
  }

  try {
    assertSessionAcceptedOnNode(sessionId, nodeId);
  } catch (err) {
    if (err instanceof SessionMovedError) {
      logger.warn(
        { sessionId, nodeId, assignedNodeId: err.assignedNodeId },
        '[SessionTurn] SESSION_MOVED — skip finalize on evacuated node (fail-open)'
      );
      return;
    }
    throw err;
  }

  const turnId = resolveTurnId(job);
  const session = ensureSession(job, nodeId);
  const profileAtTurn =
    session.turnProfileSnapshot?.primaryDomain ?? session.activeLexiconProfile.primaryDomain;

  session.rollingContext = appendRollingTurn(
    session.rollingContext,
    buildRollingTurn(job, ctx, turnId, profileAtTurn)
  );
  session.finalizedTurnCount += 1;
  session.currentTurnId = undefined;
  session.turnProfileSnapshot = undefined;
  updateSession(session);

  logger.info(
    {
      sessionId,
      turnId,
      turnCount: session.finalizedTurnCount,
      profile: profileAtTurn,
    },
    '[SessionFinalize] finalized turn appended to rollingContext'
  );

  exportSessionSnapshotIfConfigured(session, nodeId);
  scheduleIntentIfNeeded(session);

  const patchDir = getLexiconV2PatchProposalDir();
  if (patchDir) {
    const flushed = flushPatchProposalsToFile(patchDir);
    if (flushed > 0) {
      logger.info({ sessionId, patchDir, count: flushed }, '[ReplayPatch] flushed proposals');
    }
  }
}
