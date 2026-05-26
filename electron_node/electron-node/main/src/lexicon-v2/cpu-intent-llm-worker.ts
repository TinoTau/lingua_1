/**
 * CPU Intent LLM Worker — workerCount=1, maxQueueSize=1, latestOnly (Final Freeze Spec §4).
 */

import logger from '../logger';
import type { RollingTurn } from '../session-runtime/types';
import { inferLexiconProfileDecision } from './cpu-llm-model-runner';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';
import { intentInferenceResult, type IntentInferenceResult } from './intent-outcome';
import { isIntentRecoveryInProgress } from './intent-recovery';
import {
  recordIntentJobFinished,
  recordIntentQueueDepth,
  recordPendingJobReplaced,
} from './intent-runtime-metrics';

export const WORKER_TIMEOUT_MS = 8000;

type PendingJob = {
  sessionId: string;
  turns: RollingTurn[];
  currentPrimary: string;
  finalizedTurnCount: number;
  enqueuedAt: number;
  resolve: (v: IntentInferenceResult) => void;
};

/** At most one running + one pending (latest-only). */
let runningJob: PendingJob | null = null;
let pendingJob: PendingJob | null = null;

function currentQueueDepth(): number {
  let depth = 0;
  if (runningJob) {
    depth += 1;
  }
  if (pendingJob) {
    depth += 1;
  }
  return depth;
}

function syncQueueMetrics(): void {
  recordIntentQueueDepth(currentQueueDepth(), runningJob != null);
}

function drainQueue(): void {
  if (runningJob || !pendingJob) {
    syncQueueMetrics();
    return;
  }
  const job = pendingJob;
  pendingJob = null;
  syncQueueMetrics();
  runJob(job);
}

function runJob(job: PendingJob): void {
  runningJob = job;
  syncQueueMetrics();
  const maxSummary = getLexiconV2CpuWorkerConfig().maxSummaryChars ?? 300;

  const timer = setTimeout(() => {
    logger.warn({ sessionId: job.sessionId }, '[LexiconIntentWorker] timeout, keep current profile');
    finishJob(job, intentInferenceResult('inference_timeout'));
  }, WORKER_TIMEOUT_MS);

  inferLexiconProfileDecision({
    sessionId: job.sessionId,
    turns: job.turns,
    currentPrimary: job.currentPrimary,
    finalizedTurnCount: job.finalizedTurnCount,
  })
    .then((result) => {
      clearTimeout(timer);
      if (result.decision && result.decision.summary.length > maxSummary) {
        result.decision.summary = result.decision.summary.slice(0, maxSummary);
      }
      finishJob(job, result);
    })
    .catch((err) => {
      clearTimeout(timer);
      logger.error({ sessionId: job.sessionId, err: String(err) }, '[LexiconIntentWorker] failed');
      finishJob(job, intentInferenceResult('error'));
    });
}

function finishJob(job: PendingJob, result: IntentInferenceResult): void {
  const latencyMs = Date.now() - job.enqueuedAt;
  recordIntentJobFinished(result.outcome, latencyMs);
  job.resolve(result);
  if (runningJob === job) {
    runningJob = null;
  }
  syncQueueMetrics();
  drainQueue();
}

export function enqueueIntentJob(input: {
  sessionId: string;
  turns: RollingTurn[];
  currentPrimary: string;
  finalizedTurnCount: number;
}): Promise<IntentInferenceResult> {
  if (isIntentRecoveryInProgress()) {
    return Promise.resolve(intentInferenceResult('service_unreachable'));
  }

  return new Promise((resolve) => {
    const job: PendingJob = { ...input, enqueuedAt: Date.now(), resolve };

    if (pendingJob) {
      recordPendingJobReplaced();
      logger.debug(
        {
          replacedSessionId: pendingJob.sessionId,
          newSessionId: job.sessionId,
        },
        '[LexiconIntentWorker] latest-only replace pending job'
      );
      pendingJob.resolve(intentInferenceResult('skipped_by_debounce'));
    }
    pendingJob = job;
    syncQueueMetrics();
    drainQueue();
  });
}

/** Test-only */
export function resetIntentWorker(): void {
  pendingJob = null;
  runningJob = null;
  syncQueueMetrics();
}
