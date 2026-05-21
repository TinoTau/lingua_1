/**
 * Window expansion → KenLM rerank → applySentenceRepair (Recover V3 historical-restore).
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import {
  getLexiconRecallSkipReason,
  isLexiconRecallEnabled,
  isLexiconRecallLanguage,
} from '../../node-config';
import { filterRerankEligibleCandidates, isRerankEligible } from '../../asr-repair/candidate-source';
import { expandSentenceCandidates } from '../../asr-repair/sentence-expansion/sentence-expansion';
import { computeRestoreMetrics } from '../../asr-repair/restore-metrics';
import { applySentenceRepair } from '../../asr-repair/sentence-rerank/apply-sentence-repair';
import { rerankSentenceCandidates } from '../../asr-repair/sentence-rerank/rerank';
import { buildSentenceRepairExtra } from '../../asr-repair/sentence-rerank/sentence-repair-observability';
import logger from '../../logger';

export const REPAIR_SKIP_NO_HYPOTHESES = 'no_hypotheses';
export const REPAIR_SKIP_NO_WINDOW_EXPANSION = 'no_window_expansion_candidate';

function markSentenceRepairSkipped(ctx: JobContext, skipReason: string): void {
  ctx.recoverLifecycleSkipReason = skipReason;
  ctx.recoverSkipped = true;
  ctx.repairSkipReason = skipReason;
  ctx.restoreMetrics = computeRestoreMetrics([]);
  ctx.recoverLifecycle = {
    executed: true,
    gated: false,
    skipped: true,
    skipReason,
  };
}

export async function runSentenceRepairStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const skipReason = getLexiconRecallSkipReason(job, ctx);
  if (skipReason || !isLexiconRecallEnabled(job) || !isLexiconRecallLanguage(job, ctx)) {
    return;
  }

  const hypotheses = ctx.asrHypotheses;
  const windowCandidates = ctx.windowCandidates ?? [];
  if (!hypotheses?.length) {
    markSentenceRepairSkipped(ctx, REPAIR_SKIP_NO_HYPOTHESES);
    logger.info({ jobId: job.job_id }, `[SENTENCE_REPAIR] skipped reason=${REPAIR_SKIP_NO_HYPOTHESES}`);
    return;
  }

  const segmentText = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  const expanded = expandSentenceCandidates({
    segmentText,
    hypotheses,
    windowCandidates,
  });
  ctx.sentenceCandidates = expanded.candidates;
  ctx.expansionDiagnostics = expanded.diagnostics;

  const rerankPool = filterRerankEligibleCandidates(expanded.candidates);
  if (!rerankPool.length) {
    markSentenceRepairSkipped(ctx, REPAIR_SKIP_NO_WINDOW_EXPANSION);
    logger.info(
      {
        jobId: job.job_id,
        windowCandidateCount: windowCandidates.length,
        expandedCount: expanded.candidates.length,
        expansionFunnel: expanded.diagnostics.expansionFunnel,
      },
      `[SENTENCE_REPAIR] skipped reason=${REPAIR_SKIP_NO_WINDOW_EXPANSION}`
    );
    return;
  }

  const baselineText = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  const rerank = await rerankSentenceCandidates(rerankPool);
  ctx.sentenceCandidates = rerank.candidates;

  if (!isRerankEligible(rerank.picked)) {
    markSentenceRepairSkipped(ctx, REPAIR_SKIP_NO_WINDOW_EXPANSION);
    logger.error(
      { jobId: job.job_id, candidateSource: rerank.picked.candidateSource },
      '[SENTENCE_REPAIR] picked candidate is not window expansion (contract violation)'
    );
    return;
  }

  applySentenceRepair(ctx, rerank.picked);
  ctx.recoverSkipped = false;
  ctx.repairSkipReason = null;
  ctx.restoreMetrics = computeRestoreMetrics(expanded.candidates, rerank.picked);
  ctx.sentenceRepairExtra = buildSentenceRepairExtra({
    ctx,
    rerank,
    baselineText,
    executed: true,
    hypotheses: ctx.asrHypotheses,
    restoreMetrics: ctx.restoreMetrics,
  });
  ctx.recoverLifecycle = {
    executed: true,
    gated: false,
    skipped: false,
    skipReason: null,
  };

  logger.info(
    {
      jobId: job.job_id,
      kenlmAvailable: rerank.kenlmAvailable,
      candidateCount: rerank.candidates.length,
      candidateSource: rerank.picked.candidateSource,
      pickedHypothesisIndex: rerank.picked.hypothesisIndex,
      replacementCount: rerank.picked.replacements.length,
      modified: ctx.sentenceRepairExtra?.modified,
      restoreMetrics: ctx.restoreMetrics,
      kenlmBatchMs: rerank.kenlmTiming?.batchMs,
      rerankMs: rerank.rerankMs,
    },
    `[SENTENCE_REPAIR] picked source=${rerank.picked.candidateSource} hypothesis=${rerank.picked.hypothesisIndex} replacements=${rerank.picked.replacements.length}`
  );
}
