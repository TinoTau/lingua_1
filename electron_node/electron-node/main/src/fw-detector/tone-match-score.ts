/**
 * ToneModule — acoustic tone pattern + Recall ranking signal (Tone Score).
 * V2 legacy char-alignment helpers live here for unit tests only.
 * V3 active path uses timestamp-only tone-time-align.ts.
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

/** @deprecated V2-only unit test fixture — not emitted by Phase3 HTTP API. */
export interface V2LegacyToneToken {
  token: string;
  start: number;
  end: number;
  tonePosterior: TonePosterior;
  confidence: number;
}

/** @deprecated V2-only unit test fixture — not emitted by Phase3 HTTP API. */
export interface V2LegacyUtteranceTonePayload {
  toneEnabled: boolean;
  toneTokens: V2LegacyToneToken[];
  toneTokenCount: number;
  toneConfidenceAvg?: number;
  skippedReason?: 'no_audio' | 'no_timestamps' | 'non_zh' | 'model_error';
  alignmentText?: string;
}

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

/** Map toneTokens to rawText character indices (supports multi-char FW word tokens). */
export function alignToneTokensToChars(
  rawText: string,
  toneTokens: V2LegacyToneToken[]
): Map<number, V2LegacyToneToken> {
  const map = new Map<number, V2LegacyToneToken>();
  const sorted = [...toneTokens].sort((a, b) => a.start - b.start);
  let charIdx = 0;

  for (const tok of sorted) {
    const tokenChars = [...tok.token];
    for (const ch of tokenChars) {
      while (charIdx < rawText.length && rawText[charIdx] !== ch) {
        charIdx += 1;
      }
      if (charIdx < rawText.length && rawText[charIdx] === ch) {
        map.set(charIdx, tok);
        charIdx += 1;
      }
    }
  }
  return map;
}

export function mapSpanToToneTokens(
  rawText: string,
  spanStart: number,
  spanEnd: number,
  toneTokens: V2LegacyToneToken[]
): V2LegacyToneToken[] {
  const charMap = alignToneTokensToChars(rawText, toneTokens);
  const result: V2LegacyToneToken[] = [];
  for (let i = spanStart; i < spanEnd; i += 1) {
    const tok = charMap.get(i);
    if (tok) {
      result.push(tok);
    }
  }
  return result;
}

export function resolveCandidateToneKey(word: string, tonePinyinKey?: string): string {
  return resolveTonePinyinKey(word, { tonePinyinKey });
}

export function isAcousticToneEnabled(tone?: V2LegacyUtteranceTonePayload | null): boolean {
  return tone?.toneEnabled === true && (tone.toneTokens?.length ?? 0) > 0;
}

/** @deprecated V2-only — Phase3 API no longer provides alignmentText. */
export function isToneAlignmentValid(
  rawText: string,
  tone?: V2LegacyUtteranceTonePayload | null
): boolean {
  if (!isAcousticToneEnabled(tone)) {
    return false;
  }
  const alignment = tone!.alignmentText?.trim();
  if (!alignment) {
    return false;
  }
  return alignment === rawText.trim();
}

/**
 * Per-char acoustic tone pattern from CNN posteriors (argmax per syllable).
 * Returns null when alignment invalid or span mapping fails.
 */
export function extractAcousticTonePattern(
  rawText: string,
  spanStart: number,
  spanEnd: number,
  tone?: V2LegacyUtteranceTonePayload | null
): number[] | null {
  if (!isToneAlignmentValid(rawText, tone)) {
    return null;
  }
  const spanTokens = mapSpanToToneTokens(rawText, spanStart, spanEnd, tone!.toneTokens);
  const expectedLen = spanEnd - spanStart;
  if (!spanTokens.length || spanTokens.length !== expectedLen) {
    return null;
  }
  return spanTokens.map((t) => argmaxToneFromPosterior(t.tonePosterior));
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
