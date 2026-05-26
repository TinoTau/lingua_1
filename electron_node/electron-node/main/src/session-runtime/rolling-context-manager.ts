/**
 * RollingContextManager — finalized turns only (Final Freeze Spec §2.2).
 */

import type { RollingTurn } from './types';
import { MAX_ROLLING_TURNS } from './types';

export function appendRollingTurn(
  context: RollingTurn[],
  turn: RollingTurn
): RollingTurn[] {
  const next = [...context, turn];
  if (next.length <= MAX_ROLLING_TURNS) {
    return next;
  }
  return next.slice(next.length - MAX_ROLLING_TURNS);
}

export function countNoTopkStreak(context: RollingTurn[]): number {
  let streak = 0;
  for (let i = context.length - 1; i >= 0; i--) {
    const t = context[i];
    const hadTopk = t.recoverStats.noTopkCandidate === 0 && Boolean(t.recoverStats.pickedSource);
    const noTopk = t.recoverStats.noTopkCandidate > 0 && !t.recoverStats.pickedSource;
    if (noTopk || (!hadTopk && t.recoverStats.noTopkCandidate > 0)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function noTopkSurgeRatio(context: RollingTurn[], windowSize: number): number {
  const slice = context.slice(-windowSize);
  if (!slice.length) {
    return 0;
  }
  const noTopk = slice.filter(
    (t) => t.recoverStats.noTopkCandidate > 0 && !t.recoverStats.pickedSource
  ).length;
  return noTopk / slice.length;
}
