/**
 * Batch 1.1C — Mandatory Tone Recall readiness (Fail Closed).
 * Single SSOT for whether Tone Recall may run. Does not query DB or build Candidates.
 */

import { buildTonePinyinKeyFromSyllablesAndPattern } from '../lexicon/phonetic/tone-pinyin';

export type ToneRecallSkipReason =
  | 'no_pattern'
  | 'invalid_pattern'
  | 'caller_disabled'
  | 'runtime_unsupported';

export type ToneRecallReadiness =
  | { state: 'ready'; tonePinyinKey: string }
  | { state: ToneRecallSkipReason };

export type ResolveToneRecallReadinessInput = {
  syllables: readonly string[];
  runtimeSupportsTone: boolean;
  acousticTonePattern?: readonly number[];
  /**
   * When false, caller closed the tone channel (e.g. toneTimestampOnlyEnabled=false
   * or no acoustic payload gate). When undefined, treat as enabled and decide from pattern.
   */
  toneCallerEnabled?: boolean;
};

/**
 * Sole authoritative Tone Recall readiness resolver (CR 1.0.8 / Batch 1.1C).
 * Order: caller_disabled → runtime_unsupported → no_pattern → invalid_pattern → ready.
 */
export function resolveToneRecallReadiness(
  input: ResolveToneRecallReadinessInput
): ToneRecallReadiness {
  if (input.toneCallerEnabled === false) {
    return { state: 'caller_disabled' };
  }
  if (!input.runtimeSupportsTone) {
    return { state: 'runtime_unsupported' };
  }
  const pattern = input.acousticTonePattern;
  if (!pattern?.length) {
    return { state: 'no_pattern' };
  }
  const syllables = [...input.syllables];
  const patternSlice = pattern.slice(0, syllables.length);
  const tonePinyinKey = buildTonePinyinKeyFromSyllablesAndPattern(syllables, [
    ...patternSlice,
  ]);
  if (tonePinyinKey == null) {
    return { state: 'invalid_pattern' };
  }
  return { state: 'ready', tonePinyinKey };
}

export function toneRecallSkipDiagnosticCode(
  state: ToneRecallSkipReason
): `tone_${ToneRecallSkipReason}` {
  return `tone_${state}`;
}
