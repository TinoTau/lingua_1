/**
 * Tone recall scoring — acoustic pattern vs candidate tone_pinyin_key.
 * Timestamp-only alignment lives in tone-time-align.ts.
 */

export const TONE_MATCH_PENALTY = 1.0;
export const TONE_MISMATCH_PENALTY = 0.8;

export type ToneReason = 'match' | 'mismatch' | 'no_pattern';

export interface ToneScoreResult {
  toneCompatible: boolean;
  tonePenalty: number;
  toneReason: ToneReason;
}

import { resolveTonePinyinKey } from '../lexicon-patch-v3/pinyin-resolve';
import type { TonePosterior } from '../task-router/types';

export type { TonePosterior };

const TONE_KEYS: (keyof TonePosterior)[] = ['t1', 't2', 't3', 't4', 't5'];

export function extractToneNumbersFromKey(toneKey: string): number[] {
  if (!toneKey.trim()) {
    return [];
  }
  return toneKey
    .split('|')
    .map((syllable) => {
      const match = syllable.match(/([1-5])$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((tone) => tone >= 1 && tone <= 5);
}

export function argmaxToneFromPosterior(posterior: TonePosterior): number {
  let best = 1;
  let bestVal = posterior.t1;
  for (let i = 1; i < TONE_KEYS.length; i += 1) {
    const val = posterior[TONE_KEYS[i]];
    if (val > bestVal) {
      bestVal = val;
      best = i + 1;
    }
  }
  return best;
}

export function resolveCandidateToneKey(word: string, tonePinyinKey?: string): string {
  return resolveTonePinyinKey(word, { tonePinyinKey });
}

/** Candidate reference tone — hotword.tone_pinyin_key or pinyin-pro on candidate.word only. */
export function isCandidateToneCompatible(
  acousticPattern: number[],
  candidateToneKey: string,
  candidateWord?: string
): boolean {
  let toneKey = candidateToneKey.trim();
  if (!toneKey && candidateWord) {
    toneKey = resolveCandidateToneKey(candidateWord);
  }
  const candidateTones = extractToneNumbersFromKey(toneKey);
  if (!acousticPattern.length || acousticPattern.length !== candidateTones.length) {
    return false;
  }
  for (let i = 0; i < acousticPattern.length; i += 1) {
    if (acousticPattern[i] !== candidateTones[i]) {
      return false;
    }
  }
  return true;
}

/** Recall-layer tone score — ranking signal only; never drops candidates. */
export function computeToneScoreResult(
  acousticPattern: number[] | undefined,
  candidateToneKey: string,
  candidateWord?: string
): ToneScoreResult {
  if (!acousticPattern?.length) {
    return {
      toneCompatible: true,
      tonePenalty: TONE_MATCH_PENALTY,
      toneReason: 'no_pattern',
    };
  }
  const compatible = isCandidateToneCompatible(acousticPattern, candidateToneKey, candidateWord);
  if (compatible) {
    return {
      toneCompatible: true,
      tonePenalty: TONE_MATCH_PENALTY,
      toneReason: 'match',
    };
  }
  return {
    toneCompatible: false,
    tonePenalty: TONE_MISMATCH_PENALTY,
    toneReason: 'mismatch',
  };
}
