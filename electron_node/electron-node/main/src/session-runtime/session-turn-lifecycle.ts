/**
 * Turn lifecycle helpers — single place for turn id + finalize gate (Final Freeze Spec).
 */

import type { JobAssignMessage } from '@shared/protocols/messages';

type TurnJob = JobAssignMessage & {
  turn_id?: string;
  is_manual_cut?: boolean;
  is_timeout_triggered?: boolean;
};

export function resolveTurnId(job: JobAssignMessage): string {
  const turnId = (job as TurnJob).turn_id?.trim();
  return turnId || job.job_id;
}

/** RollingContext / Intent 仅在 turn 结束时写入。 */
export function isFinalizedTurnJob(job: JobAssignMessage): boolean {
  const j = job as TurnJob;
  return Boolean(j.is_manual_cut || j.is_timeout_triggered);
}
