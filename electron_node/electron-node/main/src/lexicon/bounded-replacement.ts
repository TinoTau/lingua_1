import { pickBestEvidence } from './evidence-compare';
import { scorePinyinSimilarity, textToSyllables } from './phonetic/pinyin';
import type { BoundedReplacement, LexiconRecallEvidence } from './lexicon-types';

export type BuildBoundedReplacementsOptions = {
  minPhoneticScore: number;
};

function groupKey(ev: LexiconRecallEvidence): string {
  return `${ev.windowId}\0${ev.replacement}`;
}

/**
 * Merge evidences by windowId + replacement → bounded candidates (ASR span owns from/start/end).
 */
export function buildBoundedReplacements(
  evidences: LexiconRecallEvidence[],
  options: BuildBoundedReplacementsOptions
): BoundedReplacement[] {
  const grouped = new Map<string, LexiconRecallEvidence[]>();

  for (const ev of evidences) {
    const key = groupKey(ev);
    const bucket = grouped.get(key) ?? [];
    bucket.push(ev);
    grouped.set(key, bucket);
  }

  const out: BoundedReplacement[] = [];

  for (const group of grouped.values()) {
    const best = pickBestEvidence(group);
    const phoneticScore = scorePinyinSimilarity(
      best.windowPinyin,
      textToSyllables(best.replacement)
    );

    if (phoneticScore < options.minPhoneticScore) {
      continue;
    }

    out.push({
      windowId: best.windowId,
      from: best.windowText,
      to: best.replacement,
      start: best.windowStart,
      end: best.windowEnd,
      evidences: group,
      bestEvidence: best,
      phoneticScore,
      priority: best.priority,
      source: best.source,
    });
  }

  return out;
}
