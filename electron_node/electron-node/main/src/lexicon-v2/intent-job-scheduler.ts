/**
 * IntentJobScheduler — trigger policy (Final Freeze Spec §4).
 */

import type { SessionObject, ProfileSwitchTrigger } from '../session-runtime/types';
import {
  INTENT_BOOTSTRAP_TURNS,
  INTENT_INTERVAL_MS,
  INTENT_NO_TOPK_RATIO,
  INTENT_NO_TOPK_STREAK_TURNS,
  INTENT_STABLE_INTERVAL_TURNS,
} from '../session-runtime/types';
import { countNoTopkStreak, noTopkSurgeRatio } from '../session-runtime/rolling-context-manager';

export type IntentTriggerReason =
  | { trigger: ProfileSwitchTrigger; detail: string }
  | null;

export function shouldScheduleIntentJob(session: SessionObject, nowMs: number): IntentTriggerReason {
  const n = session.finalizedTurnCount;
  if (n === 0) {
    return null;
  }

  if (n <= INTENT_BOOTSTRAP_TURNS) {
    return { trigger: 'bootstrap', detail: `turn=${n}` };
  }

  if (n % INTENT_STABLE_INTERVAL_TURNS === 0) {
    return { trigger: 'interval_refresh', detail: `turn=${n}` };
  }

  if (nowMs - session.lastIntentAtMs >= INTENT_INTERVAL_MS) {
    return { trigger: 'time_refresh', detail: `elapsed=${nowMs - session.lastIntentAtMs}` };
  }

  const streak = countNoTopkStreak(session.rollingContext);
  const ratio = noTopkSurgeRatio(session.rollingContext, INTENT_NO_TOPK_STREAK_TURNS);
  if (streak >= INTENT_NO_TOPK_STREAK_TURNS && ratio > INTENT_NO_TOPK_RATIO) {
    return { trigger: 'no_topk_surge', detail: `streak=${streak} ratio=${ratio.toFixed(2)}` };
  }

  return null;
}
