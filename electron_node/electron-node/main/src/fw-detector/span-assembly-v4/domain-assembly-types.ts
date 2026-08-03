import type { WindowCandidateSource } from '../../lexicon/window-candidate-source';
import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { GraphEdgeSource } from '../span-assembly-shared/types';
import type { UtteranceDomainVoteResult } from '../span-assembly-shared/utterance-domain-vote';
import type { WindowCandidate, WindowCandidateHitKind } from './v4-types';

export type DomainAwareGraphSource = Extract<
  GraphEdgeSource,
  'domain_term' | 'base_term' | 'passive_domain_weak'
>;

export type FineSpanCandidatePool = {
  /** PathFineSpan id. Primary pool key. */
  fineSpanId: string;
  /** @deprecated coarse metadata only — not pool identity */
  coarseSpanId: string;
  coarseSpanIds?: readonly string[];
  rawRange: [number, number];
  syllableRange: [number, number];
  candidates: WindowCandidate[];
  windowSource?: string;
};

export type DomainAwareSpanReplacementPick = {
  span: { text: string; start: number; end: number };
  word: string;
  candidateId: string;
  /** Membership for sameDomain filter only — stripped before SpanReplacementPick. */
  domains?: readonly string[];
  graphSource: DomainAwareGraphSource;
  hitKind: WindowCandidateHitKind;
  score: number;
  repairTarget: boolean;
  recallSource: WindowCandidateSource;
};

export type DomainAssemblyDropTrace = {
  candidateId: string;
  replacement: string;
  hitKind?: string;
  source?: string;
  domains?: readonly string[];
  dropReason: string;
  fineSpanId?: string;
  bucketDomain?: string | null;
};

export type DomainFilteredSpanSet = {
  fineSpanId?: string;
  coarseSpanId: string;
  rawRange: [number, number];
  syllableRange: [number, number];
  sameDomainCandidates: DomainAwareSpanReplacementPick[];
  baseCandidates: DomainAwareSpanReplacementPick[];
  fallbackCandidates: DomainAwareSpanReplacementPick[];
  /**
   * Budgeted multi-candidate set for Assembly (not a per-span final winner).
   * Produced by selectPerSpanCandidates / budgetPerSpanCandidates.
   */
  selectedCandidates: DomainAwareSpanReplacementPick[];
  bucketDomain?: string | null;
  /** Eligibility drops for this span within the current bucket filter. */
  assemblyDropTraces?: DomainAssemblyDropTrace[];
};

export type DomainAwareAssemblyMetrics = {
  domainCandidateCount: number;
  baseCandidateCount: number;
  sameDomainCandidateCount: number;
  domainFilteredSpanCount: number;
  selectedCandidatesPerSpanAvg: number;
  domainAssemblyMs: number;
  mainDomainAwareSpanSetsTotal: number;
  retainedBucketCount: number;
};

export type DomainAwareAssemblyResult = {
  vote: UtteranceDomainVoteResult;
  filteredSets: DomainFilteredSpanSet[];
  /** Primary / first retained bucket span sets (fwSpans / diagnostics). */
  spanSets: SpanReplacementPick[][];
  /** One span-set grid per retained domain bucket (or single base-only grid). */
  bucketSpanSets: SpanReplacementPick[][][];
  metrics: DomainAwareAssemblyMetrics;
};
