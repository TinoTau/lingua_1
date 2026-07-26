/**
 * Soft domain-prior candidate quota (memory-only).
 * Must not alter Vote counts, KenLM scores, or recall SQL membership.
 */

import type { DomainPrior } from '../domain-context-contract';

export type PriorQuotaCandidate = {
  candidateId: string;
  domains?: readonly string[];
  graphSource?: string;
  source?: string;
  score: number;
};

function isBase(c: PriorQuotaCandidate): boolean {
  const src = c.graphSource ?? c.source ?? '';
  return src === 'base_term';
}

function priorWeight(c: PriorQuotaCandidate, priorMap: Map<string, number>): number {
  let sum = 0;
  for (const d of c.domains ?? []) {
    sum += priorMap.get(d) ?? 0;
  }
  return sum;
}

/**
 * Reorder/limit candidates: prior up to 2, guarantee base>=1 and other-domain>=1 when available.
 * Total capped by `limit` (existing per-span budget).
 */
export function applyDomainPriorQuota<T extends PriorQuotaCandidate>(
  candidates: readonly T[],
  domainPriors: readonly DomainPrior[],
  limit: number
): T[] {
  if (limit <= 0) {
    return [];
  }
  if (!candidates.length) {
    return [];
  }
  if (!domainPriors.length) {
    return [...candidates]
      .sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId))
      .slice(0, limit);
  }

  const priorMap = new Map(domainPriors.map((p) => [p.domain, p.weight]));
  const sorted = [...candidates].sort((a, b) => {
    const pw = priorWeight(b, priorMap) - priorWeight(a, priorMap);
    if (pw !== 0) {
      return pw;
    }
    return b.score - a.score || a.candidateId.localeCompare(b.candidateId);
  });

  const priorPicks: T[] = [];
  const basePicks: T[] = [];
  const otherPicks: T[] = [];
  const used = new Set<string>();

  for (const c of sorted) {
    if (priorWeight(c, priorMap) > 0 && priorPicks.length < 2) {
      priorPicks.push(c);
      used.add(c.candidateId);
    }
  }
  for (const c of sorted) {
    if (used.has(c.candidateId)) continue;
    if (isBase(c) && basePicks.length < 1) {
      basePicks.push(c);
      used.add(c.candidateId);
    }
  }
  for (const c of sorted) {
    if (used.has(c.candidateId)) continue;
    if (!isBase(c) && priorWeight(c, priorMap) <= 0 && otherPicks.length < 1) {
      otherPicks.push(c);
      used.add(c.candidateId);
    }
  }

  // Conflict priority: base guarantee > other guarantee > prior fill > rest
  const guaranteed = [...basePicks, ...otherPicks, ...priorPicks];
  const out: T[] = [];
  const outIds = new Set<string>();
  for (const c of guaranteed) {
    if (out.length >= limit) break;
    if (outIds.has(c.candidateId)) continue;
    out.push(c);
    outIds.add(c.candidateId);
  }
  for (const c of sorted) {
    if (out.length >= limit) break;
    if (outIds.has(c.candidateId)) continue;
    out.push(c);
    outIds.add(c.candidateId);
  }
  return out;
}
