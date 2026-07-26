/**
 * FW Repair V4 — Session Domain Prior wire contract (IFC-01 / DCT).
 * Single naming surface; no synonym fields; no free-form metadata.
 */

export const DOMAIN_CONTEXT_VERSION = 'v1' as const;

export const DOMAIN_PRIOR_LIMITS = {
  recentTurns: 4,
  maxDomainPriors: 3,
  maxSecondaryDomains: 2,
  turnWeights: [4, 3, 2, 1] as const,
  llmTopicShiftConfidenceMin: 0.75,
} as const;

export type DomainPrior = {
  domain: string;
  weight: number;
};

export type CurrentTurnDomain = {
  domain: string;
  voteCount: number;
  normalizedScore?: number;
};

export type LlmDomainCalibration = {
  primaryDomain?: string;
  secondaryDomains?: string[];
  confidence: number;
  topicShift: boolean;
  summaryVersion: string;
  updatedAt: number;
};

export type FineSpanSelectionReason =
  | 'complete_in_span'
  | 'complete_cross_boundary'
  | 'fallback_single_step'
  | 'prior_tiebreak'
  | 'shorter_exact_tiebreak'
  | 'stable_tiebreak'
  | 'rejected_cross_gt_1'
  | 'rejected_partial'
  | 'rejected_overlap';

export type FormalWindowSource = 'in_span_window' | 'boundary_window' | 'fallback';

/** Sanitize request priors (missing/null/[] equivalent). Does not map coarse→fine. */
export function sanitizeDomainPriors(raw: unknown): DomainPrior[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: DomainPrior[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const domain = typeof (item as { domain?: unknown }).domain === 'string'
      ? (item as { domain: string }).domain.trim()
      : '';
    const weight = Number((item as { weight?: unknown }).weight);
    if (!domain || !Number.isFinite(weight) || weight <= 0 || weight > 1) {
      continue;
    }
    if (seen.has(domain)) {
      continue;
    }
    seen.add(domain);
    out.push({ domain, weight });
    if (out.length >= DOMAIN_PRIOR_LIMITS.maxDomainPriors) {
      break;
    }
  }
  return canonicalizeDomainPriors(out);
}

export function canonicalizeDomainPriors(priors: readonly DomainPrior[]): DomainPrior[] {
  const sum = priors.reduce((s, p) => s + p.weight, 0);
  const normalized =
    sum > 0
      ? priors.map((p) => ({ domain: p.domain, weight: p.weight / sum }))
      : [...priors];
  return normalized
    .slice()
    .sort((a, b) => b.weight - a.weight || a.domain.localeCompare(b.domain))
    .slice(0, DOMAIN_PRIOR_LIMITS.maxDomainPriors);
}

export function projectCurrentTurnDomains(input: {
  retainedDomains: readonly string[];
  domainScores: Record<string, number>;
  maxCount?: number;
}): { domains: CurrentTurnDomain[]; truncated: boolean } {
  const scores = input.domainScores ?? {};
  const maxCount =
    input.maxCount && input.maxCount > 0
      ? input.maxCount
      : Math.max(0, ...Object.values(scores), 0);

  const ranked = [...input.retainedDomains]
    .filter((d) => d && d !== 'general' && d !== 'base_term')
    .map((domain) => ({
      domain,
      voteCount: scores[domain] ?? 0,
      normalizedScore: maxCount > 0 ? (scores[domain] ?? 0) / maxCount : undefined,
    }))
    .filter((d) => d.voteCount > 0)
    .sort((a, b) => b.voteCount - a.voteCount || a.domain.localeCompare(b.domain));

  const truncated = ranked.length > DOMAIN_PRIOR_LIMITS.maxDomainPriors;
  return {
    domains: ranked.slice(0, DOMAIN_PRIOR_LIMITS.maxDomainPriors),
    truncated,
  };
}
