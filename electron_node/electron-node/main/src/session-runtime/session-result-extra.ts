/**
 * Build Lexicon V2 / Session observability fields for result.extra.
 */

import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../pipeline/context/job-context';
import { getSession } from './session-store';
import { getProfileSnapshotFromContext, getLexiconSessionIntentFromContext } from './turn-profile-binding';
import { buildIntentDiagnosticsExtra } from './session-intent-diagnostics';
import { buildRuntimeDiagnosticsExtra } from '../config-load-diagnostics';

export function buildSessionResultExtra(
  job: JobAssignMessage,
  ctx: JobContext
): Record<string, unknown> {
  const runtimeExtra = buildRuntimeDiagnosticsExtra();
  const sessionId = job.session_id?.trim();
  if (!sessionId) {
    return runtimeExtra;
  }

  const session = getSession(sessionId);
  const profile = getProfileSnapshotFromContext(ctx);
  const turnIntent = getLexiconSessionIntentFromContext(ctx);
  const lastHistory = session?.profileHistory[session.profileHistory.length - 1];

  return {
    ...runtimeExtra,
    sessionId,
    assignedNodeId: session?.assignedNodeId || undefined,
    ...buildIntentDiagnosticsExtra(session),
    rollingContextLength: session?.rollingContext.length ?? 0,
    activeLexiconProfile: profile
      ? {
          primaryDomain: profile.primaryDomain,
          secondaryDomains: profile.secondaryDomains,
          profileVersion: profile.profileVersion,
          confidence: profile.confidence,
          effectiveFromTurn: profile.effectiveFromTurn,
        }
      : undefined,
    effectiveFromTurn: profile?.effectiveFromTurn,
    domainBoostApplied: ctx.domainBoostApplied ?? 0,
    activeProfile: profile
      ? {
          primaryDomain: profile.primaryDomain,
          profileVersion: profile.profileVersion,
        }
      : undefined,
    profileVersion: profile?.profileVersion,
    profileSwitchEvent: lastHistory
      ? {
          from: lastHistory.from,
          to: lastHistory.to,
          trigger: lastHistory.trigger,
          effectiveFromTurn: lastHistory.effectiveFromTurn,
        }
      : undefined,
    lexiconIntentSummary: session?.lexiconIntentSummary?.summary,
    lexiconSessionIntent: turnIntent
      ? {
          summary: turnIntent.summary,
          topicKeywords: turnIntent.topicKeywords,
          topicKeywordPinyinKeys: turnIntent.topicKeywordPinyinKeys,
          primaryDomain: turnIntent.primaryDomain,
          secondaryDomains: turnIntent.secondaryDomains,
          confidence: turnIntent.confidence,
          effectiveFromTurn: turnIntent.effectiveFromTurn,
          source: turnIntent.source,
        }
      : session?.lexiconSessionIntent
        ? {
            summary: session.lexiconSessionIntent.summary,
            topicKeywords: session.lexiconSessionIntent.topicKeywords,
            topicKeywordPinyinKeys: session.lexiconSessionIntent.topicKeywordPinyinKeys,
            primaryDomain: session.lexiconSessionIntent.primaryDomain,
            secondaryDomains: session.lexiconSessionIntent.secondaryDomains,
            confidence: session.lexiconSessionIntent.confidence,
            effectiveFromTurn: session.lexiconSessionIntent.effectiveFromTurn,
            source: session.lexiconSessionIntent.source,
          }
        : undefined,
    noTopkCandidate: ctx.v5Metrics?.lexicon_pinyin_topk_candidate_count === 0 ? 1 : 0,
  };
}
