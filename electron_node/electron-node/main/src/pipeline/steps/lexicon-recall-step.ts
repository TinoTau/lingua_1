/**
 * Window hotword recall — produces WindowCandidate[] only (no writeback).
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import {
  getLexiconRecallSkipReason,
  isLexiconRecallEnabled,
  isLexiconRecallLanguage,
} from '../../node-config';
import { getLexiconRuntime, ensureLexiconRuntimeLoaded } from '../../lexicon/lexicon-runtime-holder';
import { markLexiconDisabled } from '../../lexicon/lexicon-runtime';
import { recallSegmentWindowCandidates } from '../../lexicon/window-recall';
import { buildAsrHypotheses } from '../../asr/build-asr-hypotheses';
import { buildSegmentAlignmentDiagnostics } from '../../asr/segment-alignment-diagnostics';
import { buildCrossBoundaryRiskReport } from '../../asr/cross-boundary-risk';
import { buildRecallCoverageDiagnostics } from '../../lexicon/recall-coverage-diagnostics';
import logger from '../../logger';

export async function runLexiconRecallStep(
  job: JobAssignMessage,
  ctx: JobContext,
  _services: ServicesBundle
): Promise<void> {
  const skipReason = getLexiconRecallSkipReason(job, ctx);
  if (skipReason) {
    const disabled = markLexiconDisabled();
    ctx.lexiconRuntimeStatus = disabled.status;
    ctx.lexiconDisabledReason = skipReason;
    logger.info(
      { jobId: job.job_id, enabled: false, reason: skipReason },
      `[LEXICON_RECALL] enabled=false reason=${skipReason}`
    );
    return;
  }

  if (!isLexiconRecallEnabled(job)) {
    const disabled = markLexiconDisabled();
    ctx.lexiconRuntimeStatus = disabled.status;
    ctx.lexiconDisabledReason = 'feature_or_job_disabled';
    logger.info({ jobId: job.job_id }, '[LEXICON_RECALL] enabled=false');
    return;
  }

  if (!isLexiconRecallLanguage(job, ctx)) {
    ctx.lexiconRuntimeStatus = 'disabled';
    ctx.lexiconDisabledReason = 'unsupported_source_language';
    logger.info({ jobId: job.job_id }, '[LEXICON_RECALL] enabled=true runtime=disabled reason=language');
    return;
  }

  const segmentText = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  if (!segmentText) {
    ctx.lexiconRuntimeStatus = 'disabled';
    ctx.lexiconDisabledReason = 'empty_segment';
    logger.info({ jobId: job.job_id }, '[LEXICON_RECALL] enabled=true runtime=disabled reason=empty_segment');
    return;
  }

  if (!ctx.asrHypotheses?.length) {
    const decoded = buildAsrHypotheses(segmentText, ctx.asrNbest);
    ctx.asrHypotheses = decoded.hypotheses;
    ctx.nbestSynthetic = decoded.nbestSynthetic;
  }

  const recallText = (ctx.asrHypotheses[0]?.text ?? '').trim();
  ctx.segmentAlignmentDiagnostics = buildSegmentAlignmentDiagnostics(segmentText, recallText);
  if (recallText !== segmentText) {
    logger.warn(
      {
        jobId: job.job_id,
        segmentPreview: segmentText.slice(0, 80),
        hypothesisPreview: recallText.slice(0, 80),
      },
      '[LEXICON_RECALL] segment/hypothesis mismatch after aggregation sync'
    );
  }

  const runtimeState = ensureLexiconRuntimeLoaded();
  ctx.lexiconRuntimeStatus = runtimeState.status;
  ctx.lexiconManifestVersion = runtimeState.manifestVersion;
  if (runtimeState.errorMessage) {
    ctx.lexiconRuntimeError = runtimeState.errorMessage;
  }

  if (runtimeState.status !== 'ok') {
    logger.info(
      {
        jobId: job.job_id,
        enabled: true,
        runtime: runtimeState.status,
        error: runtimeState.errorMessage,
      },
      `[LEXICON_RECALL] enabled=true runtime=${runtimeState.status} error=${runtimeState.errorMessage ?? 'n/a'}`
    );
    return;
  }

  const runtime = getLexiconRuntime();
  ctx.crossBoundaryRiskReport = buildCrossBoundaryRiskReport(
    segmentText,
    runtime.getConfusionObservedStrings()
  );

  const { candidates, truncated, windowCount, diagnostics } = recallSegmentWindowCandidates(
    segmentText,
    ctx.asrHypotheses,
    runtime
  );
  ctx.windowCandidates = candidates;
  ctx.lexiconRecallTruncated = truncated;
  ctx.windowRecallDiagnostics = diagnostics;
  ctx.recallCoverageDiagnostics =
    candidates.length === 0
      ? buildRecallCoverageDiagnostics(segmentText, runtime, diagnostics)
      : null;

  logger.info(
    {
      jobId: job.job_id,
      enabled: true,
      runtime: 'ok',
      pinyin_index_size: runtime.getPinyinIndexSize(),
      hypothesis_count: ctx.asrHypotheses.length,
      segment_text: segmentText.slice(0, 120),
      recall_hypothesis_text: recallText.slice(0, 120),
      nbest_synthetic: ctx.nbestSynthetic,
      window_count: windowCount,
      window_candidate_count: candidates.length,
      window_recall_diagnostics: diagnostics,
      truncated,
      manifestVersion: runtimeState.manifestVersion,
    },
    `[LEXICON_RECALL] segment-first hypotheses=${ctx.asrHypotheses.length} window_candidates=${candidates.length} synthetic=${ctx.nbestSynthetic}`
  );
}
