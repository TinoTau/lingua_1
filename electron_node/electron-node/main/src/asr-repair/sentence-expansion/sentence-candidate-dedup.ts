import type { SentenceCandidate } from './types';

/** Q1.6-05：按 text + replacement spans + source 去重，禁止仅按 candidateText。 */
export function sentenceCandidateDedupKey(candidate: SentenceCandidate): string {
  const spans = [...candidate.replacements]
    .map((r) => `${r.start}:${r.end}:${r.from}\t${r.to}`)
    .sort()
    .join('|');
  return `${candidate.candidateSource}\0${candidate.text}\0${spans}`;
}
