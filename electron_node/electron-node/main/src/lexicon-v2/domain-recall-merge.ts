/**
 * Phase 3 — resolve domain_lexicon query targets from profile / session intent domains.
 */

import { isValidLLMDomain } from './profile-registry';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

function appendUnique(out: string[], domainId: string, primary: string): void {
  const id = domainId.trim();
  if (!id || id === primary || id === 'general' || !isValidLLMDomain(id) || out.includes(id)) {
    return;
  }
  out.push(id);
}

export function resolveDomainIdsForRecall(profile: ActiveLexiconProfileSnapshot): string[] {
  const primary = profile.primaryDomain?.trim();
  if (!primary || primary === 'general' || !isValidLLMDomain(primary)) {
    return [];
  }

  const domainIds = [primary];
  for (const secondary of profile.secondaryDomains ?? []) {
    appendUnique(domainIds, secondary, primary);
  }
  return domainIds;
}

export function resolveDomainIdsFromSessionIntent(input: {
  primaryDomain: string;
  secondaryDomains: readonly string[];
}): string[] {
  return resolveDomainIdsForRecall({
    primaryDomain: input.primaryDomain,
    secondaryDomains: [...input.secondaryDomains],
    boosts: {},
    profileVersion: 'session-intent',
    confidence: 1,
    effectiveFromTurn: 0,
  });
}
