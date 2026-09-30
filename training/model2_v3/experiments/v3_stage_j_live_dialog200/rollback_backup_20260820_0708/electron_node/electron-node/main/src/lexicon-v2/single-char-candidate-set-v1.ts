/**
 * Bounded length-1 candidate set for SingleCharDisambiguationContractV1.
 * Recall owns set construction. Does not rank / Top1 / dump into Assembly.
 */

import type { HotwordEntry } from '../lexicon/hotword-types';
import {
  SINGLE_CHAR_CANDIDATE_SET_CAP_V1,
  SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
  buildCandidateFeaturesV1,
  sliceSingleCharContextV1,
  type SingleCharCandidateV1,
  type SingleCharDisambiguationRequestV1,
  type SingleCharLexicalSourceV1,
} from '../model2-runtime/single-char-disambiguation-v1';

export const SINGLE_CHAR_CANDIDATE_ORDERING_CONTRACT_V1 = 'term_id ASC, canonical_surface ASC, pinyin ASC, tone_pinyin_key ASC';

function canonicalSurface(word: string): string {
  return (word || '').normalize('NFC');
}

function toneFromKey(tonePinyinKey: string | undefined): number | null {
  const m = String(tonePinyinKey || '').match(/([1-5])$/);
  if (!m) return null;
  return Number(m[1]);
}

export function compareSingleCharSetEntries(a: HotwordEntry, b: HotwordEntry): number {
  const id = String(a.id || '').localeCompare(String(b.id || ''), 'en');
  if (id !== 0) return id;
  const s = canonicalSurface(a.word).localeCompare(canonicalSurface(b.word), 'en');
  if (s !== 0) return s;
  const p = (a.pinyin || []).join('|').localeCompare((b.pinyin || []).join('|'), 'en');
  if (p !== 0) return p;
  return String(a.tonePinyinKey || '').localeCompare(String(b.tonePinyinKey || ''), 'en');
}

export function orderSingleCharEligibleEntries(
  entries: readonly HotwordEntry[],
  cap: number = SINGLE_CHAR_CANDIDATE_SET_CAP_V1
): HotwordEntry[] {
  return [...entries].sort(compareSingleCharSetEntries).slice(0, cap);
}

export function hotwordToSingleCharCandidateV1(
  entry: HotwordEntry,
  index: number,
  count: number,
  span: {
    origin_span_id: string;
    raw_start: number;
    raw_end: number;
    syllable_start: number;
    syllable_end: number;
    lexical_source: SingleCharLexicalSourceV1;
  }
): SingleCharCandidateV1 {
  const surface = entry.word;
  const pinyin = (entry.pinyin && entry.pinyin[0]) || '';
  const tone = toneFromKey(entry.tonePinyinKey);
  return {
    candidate_index: index,
    term_id: String(entry.id),
    surface,
    canonical_surface: canonicalSurface(surface),
    pinyin,
    tone,
    origin_span_id: span.origin_span_id,
    raw_start: span.raw_start,
    raw_end: span.raw_end,
    syllable_start: span.syllable_start,
    syllable_end: span.syllable_end,
    lexical_source: span.lexical_source,
    candidate_features: buildCandidateFeaturesV1(index, count, surface, pinyin, tone),
  };
}

export function buildSingleCharCandidateSetV1(args: {
  eligible: readonly HotwordEntry[];
  truncated: boolean;
  origin_span_id: string;
  raw_start: number;
  raw_end: number;
  syllable_start: number;
  syllable_end: number;
  lexical_source: SingleCharLexicalSourceV1;
}): SingleCharCandidateV1[] {
  if (args.truncated) return [];
  if (args.eligible.length < 2) return [];
  const ordered = orderSingleCharEligibleEntries(args.eligible);
  return ordered.map((e, i) =>
    hotwordToSingleCharCandidateV1(e, i, ordered.length, {
      origin_span_id: args.origin_span_id,
      raw_start: args.raw_start,
      raw_end: args.raw_end,
      syllable_start: args.syllable_start,
      syllable_end: args.syllable_end,
      lexical_source: args.lexical_source,
    })
  );
}

export function buildSingleCharDisambiguationRequestV1(args: {
  request_id: string;
  span_id: string;
  raw_text: string;
  span_surface: string;
  acoustic_pinyin: string;
  acoustic_tone_pinyin_key: string;
  raw_start: number;
  raw_end: number;
  candidates: SingleCharCandidateV1[];
  phonetic_bias?: Record<string, number>;
  long_term_domain_evidence?: Record<string, number>;
}): SingleCharDisambiguationRequestV1 {
  const ctx = sliceSingleCharContextV1(args.raw_text, args.raw_start, args.raw_end);
  return {
    request_id: args.request_id,
    span_id: args.span_id,
    contract: SINGLE_CHAR_DISAMBIGUATION_CONTRACT_V1,
    span_surface: args.span_surface,
    span_canonical_surface: canonicalSurface(args.span_surface),
    acoustic_pinyin: args.acoustic_pinyin,
    acoustic_tone_pinyin_key: args.acoustic_tone_pinyin_key,
    left_context: ctx.left_context,
    right_context: ctx.right_context,
    candidates: args.candidates,
    phonetic_bias: args.phonetic_bias,
    long_term_domain_evidence: args.long_term_domain_evidence,
  };
}
