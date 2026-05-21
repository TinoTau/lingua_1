import { selectActiveUtteranceTextWindowBased } from './windowSelector';
import type { WindowPhoneticPreviewItem } from '../phonetic/types';

function previewItem(
  originalText: string,
  from: string,
  to: string,
  phoneticScore: number,
  start?: number
): WindowPhoneticPreviewItem {
  const idx = start ?? originalText.indexOf(from);
  return {
    spanText: from,
    spanStart: idx,
    spanEnd: idx + from.length,
    candidateText: to,
    candidateSource: 'window_phonetic_preview',
    phoneticScore,
  };
}

describe('selectActiveUtteranceTextWindowBased', () => {
  const dualText = '今天我们讨论后选生城和上线计化流程安排';

  it('applies two non-overlapping replacements via per-window select-one', () => {
    const decision = selectActiveUtteranceTextWindowBased({
      originalText: dualText,
      preview: [
        previewItem(dualText, '后选生城', '候选生成', 1),
        previewItem(dualText, '上线计化', '上线计划', 0.95),
      ],
      maxReplacements: 2,
    });
    expect(decision.applied).toBe(true);
    expect(decision.selectedReason).toBe('multi_window_candidates_selected');
    expect(decision.selectedCandidates).toHaveLength(2);
    expect(decision.selectedText).toBe('今天我们讨论候选生成和上线计划流程安排');
    expect(decision.windows?.length).toBe(2);
  });

  it('picks only one when windows overlap', () => {
    const text = '后选生城上线';
    const decision = selectActiveUtteranceTextWindowBased({
      originalText: text,
      preview: [
        previewItem(text, '后选生城', '候选生成', 1, 0),
        previewItem(text, '选生城上', '选生城', 0.9, 1),
      ],
      maxReplacements: 2,
    });
    expect(decision.applied).toBe(true);
    expect(decision.selectedCandidates).toHaveLength(1);
    expect(decision.selectedReason).toBe('phonetic_candidate_selected');
  });

  it('uses single-select path when maxReplacements is 1', () => {
    const originalText = '我们要做后选生城';
    const decision = selectActiveUtteranceTextWindowBased({
      originalText,
      preview: [previewItem(originalText, '后选生城', '候选生成', 1)],
      maxReplacements: 1,
    });
    expect(decision.applied).toBe(true);
    expect(decision.selectedReason).toBe('phonetic_candidate_selected');
    expect(decision.selectedCandidates).toHaveLength(1);
    expect(decision.selectedText).toBe('我们要做候选生成');
  });

  it('rejects writeback when score below threshold', () => {
    const originalText = '我们要做后选生城';
    const decision = selectActiveUtteranceTextWindowBased({
      originalText,
      preview: [previewItem(originalText, '后选生城', '候选生成', 0.7)],
      maxReplacements: 2,
    });
    expect(decision.applied).toBe(false);
    expect(decision.selectedReason).toBe('score_below_threshold');
    expect(decision.windows?.[0].rejectedReason).toBe('score_below_threshold');
  });
});
