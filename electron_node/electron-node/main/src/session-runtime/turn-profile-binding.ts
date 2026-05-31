/**
 * Per-turn profile snapshot bound to JobContext (turn 内固定).
 */

import type { JobContext } from '../pipeline/context/job-context';
import type { ActiveLexiconProfileSnapshot, LexiconSessionIntent } from './types';

const PROFILE_CTX_KEY = '__lexiconProfileSnapshot';
const SESSION_INTENT_CTX_KEY = '__lexiconSessionIntent';

export function bindProfileSnapshotToContext(
  ctx: JobContext,
  snapshot: ActiveLexiconProfileSnapshot
): void {
  (ctx as JobContext & { [PROFILE_CTX_KEY]?: ActiveLexiconProfileSnapshot })[PROFILE_CTX_KEY] = {
    ...snapshot,
    secondaryDomains: [...snapshot.secondaryDomains],
    boosts: { ...snapshot.boosts },
  };
}

export function getProfileSnapshotFromContext(
  ctx: JobContext
): ActiveLexiconProfileSnapshot | undefined {
  return (ctx as JobContext & { [PROFILE_CTX_KEY]?: ActiveLexiconProfileSnapshot })[PROFILE_CTX_KEY];
}

export function getDomainBoostAppliedFromContext(ctx: JobContext): number {
  return ctx.domainBoostApplied ?? 0;
}

export function bindLexiconSessionIntentToContext(
  ctx: JobContext,
  intent: LexiconSessionIntent
): void {
  (ctx as JobContext & { [SESSION_INTENT_CTX_KEY]?: LexiconSessionIntent })[SESSION_INTENT_CTX_KEY] =
    {
      ...intent,
      topicKeywords: [...intent.topicKeywords],
      topicKeywordPinyinKeys: [...intent.topicKeywordPinyinKeys],
      secondaryDomains: [...intent.secondaryDomains],
      reason: [...intent.reason],
    };
}

export function getLexiconSessionIntentFromContext(
  ctx: JobContext
): LexiconSessionIntent | undefined {
  return (ctx as JobContext & { [SESSION_INTENT_CTX_KEY]?: LexiconSessionIntent })[
    SESSION_INTENT_CTX_KEY
  ];
}
