/**
 * 聚合收尾：门控 + hypothesis 与 segment 对齐（单一入口，避免散落调用）。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { syncAsrHypothesesToSegment } from '../asr/sync-asr-hypotheses-to-segment';
import { JobContext } from './context/job-context';
import {
  applyPostAggregationRouting,
  type PostAggregationRoutingInput,
} from './post-asr-routing';

export function completeAggregation(
  job: JobAssignMessage,
  ctx: JobContext,
  input: PostAggregationRoutingInput
): void {
  applyPostAggregationRouting(job, ctx, input);
  syncAsrHypothesesToSegment(ctx, job.job_id);
}
