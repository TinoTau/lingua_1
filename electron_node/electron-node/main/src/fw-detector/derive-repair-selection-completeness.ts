/**
 * Formula A — Slot Coverage (metadata only).
 * Sole Owner: Sentence Assembly / buildSentenceCandidates.
 * Pure · deterministic · no CrossPath/KenLM recompute.
 */
import type { SpanReplacementPick } from './build-sentence-candidates';

export type RepairSelectionCompleteness =
  | 'RAW'
  | 'PARTIAL_SELECTION'
  | 'COMPLETE_SELECTION';

export type RepairSelectionCompletenessMeta = {
  repairSelectionCompleteness: RepairSelectionCompleteness;
  repairPickCount: number;
  unrepairedRepairableSlotCount: number;
};

/** Test / fixture default when constructing empty SentenceCombination objects. */
export const RAW_REPAIR_SELECTION_META: RepairSelectionCompletenessMeta = {
  repairSelectionCompleteness: 'RAW',
  repairPickCount: 0,
  unrepairedRepairableSlotCount: 0,
};

export type SlotRange = {
  start: number;
  end: number;
};

/** Canonical / raw-preserved pick (Formula A). */
export function isCanonicalPick(pick: SpanReplacementPick): boolean {
  return pick.source === 'canonical_exact' || pick.word === pick.span.text;
}

/** Non-canonical repair option (Formula A). */
export function isRepairOptionPick(pick: SpanReplacementPick): boolean {
  return !isCanonicalPick(pick);
}

function pickCoversSlot(pick: SpanReplacementPick, slot: SlotRange): boolean {
  return pick.span.start < slot.end && pick.span.end > slot.start;
}

/**
 * Derive repairSelectionCompleteness from Assembly-local spanSets + combination replacements.
 * Slot identity = slotRanges[i] char range aligned with spanSets[i].
 */
export function deriveRepairSelectionCompleteness(
  spanSets: readonly (readonly SpanReplacementPick[])[],
  combinationReplacements: readonly SpanReplacementPick[],
  slotRanges: readonly SlotRange[]
): RepairSelectionCompletenessMeta {
  const repairPicks = combinationReplacements.filter(isRepairOptionPick);
  const repairPickCount = repairPicks.length;

  let unrepairedRepairableSlotCount = 0;
  const n = Math.min(spanSets.length, slotRanges.length);
  for (let i = 0; i < n; i += 1) {
    const slot = spanSets[i]!;
    const range = slotRanges[i]!;
    if (range.start >= range.end) {
      continue;
    }
    const repairable = slot.some(isRepairOptionPick);
    if (!repairable) {
      // Raw-only slot — must not increment unrepairedRepairableSlotCount
      continue;
    }
    const repaired = repairPicks.some((pick) => pickCoversSlot(pick, range));
    if (!repaired) {
      unrepairedRepairableSlotCount += 1;
    }
  }

  let repairSelectionCompleteness: RepairSelectionCompleteness;
  if (repairPickCount === 0) {
    repairSelectionCompleteness = 'RAW';
  } else if (unrepairedRepairableSlotCount === 0) {
    repairSelectionCompleteness = 'COMPLETE_SELECTION';
  } else {
    repairSelectionCompleteness = 'PARTIAL_SELECTION';
  }

  return {
    repairSelectionCompleteness,
    repairPickCount,
    unrepairedRepairableSlotCount,
  };
}
