import { PRIOR_SCORE_SCALE } from './constants.mjs';

export function frequencyFromPriority(priority) {
  const p = Number(priority) || 5;
  if (p >= 10) return 100;
  if (p >= 5) return 50;
  return 10;
}

export function priorScoreFromFrequency(frequency) {
  return Math.min(Math.log1p(Math.max(1, frequency)) / PRIOR_SCORE_SCALE, 1.0);
}

export function normalizePriorScore(raw, frequency) {
  if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
    const value = Number(raw);
    if (value > 1 && value <= PRIOR_SCORE_SCALE * 2) {
      return Math.min(value / PRIOR_SCORE_SCALE, 1.0);
    }
    return value;
  }
  return priorScoreFromFrequency(frequency);
}

export function isValidPriorScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function percentile(sorted, p) {
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function priorScoreDistribution(scores) {
  if (!scores.length) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return {
    min,
    max,
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

export function priorHistogram(scores, bucketSize = 0.1) {
  const buckets = {};
  for (const s of scores) {
    const key = (Math.floor(s / bucketSize) * bucketSize).toFixed(1);
    buckets[key] = (buckets[key] ?? 0) + 1;
  }
  return buckets;
}
