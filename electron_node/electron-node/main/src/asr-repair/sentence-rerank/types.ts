import type { SentenceCandidate } from '../sentence-expansion/types';
import type { NearTieDiagnostics } from './near-tie-coverage-guardrail';

export type KenLMScore = {
  sentence: string;
  score: number;
  normalizedScore: number;
};

export type KenlmTimingStats = {
  batchMs: number;
  queryCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type KenlmBatchScoreResult = {
  scores: KenLMScore[];
  timing: KenlmTimingStats;
};

export interface KenLMScorer {
  scoreBatch(sentences: string[]): Promise<KenlmBatchScoreResult>;
}

export type RerankWeights = {
  acoustic: number;
  phonetic: number;
  prior: number;
  lm: number;
};

export const DEFAULT_RERANK_WEIGHTS: RerankWeights = {
  acoustic: 0.25,
  phonetic: 0.35,
  prior: 0.15,
  lm: 0.25,
};

export type SentenceRerankResult = {
  candidates: SentenceCandidate[];
  picked: SentenceCandidate;
  nearTieDiagnostics?: NearTieDiagnostics;
  kenlmAvailable: boolean;
  kenlmTiming?: KenlmTimingStats;
  rerankMs?: number;
};
