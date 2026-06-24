import type {
  DomainFilteredSpanSet,
  ToneGuardBlockTrace,
} from './domain-assembly-types';

export type ToneAssemblyGuardResult = {
  filteredSets: DomainFilteredSpanSet[];
  blockTraces: ToneGuardBlockTrace[];
  blockedCount: number;
};

function spanHasSameDomainToneMatch(set: DomainFilteredSpanSet): boolean {
  return set.sameDomainCandidates.some((pick) => pick.toneReason === 'match');
}

export function applyToneAssemblyGuard(filteredSets: DomainFilteredSpanSet[]): ToneAssemblyGuardResult {
  const blockTraces: ToneGuardBlockTrace[] = [];
  let blockedCount = 0;

  const guarded = filteredSets.map((set) => {
    if (!spanHasSameDomainToneMatch(set)) {
      return set;
    }

    const keptBase = set.baseCandidates.filter((pick) => {
      if (pick.toneReason !== 'mismatch') {
        return true;
      }
      blockedCount += 1;
      blockTraces.push({
        spanId: set.coarseSpanId,
        candidateId: pick.candidateId,
        word: pick.word,
        blockedBy: 'ToneGuard',
        reason: 'sameDomainToneExactExists',
        toneMatch: false,
      });
      return false;
    });

    return {
      ...set,
      baseCandidates: keptBase,
    };
  });

  return {
    filteredSets: guarded,
    blockTraces,
    blockedCount,
  };
}
