/** KenLM batch scoring — shared by FW span gate and Recover sentence-rerank legacy */

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
