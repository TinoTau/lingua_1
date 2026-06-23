/**
 * ActiveLexiconProfileManager — snapshot + hysteresis (Final Freeze Spec §2.3).
 */

import type {
  ActiveLexiconProfileSnapshot,
  LexiconProfileDecision,
  ProfileSwitchEvent,
  ProfileSwitchTrigger,
} from '../session-runtime/types';
import { MAX_PROFILE_HISTORY } from '../session-runtime/types';
import { assertRegistryDomain, defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { isCoarseDomainEligibleForLlm } from '../lexicon-v2/runtime-domain-registry';

const MIN_CONFIDENCE = 0.75;
const MIN_LEAD = 0.15;

export function createInitialProfile(): ActiveLexiconProfileSnapshot {
  return defaultGeneralProfile();
}

export function buildBoostsFromDecision(
  primary: string,
  secondary: string[]
): Record<string, number> {
  const boosts: Record<string, number> = { general: 1.0 };
  if (primary !== 'general') {
    boosts[primary] = 1.15;
  }
  for (const s of secondary) {
    if (s !== 'general' && s !== primary) {
      boosts[s] = 1.08;
    }
  }
  return boosts;
}

export function applyProfileDecision(
  current: ActiveLexiconProfileSnapshot,
  decision: LexiconProfileDecision,
  trigger: ProfileSwitchTrigger,
  finalizedTurnCount: number
): {
  profile: ActiveLexiconProfileSnapshot;
  historyEntry?: ProfileSwitchEvent;
  applied: boolean;
} {
  const primary = assertRegistryDomain(decision.primaryDomain);
  if (!primary || primary === 'general' || !isCoarseDomainEligibleForLlm(primary)) {
    return { profile: current, applied: false };
  }

  const secondary = decision.secondaryDomains
    .map(assertRegistryDomain)
    .filter((d): d is string => Boolean(d && d !== primary && isCoarseDomainEligibleForLlm(d)));

  const domainChanged = primary !== current.primaryDomain;
  if (!decision.shouldSwitch && !domainChanged) {
    return { profile: current, applied: false };
  }

  if (decision.confidence < MIN_CONFIDENCE) {
    return { profile: current, applied: false };
  }

  // 从 general 首次切域时不做 hysteresis 领先分要求（current.confidence 固定为 1.0）
  if (
    current.primaryDomain !== 'general' &&
    decision.confidence - current.confidence < MIN_LEAD
  ) {
    return { profile: current, applied: false };
  }

  const effectiveFromTurn = Math.max(
    decision.effectiveFromTurn || 0,
    finalizedTurnCount + 1
  );
  const next: ActiveLexiconProfileSnapshot = {
    primaryDomain: primary,
    secondaryDomains: secondary,
    boosts: buildBoostsFromDecision(primary, secondary),
    profileVersion: `${primary}-v${effectiveFromTurn}`,
    confidence: decision.confidence,
    effectiveFromTurn,
  };

  const historyEntry: ProfileSwitchEvent = {
    from: current.primaryDomain,
    to: primary,
    confidence: decision.confidence,
    reason: decision.reason,
    trigger,
    effectiveFromTurn,
    timestamp: Date.now(),
  };

  return { profile: next, historyEntry, applied: true };
}

export function appendProfileHistory(
  history: ProfileSwitchEvent[],
  entry: ProfileSwitchEvent
): ProfileSwitchEvent[] {
  const next = [...history, entry];
  if (next.length <= MAX_PROFILE_HISTORY) {
    return next;
  }
  return next.slice(next.length - MAX_PROFILE_HISTORY);
}

/** Turn 开始：激活 pending profile（若已到 effectiveFromTurn）。 */
export function activatePendingProfileForTurn(
  session: { activeLexiconProfile: ActiveLexiconProfileSnapshot; pendingProfile?: ActiveLexiconProfileSnapshot },
  turnNumber: number
): ActiveLexiconProfileSnapshot {
  if (
    session.pendingProfile &&
    turnNumber >= session.pendingProfile.effectiveFromTurn
  ) {
    session.activeLexiconProfile = cloneProfile(session.pendingProfile);
    session.pendingProfile = undefined;
  }
  return cloneProfile(session.activeLexiconProfile);
}

export function stagePendingProfile(
  session: { pendingProfile?: ActiveLexiconProfileSnapshot },
  profile: ActiveLexiconProfileSnapshot
): void {
  session.pendingProfile = cloneProfile(profile);
}

export function resolveProfileForTurn(
  profile: ActiveLexiconProfileSnapshot,
  _turnIndex: number
): ActiveLexiconProfileSnapshot {
  return cloneProfile(profile);
}

export function cloneProfile(p: ActiveLexiconProfileSnapshot): ActiveLexiconProfileSnapshot {
  return {
    ...p,
    secondaryDomains: [...p.secondaryDomains],
    boosts: { ...p.boosts },
  };
}
