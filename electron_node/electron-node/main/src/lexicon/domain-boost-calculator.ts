/**
 * DomainBoost — Final Freeze Spec §3.
 */

import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

export const DOMAIN_BASE = 0.12;
export const DOMAIN_BOOST_MAX = 0.2;
export const PRIMARY_WEIGHT = 1.0;
export const SECONDARY_WEIGHT = 0.5;
export const GENERAL_WEIGHT = 0.0;

export function profileWeight(
  snapshot: ActiveLexiconProfileSnapshot,
  domainId: string
): number {
  if (domainId === 'general') {
    return GENERAL_WEIGHT;
  }
  if (domainId === snapshot.primaryDomain) {
    return PRIMARY_WEIGHT;
  }
  if (snapshot.secondaryDomains.includes(domainId)) {
    return SECONDARY_WEIGHT;
  }
  const boosted = snapshot.boosts[domainId];
  if (boosted !== undefined && boosted > 1.0) {
    return SECONDARY_WEIGHT;
  }
  return GENERAL_WEIGHT;
}

export function computeDomainBoost(
  snapshot: ActiveLexiconProfileSnapshot,
  hotwordDomains: readonly string[]
): number {
  if (!hotwordDomains.length) {
    return 0;
  }
  let maxBoost = 0;
  for (const d of hotwordDomains) {
    const w = profileWeight(snapshot, d);
    const raw = w * DOMAIN_BASE;
    const clamped = Math.min(DOMAIN_BOOST_MAX, Math.max(0, raw));
    if (clamped > maxBoost) {
      maxBoost = clamped;
    }
  }
  return maxBoost;
}
