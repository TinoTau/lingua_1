import { JobContext } from '../../../../pipeline/context/job-context';
import type { SentenceCandidate } from '../sentence-expansion/types';

/**
 * Recover v1 — sole final write authority for ASR text repair.
 */
export function applySentenceRepair(ctx: JobContext, picked: SentenceCandidate): void {
  const baseline = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  ctx.segmentForJobResult = picked.text;
  ctx.sentenceRepairDecision = picked;
  ctx.asrRepairApplied = picked.text !== baseline;
}
