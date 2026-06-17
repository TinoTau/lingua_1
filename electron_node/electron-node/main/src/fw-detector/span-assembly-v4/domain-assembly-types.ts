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
  coarseSpanId: string;
  rawRange: [number, number];
  syllableRange: [number, number];
  candidates: WindowCandidate[];
};

export type DomainAwareSpanReplacementPick = {
  span: { text: string; start: number; end: number };
  word: string;
  candidateId: string;
  domainId?: string;
  graphSource: DomainAwareGraphSource;
  hitKind: WindowCandidateHitKind;
  score: number;
  repairTarget: boolean;
  recallSource: WindowCandidateSource;
};

export type DomainFilteredSpanSet = {
  coarseSpanId: string;
  rawRange: [number, number];
  syllableRange: [number, number];
  sameDomainCandidates: DomainAwareSpanReplacementPick[];
  baseCandidates: DomainAwareSpanReplacementPick[];
  fallbackCandidates: DomainAwareSpanReplacementPick[];
  selectedCandidates: DomainAwareSpanReplacementPick[];
};

export type DomainAwareAssemblyMetrics = {
  domainCandidateCount: number;
  baseCandidateCount: number;
  sameDomainCandidateCount: number;
  domainFilteredSpanCount: number;
  selectedCandidatesPerSpanAvg: number;
  domainAssemblyMs: number;
  mainDomainAwareSpanSetsTotal: number;
};

export type DomainAwareAssemblyResult = {
  vote: UtteranceDomainVoteResult;
  filteredSets: DomainFilteredSpanSet[];
  spanSets: SpanReplacementPick[][];
  metrics: DomainAwareAssemblyMetrics;
};
