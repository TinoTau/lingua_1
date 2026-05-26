/**
 * Collect patch proposals from jobs with no TopK hit (Final Freeze Spec §8).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JobAssignMessage } from '@shared/protocols/messages';
import type { JobContext } from '../../pipeline/context/job-context';
import { buildPatchProposal } from './patch-proposal';

const proposals: import('./patch-proposal').LexiconPatchProposal[] = [];

export function collectReplayPatchProposal(job: JobAssignMessage, ctx: JobContext): void {
  const topk = ctx.v5Metrics?.lexicon_pinyin_topk_candidate_count ?? 0;
  if (topk > 0) {
    return;
  }
  const rawAsr = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  if (!rawAsr) {
    return;
  }
  const windowText = ctx.windowRecallDiagnostics?.noWindowBucket ?? rawAsr.slice(0, 8);
  const profile = ctx.activeProfilePrimary ?? 'general';
  proposals.push(
    buildPatchProposal({
      caseId: job.job_id,
      rawAsr,
      repairedText: (ctx.repairedText ?? rawAsr).trim(),
      windowText: typeof windowText === 'string' ? windowText : rawAsr.slice(0, 8),
      suggestedDomain: profile,
      reason: 'no_topk_candidate',
      evidence: [`session=${job.session_id}`],
    })
  );
}

export function flushPatchProposalsToFile(outDir: string): number {
  if (!proposals.length) {
    return 0;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `patch-proposals-${Date.now()}.jsonl`);
  const body = proposals.map((p) => JSON.stringify(p)).join('\n') + '\n';
  fs.writeFileSync(file, body, 'utf-8');
  const n = proposals.length;
  proposals.length = 0;
  return n;
}

export function getPendingPatchCount(): number {
  return proposals.length;
}

/** Test-only */
export function clearPatchProposals(): void {
  proposals.length = 0;
}
