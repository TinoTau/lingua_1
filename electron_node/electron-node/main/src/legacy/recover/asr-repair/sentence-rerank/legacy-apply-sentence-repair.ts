/**
 * @deprecated Legacy Recover-only module.
 * Not part of FW frozen main chain.
 */

import { JobContext } from '../../../../pipeline/context/job-context';
import type { SentenceCandidate } from '../sentence-expansion/types';

/** @deprecated Legacy Recover-only. Not used by FW frozen main chain. */
export function applyLegacySentenceRepair(ctx: JobContext, picked: SentenceCandidate): void {
  const baseline = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  ctx.segmentForJobResult = picked.text;
  ctx.sentenceRepairDecision = picked;
  ctx.asrRepairApplied = picked.text !== baseline;
}
