/**
 * Formula A — repairSelectionCompleteness unit cases (metadata only).
 */
import { describe, expect, it } from '@jest/globals';
import { buildSentenceCandidates, type SpanReplacementPick } from './build-sentence-candidates';
import {
  deriveRepairSelectionCompleteness,
  isCanonicalPick,
  isRepairOptionPick,
} from './derive-repair-selection-completeness';

function makeCanonical(start: number, end: number, text: string): SpanReplacementPick {
  return {
    span: { text, start, end },
    word: text,
    source: 'canonical_exact',
    priorScore: 0,
    repairTarget: false,
    candidateScore: 0,
  };
}

function makeRepair(
  start: number,
  end: number,
  spanText: string,
  word: string,
  score = 1
): SpanReplacementPick {
  return {
    span: { text: spanText, start, end },
    word,
    source: 'base_term',
    priorScore: 1,
    repairTarget: true,
    candidateScore: score,
  };
}

describe('deriveRepairSelectionCompleteness Formula A', () => {
  it('Case 1 — RAW: repairPickCount == 0 even if unrepaired repairable slots exist', () => {
    const spanSets = [
      [makeCanonical(0, 2, '后选'), makeRepair(0, 2, '后选', '候选')],
      [makeCanonical(2, 3, '声')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 2, end: 3 },
    ];
    // Combination chooses only canonicals → RAW
    const combo = [makeCanonical(0, 2, '后选'), makeCanonical(2, 3, '声')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('RAW');
    expect(meta.repairPickCount).toBe(0);
    expect(meta.unrepairedRepairableSlotCount).toBe(1);
  });

  it('Case 2 — COMPLETE_SELECTION: all repairable slots repaired', () => {
    const spanSets = [
      [makeCanonical(0, 2, '后选'), makeRepair(0, 2, '后选', '候选')],
      [makeCanonical(2, 4, '计化'), makeRepair(2, 4, '计化', '计划')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];
    const combo = [makeRepair(0, 2, '后选', '候选'), makeRepair(2, 4, '计化', '计划')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('COMPLETE_SELECTION');
    expect(meta.repairPickCount).toBe(2);
    expect(meta.unrepairedRepairableSlotCount).toBe(0);
  });

  it('Case 3 — PARTIAL_SELECTION: at least one repair + at least one unrepaired repairable', () => {
    const spanSets = [
      [makeCanonical(0, 2, '后选'), makeRepair(0, 2, '后选', '候选')],
      [makeCanonical(2, 4, '计化'), makeRepair(2, 4, '计化', '计划')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];
    const combo = [makeRepair(0, 2, '后选', '候选'), makeCanonical(2, 4, '计化')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('PARTIAL_SELECTION');
    expect(meta.repairPickCount).toBe(1);
    expect(meta.unrepairedRepairableSlotCount).toBe(1);
  });

  it('Case 4 — capability boundary: raw-only 声/城 do not force PARTIAL (候选声城)', () => {
    // 后选 has repair option selected; 声 and 城 are raw-only slots
    const spanSets = [
      [makeCanonical(0, 2, '后选'), makeRepair(0, 2, '后选', '候选')],
      [makeCanonical(2, 3, '声')],
      [makeCanonical(3, 4, '城')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ];
    const combo = [
      makeRepair(0, 2, '后选', '候选'),
      makeCanonical(2, 3, '声'),
      makeCanonical(3, 4, '城'),
    ];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('COMPLETE_SELECTION');
    expect(meta.repairPickCount).toBe(1);
    expect(meta.unrepairedRepairableSlotCount).toBe(0);
  });

  it('Case 5 — Multiple replacements complete: repairPickCount = 2', () => {
    const spanSets = [
      [makeCanonical(0, 2, 'AA'), makeRepair(0, 2, 'AA', 'XX')],
      [makeCanonical(2, 4, 'BB'), makeRepair(2, 4, 'BB', 'YY')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ];
    const combo = [makeRepair(0, 2, 'AA', 'XX'), makeRepair(2, 4, 'BB', 'YY')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta).toEqual({
      repairSelectionCompleteness: 'COMPLETE_SELECTION',
      repairPickCount: 2,
      unrepairedRepairableSlotCount: 0,
    });
  });

  it('Case 6 — Multiple replacement partial: 3 repairable, 2 selected', () => {
    const spanSets = [
      [makeCanonical(0, 1, 'a'), makeRepair(0, 1, 'a', 'A')],
      [makeCanonical(1, 2, 'b'), makeRepair(1, 2, 'b', 'B')],
      [makeCanonical(2, 3, 'c'), makeRepair(2, 3, 'c', 'C')],
    ];
    const ranges = [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ];
    const combo = [
      makeRepair(0, 1, 'a', 'A'),
      makeRepair(1, 2, 'b', 'B'),
      makeCanonical(2, 3, 'c'),
    ];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('PARTIAL_SELECTION');
    expect(meta.repairPickCount).toBe(2);
    expect(meta.unrepairedRepairableSlotCount).toBe(1);
  });

  it('Case 7 — Range identity: same surface, different raw range are distinct slots', () => {
    const spanSets = [
      [makeCanonical(0, 2, '生城'), makeRepair(0, 2, '生城', '生成')],
      [makeCanonical(5, 7, '生城'), makeRepair(5, 7, '生城', '生成')],
    ];
    const ranges = [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ];
    // Only first slot repaired — second unrepaired despite identical surface
    const combo = [makeRepair(0, 2, '生城', '生成'), makeCanonical(5, 7, '生城')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('PARTIAL_SELECTION');
    expect(meta.repairPickCount).toBe(1);
    expect(meta.unrepairedRepairableSlotCount).toBe(1);
  });

  it('one replacement covering multiple slots marks both repaired', () => {
    const spanSets = [
      [makeCanonical(0, 1, 'a'), makeRepair(0, 2, 'ab', 'XY')],
      [makeCanonical(1, 2, 'b'), makeRepair(0, 2, 'ab', 'XY')],
    ];
    const ranges = [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ];
    const combo = [makeRepair(0, 2, 'ab', 'XY')];
    const meta = deriveRepairSelectionCompleteness(spanSets, combo, ranges);
    expect(meta.repairSelectionCompleteness).toBe('COMPLETE_SELECTION');
    expect(meta.repairPickCount).toBe(1);
    expect(meta.unrepairedRepairableSlotCount).toBe(0);
  });

  it('canonical helpers: source or word==span.text', () => {
    expect(isCanonicalPick(makeCanonical(0, 1, 'x'))).toBe(true);
    expect(isCanonicalPick(makeRepair(0, 1, 'x', 'x'))).toBe(true);
    expect(isRepairOptionPick(makeRepair(0, 1, 'x', 'y'))).toBe(true);
  });
});

describe('buildSentenceCandidates attaches Formula A metadata at creation', () => {
  it('attaches COMPLETE_SELECTION for capability-boundary 候选声城 shape', () => {
    const raw = '后选声城';
    const spanSets = [
      [makeCanonical(0, 2, '后选'), makeRepair(0, 2, '后选', '候选', 2)],
      [makeCanonical(2, 3, '声')],
      [makeCanonical(3, 4, '城')],
    ];
    const result = buildSentenceCandidates(raw, spanSets, 16, [
      { start: 0, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ]);
    const repaired = result.combinations.find((c) => c.text === '候选声城');
    expect(repaired).toBeDefined();
    expect(repaired!.repairSelectionCompleteness).toBe('COMPLETE_SELECTION');
    expect(repaired!.repairPickCount).toBe(1);
    expect(repaired!.unrepairedRepairableSlotCount).toBe(0);

    const rawCombo = result.combinations.find((c) => c.text === '后选声城');
    expect(rawCombo).toBeDefined();
    expect(rawCombo!.repairSelectionCompleteness).toBe('RAW');
    expect(rawCombo!.repairPickCount).toBe(0);
  });

  it('adjacent non-overlapping repairs + canonical gap fill remain COMPLETE when all repairable covered', () => {
    const raw = 'abcd';
    const spanSets = [
      [makeCanonical(0, 1, 'a'), makeRepair(0, 1, 'a', 'A', 2)],
      [makeCanonical(2, 3, 'c'), makeRepair(2, 3, 'c', 'C', 2)],
    ];
    const result = buildSentenceCandidates(raw, spanSets, 16, [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
    const both = result.combinations.find(
      (c) => c.repairPickCount === 2 && c.text.includes('A') && c.text.includes('C')
    );
    expect(both).toBeDefined();
    expect(both!.repairSelectionCompleteness).toBe('COMPLETE_SELECTION');
    expect(both!.unrepairedRepairableSlotCount).toBe(0);
  });
});
