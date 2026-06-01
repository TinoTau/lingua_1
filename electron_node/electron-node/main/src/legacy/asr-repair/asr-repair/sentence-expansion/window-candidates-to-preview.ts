import type { WindowPhoneticPreviewItem } from '../../../../lexicon/phonetic/types';
import type { WindowCandidate } from '../../../../lexicon/hotword-types';

/** Window recall 产出 → selector 输入（单一路径，无第二套组合逻辑）。 */
export function windowCandidatesToPreview(
  candidates: WindowCandidate[]
): WindowPhoneticPreviewItem[] {
  return candidates.map((c) => ({
    spanText: c.from,
    spanStart: c.start,
    spanEnd: c.end,
    candidateText: c.to,
    candidateSource: c.source,
    phoneticScore: c.phoneticScore,
  }));
}
