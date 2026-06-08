/**
 * Phase 3 hotfix — recall tier diagnostics (config or env).
 */

import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';

export type RecallSourceBreakdown = {
  exactBase: number;
  exactDomainStrong: number;
  exactDomainWeak: number;
  fuzzyPlain: number;
  fuzzyPlainDomain: number;
};

export type RecallSpanV2Diagnostics = {
  base_hits: number;
  domain_hits: number;
  idiom_hits: number;
  base_after_limit: number;
  domain_after_limit: number;
  idiom_after_limit: number;
  candidate_count_before_merge: number;
  candidate_count_after_merge: number;
  sent_to_kenlm: number;
  active_domain: string;
  industry_routing_used: boolean;
  v2_recall_ms: number;
  base_lookup_ms: number;
  domain_lookup_ms: number;
  idiom_lookup_ms: number;
  merge_ms: number;
  weakDomainEnabled?: boolean;
  weakDomainIds?: string;
  weakDomainCandidateCount?: number;
  fuzzyRecallEnabled?: boolean;
  fuzzyVariantCount?: number;
  fuzzyCandidateCount?: number;
  candidateSourceBreakdown?: RecallSourceBreakdown;
  recallEmptyBeforeFuzzy?: boolean;
  recallEmptyAfterFuzzy?: boolean;
  domainHitsBeforeWeak?: number;
  domainHitsAfterWeak?: number;
  fuzzyVariantExamples?: string[];
};

export type RecallJobV2Diagnostics = {
  spans: RecallSpanV2Diagnostics[];
  industry_routing_lookup_count: number;
  v2_sql_query_count: number;
  v2_cache_hits: number;
  v2_cache_misses: number;
  kenlm_query_count: number;
};

type DiagnosticsStore = {
  spans: RecallSpanV2Diagnostics[];
  industryRoutingLookupCount: number;
};

let activeStore: DiagnosticsStore | null = null;

export function isRecallV2DiagnosticsEnabled(): boolean {
  if (process.env.LEXICON_RECALL_V2_DIAGNOSTICS === '1') {
    return true;
  }
  return getLexiconRuntimeV2Config().recallDiagnosticsEnabled !== false;
}

export function beginRecallJobDiagnostics(): void {
  if (!isRecallV2DiagnosticsEnabled()) {
    return;
  }
  activeStore = { spans: [], industryRoutingLookupCount: 0 };
}

export function recordRecallSpanDiagnostics(span: RecallSpanV2Diagnostics): void {
  activeStore?.spans.push(span);
}

export function recordIndustryRoutingLookup(): void {
  if (activeStore) {
    activeStore.industryRoutingLookupCount += 1;
  }
}

export function runWithRecallV2Diagnostics<T>(fn: () => T | Promise<T>): T | Promise<T> {
  beginRecallJobDiagnostics();
  return fn();
}

export function flushRecallJobDiagnostics(stats: {
  v2SqlQueryCount: number;
  v2CacheHits: number;
  v2CacheMisses: number;
  kenlmQueryCount: number;
}): RecallJobV2Diagnostics | null {
  if (!activeStore) {
    return null;
  }
  const result: RecallJobV2Diagnostics = {
    spans: activeStore.spans,
    industry_routing_lookup_count: activeStore.industryRoutingLookupCount,
    v2_sql_query_count: stats.v2SqlQueryCount,
    v2_cache_hits: stats.v2CacheHits,
    v2_cache_misses: stats.v2CacheMisses,
    kenlm_query_count: stats.kenlmQueryCount,
  };
  activeStore = null;
  return result;
}
