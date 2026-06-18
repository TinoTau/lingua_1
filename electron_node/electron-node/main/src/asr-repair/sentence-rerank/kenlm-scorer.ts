import {
  isKenlmSubprocessRunnable,
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  runKenlmQueryBatch,
} from '../../phonetic-correction/lm-scorer';
import { tokenizeForLm } from '../../phonetic-correction/char-tokenize';
import { loadFwDetectorRuntimeConfig } from '../../fw-detector/fw-config';
import logger from '../../logger';
import type {
  KenLMScore,
  KenLMScorer,
  KenlmBatchScoreResult,
  KenlmSubprocessRuntimeDiag,
  KenlmTimingStats,
} from '../kenlm-batch-types';

function normalizeLmScore(score: number): number {
  return 1 / (1 + Math.exp(-score / 10));
}

function buildBatchWallKenlmTiming(batchMs: number, queryCount: number): KenlmTimingStats {
  const avgMs = queryCount ? batchMs / queryCount : 0;
  return {
    batchMs,
    queryCount,
    avgMs,
    p50Ms: avgMs,
    p95Ms: avgMs,
    maxMs: batchMs,
  };
}

type TokenizedRow = {
  sentence: string;
  tokenized: string;
};

function tokenizeRows(sentences: string[]): TokenizedRow[] {
  return sentences.map((sentence) => ({
    sentence,
    tokenized: tokenizeForLm(sentence),
  }));
}

function mapLmResultsToScores(rows: TokenizedRow[], lmResults: Array<{ score: number }>): KenLMScore[] {
  let lmIndex = 0;
  return rows.map((row) => {
    if (!row.tokenized) {
      return { sentence: row.sentence, score: 0, normalizedScore: normalizeLmScore(0) };
    }
    const { score } = lmResults[lmIndex++];
    return { sentence: row.sentence, score, normalizedScore: normalizeLmScore(score) };
  });
}

function buildRuntimeDiag(
  queryCount: number,
  subprocessMs: number,
  subprocessCount: number,
  errorReason?: string
): KenlmSubprocessRuntimeDiag {
  return {
    kenlmQueryCount: queryCount,
    kenlmSubprocessMs: subprocessMs,
    kenlmSubprocessCount: subprocessCount,
    ...(errorReason ? { kenlmSubprocessErrorReason: errorReason } : {}),
  };
}

/** Split non-empty tokenized stdin lines into chunks of at most maxLines. */
function splitNonEmptyTokenLines(rows: TokenizedRow[], maxLines: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    if (!row.tokenized) {
      continue;
    }
    current.push(row.tokenized);
    if (current.length >= maxLines) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function scoreAllZero(rows: TokenizedRow[], errorReason: string): KenlmBatchScoreResult {
  const scores = rows.map((row) => ({
    sentence: row.sentence,
    score: 0,
    normalizedScore: normalizeLmScore(0),
  }));
  return {
    scores,
    timing: buildBatchWallKenlmTiming(0, rows.length),
    runtime: buildRuntimeDiag(rows.length, 0, 0, errorReason),
  };
}

function allEmptyTokenResult(rows: TokenizedRow[]): KenlmBatchScoreResult {
  const scores = rows.map((row) => ({
    sentence: row.sentence,
    score: 0,
    normalizedScore: normalizeLmScore(0),
  }));
  return {
    scores,
    timing: buildBatchWallKenlmTiming(0, rows.length),
    runtime: buildRuntimeDiag(rows.length, 0, 0),
  };
}

async function runBatchChunks(
  rows: TokenizedRow[],
  modelPath: string,
  queryPath: string,
  timeoutMs: number,
  maxLines: number
): Promise<KenlmBatchScoreResult | { errorReason: string }> {
  const chunks = splitNonEmptyTokenLines(rows, maxLines);
  const lmResults: Array<{ score: number }> = [];
  let totalWallMs = 0;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const batchResult = await runKenlmQueryBatch(modelPath, queryPath, chunks[chunkIndex], timeoutMs);
    if (!batchResult.ok) {
      logger.warn('[kenlm] batch subprocess failed, fail-open', {
        reason: batchResult.reason,
        sentenceCount: rows.length,
        chunkIndex,
        chunkCount: chunks.length,
      });
      return { errorReason: batchResult.reason };
    }
    lmResults.push(...batchResult.results);
    totalWallMs += batchResult.wallMs;
  }

  return {
    scores: mapLmResultsToScores(rows, lmResults),
    timing: buildBatchWallKenlmTiming(totalWallMs, rows.length),
    runtime: buildRuntimeDiag(rows.length, totalWallMs, chunks.length),
  };
}

async function scoreBatchInternal(sentences: string[]): Promise<KenlmBatchScoreResult> {
  const cfg = loadFwDetectorRuntimeConfig();
  const rows = tokenizeRows(sentences);

  if (rows.length === 0) {
    return {
      scores: [],
      timing: buildBatchWallKenlmTiming(0, 0),
      runtime: buildRuntimeDiag(0, 0, 0),
    };
  }

  const nonEmptyCount = rows.filter((r) => r.tokenized).length;
  if (nonEmptyCount === 0) {
    return allEmptyTokenResult(rows);
  }

  const modelPath = resolveCharLmModelPath();
  if (!modelPath) {
    return scoreAllZero(rows, 'model_missing');
  }

  const queryPath = resolveKenlmQueryPath();
  if (!isKenlmSubprocessRunnable(modelPath, queryPath)) {
    return scoreAllZero(rows, 'subprocess_unavailable');
  }

  const outcome = await runBatchChunks(
    rows,
    modelPath,
    queryPath,
    cfg.kenlmSubprocessTimeoutMs,
    cfg.kenlmSubprocessMaxLines
  );

  if ('errorReason' in outcome) {
    return scoreAllZero(rows, outcome.errorReason);
  }

  return outcome;
}

export function createKenlmBatchScorer(): KenLMScorer | null {
  if (!resolveCharLmModelPath()) {
    return null;
  }

  return {
    async scoreBatch(sentences: string[]) {
      return scoreBatchInternal(sentences);
    },
  };
}
