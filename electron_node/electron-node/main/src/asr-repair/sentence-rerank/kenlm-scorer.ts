import { getLmScorer } from '../../phonetic-correction/lm-scorer';
import type { KenLMScore, KenLMScorer, KenlmTimingStats } from '../kenlm-batch-types';

function normalizeLmScore(score: number): number {
  return 1 / (1 + Math.exp(-score / 10));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function buildKenlmTiming(perQueryMs: number[]): KenlmTimingStats {
  const sorted = [...perQueryMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    batchMs: sum,
    queryCount: sorted.length,
    avgMs: sorted.length ? sum / sorted.length : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

export function createKenlmBatchScorer(): KenLMScorer | null {
  const scorer = getLmScorer();
  if (!scorer) {
    return null;
  }

  return {
    async scoreBatch(sentences: string[]) {
      const scores: KenLMScore[] = [];
      const perQueryMs: number[] = [];
      for (const sentence of sentences) {
        const t0 = Date.now();
        const { score } = await scorer.score(sentence);
        perQueryMs.push(Date.now() - t0);
        scores.push({
          sentence,
          score,
          normalizedScore: normalizeLmScore(score),
        });
      }
      return { scores, timing: buildKenlmTiming(perQueryMs) };
    },
  };
}
