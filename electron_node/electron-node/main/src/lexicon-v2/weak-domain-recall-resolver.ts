/**
 * P0 — weak domain recall plan (strong / weak domain ids for SQL + boost).
 */

import { isValidLLMDomain } from './profile-registry';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

export type WeakDomainRecallPlan = {
  enabled: boolean;
  strongDomainIds: readonly string[];
  weakDomainIds: readonly string[];
  queryDomainIds: readonly string[];
};

function filterEnabledDomains(enabledDomains: readonly string[]): string[] {
  return enabledDomains.filter((d) => isValidLLMDomain(d) && d !== 'general');
}

export function resolveWeakDomainRecallPlan(
  profile: ActiveLexiconProfileSnapshot,
  enabledDomains: readonly string[],
  weakEnabled: boolean
): WeakDomainRecallPlan {
  if (!weakEnabled) {
    return {
      enabled: false,
      strongDomainIds: [],
      weakDomainIds: [],
      queryDomainIds: [],
    };
  }

  const validEnabled = filterEnabledDomains(enabledDomains);
  const primary = profile.primaryDomain?.trim();
  const hasStrongPrimary =
    Boolean(primary) && primary !== 'general' && isValidLLMDomain(primary!);

  if (!hasStrongPrimary) {
    return {
      enabled: true,
      strongDomainIds: [],
      weakDomainIds: validEnabled,
      queryDomainIds: validEnabled,
    };
  }

  const strongDomainIds = [primary!];
  const weakDomainIds = validEnabled.filter((d) => d !== primary);
  return {
    enabled: true,
    strongDomainIds,
    weakDomainIds,
    queryDomainIds: [...strongDomainIds, ...weakDomainIds],
  };
}
