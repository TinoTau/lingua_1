/**
 * Aggregation 后与 segment 对齐：保留 CTC n-best 证据，不因 segment 改写而静默销毁多假设。
 */

import { buildAsrHypotheses } from './build-asr-hypotheses';
import type { ASRHypothesis } from './types';
import type { JobContext } from '../pipeline/context/job-context';
import type { AsrNBestItem } from '../task-router/asr-evidence-types';
import logger from '../logger';

export type AggregationHypothesisSyncMeta = {
  segmentSynthetic: boolean;
  ctcNbestPreserved: boolean;
  aggregationResyncReason?: string;
};

function hypothesisRank0Text(hypotheses: ASRHypothesis[] | undefined): string {
  const h = hypotheses?.find((x) => x.rank === 0) ?? hypotheses?.[0];
  return (h?.text ?? '').trim();
}

function nbestTexts(nbest: AsrNBestItem[] | undefined): string[] {
  if (!nbest?.length) {
    return [];
  }
  return nbest.map((item) => item.text.trim()).filter((t) => t.length > 0);
}

function segmentMatchesNbest(segment: string, nbest: AsrNBestItem[] | undefined): boolean {
  return nbestTexts(nbest).includes(segment);
}

function applySyncMeta(ctx: JobContext, meta: AggregationHypothesisSyncMeta): void {
  ctx.segmentSynthetic = meta.segmentSynthetic;
  ctx.ctcNbestPreserved = meta.ctcNbestPreserved;
  ctx.aggregationResyncReason = meta.aggregationResyncReason;
}

/**
 * segment 与 CTC rank0 一致：不改动。
 * 有多条 CTC nbest 且 segment 不一致：保留 CTC hypotheses，仅打标 segmentSynthetic。
 * 无多假设：与旧逻辑一致，单条 synthetic top1。
 */
export function syncAsrHypothesesToSegment(ctx: JobContext, jobId?: string): boolean {
  const segment = (ctx.segmentForJobResult ?? '').trim();
  if (!segment) {
    return false;
  }

  const rank0 = hypothesisRank0Text(ctx.asrHypotheses);
  if (rank0 === segment) {
    applySyncMeta(ctx, {
      segmentSynthetic: false,
      ctcNbestPreserved: (ctx.asrNbest?.length ?? 0) > 1,
    });
    return false;
  }

  const ctcCount = ctx.asrNbest?.length ?? 0;
  if (ctcCount > 1) {
    const decoded = buildAsrHypotheses(rank0 || segment, ctx.asrNbest);
    ctx.asrHypotheses = decoded.hypotheses;
    ctx.nbestSynthetic = decoded.nbestSynthetic;
    applySyncMeta(ctx, {
      segmentSynthetic: !segmentMatchesNbest(segment, ctx.asrNbest),
      ctcNbestPreserved: true,
      aggregationResyncReason: 'segment_mismatch_ctc_preserved',
    });
    logger.info(
      {
        jobId,
        segmentPreview: segment.slice(0, 80),
        previousRank0: rank0.slice(0, 80),
        ctcNbestCount: ctcCount,
        hypothesisCount: ctx.asrHypotheses.length,
        nbestSynthetic: ctx.nbestSynthetic,
      },
      '[AGGREGATION] CTC n-best preserved after segment mismatch'
    );
    return true;
  }

  const decoded = buildAsrHypotheses(segment);
  ctx.asrHypotheses = decoded.hypotheses;
  ctx.nbestSynthetic = decoded.nbestSynthetic;
  applySyncMeta(ctx, {
    segmentSynthetic: true,
    ctcNbestPreserved: false,
    aggregationResyncReason: 'segment_mismatch_no_ctc_nbest',
  });

  logger.info(
    {
      jobId,
      previousTop: rank0.slice(0, 80),
      segmentPreview: segment.slice(0, 80),
      nbestSynthetic: ctx.nbestSynthetic,
    },
    '[AGGREGATION] asrHypotheses resynced to segment (no multi CTC n-best)'
  );
  return true;
}
