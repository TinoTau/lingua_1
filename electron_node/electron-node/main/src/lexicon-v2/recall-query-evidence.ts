/**
 * Recall-owned Stage2 Query Evidence (ACP V1).
 * Semantic pronunciation/query evidence for utterance-local Stage2 REPLACE mapping.
 * No Model3 imports. No Model2 internals on the evidence type.
 */

export const RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS =
  'MODEL2_CONDITIONED_FIRST_PASS' as const;

export type RecallQueryEvidenceSource = typeof RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS;

/** Frozen semantic evidence — half-open syllable/raw geometry [start, end). */
export type RecallQueryEvidence = {
  pinyinKey: string;
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  source: RecallQueryEvidenceSource;
};

export type RecallQueryEvidenceMappingReason =
  | 'NONE'
  | 'EXACT'
  | 'SUBSPAN'
  | 'RAW_CONFLICT_REJECT'
  | 'UNSUPPORTED_GEOMETRY'
  | 'INVALID_EVIDENCE';

export type Stage2WindowGeometry = {
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
};

export type MapEvidenceToStage2WindowResult = {
  mappedPinyinKey: string | null;
  reason: RecallQueryEvidenceMappingReason;
  querySource: 'ASR' | 'RECALL_QUERY_EVIDENCE';
};

export function evidenceIdentityKey(e: RecallQueryEvidence): string {
  return `${e.syllableStart}|${e.syllableEnd}|${e.pinyinKey}|${e.source}`;
}

export function pinyinKeySyllableCount(pinyinKey: string): number {
  return String(pinyinKey || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/** True iff pinyinKey is 1:1 with half-open syllable span. */
export function isPinyinAlignedWithGeometry(e: Pick<RecallQueryEvidence, 'pinyinKey' | 'syllableStart' | 'syllableEnd'>): boolean {
  const span = e.syllableEnd - e.syllableStart;
  return span > 0 && pinyinKeySyllableCount(e.pinyinKey) === span;
}

/**
 * Insert evidence into utterance-local store with frozen identity dedup.
 * Invalid alignment is rejected (not stored).
 */
export function upsertRecallQueryEvidence(
  store: RecallQueryEvidence[],
  evidence: RecallQueryEvidence
): boolean {
  if (evidence.source !== RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS) return false;
  if (!isPinyinAlignedWithGeometry(evidence)) return false;
  if (evidence.syllableEnd <= evidence.syllableStart) return false;
  if (evidence.rawEnd <= evidence.rawStart) return false;
  const key = evidenceIdentityKey(evidence);
  if (store.some((e) => evidenceIdentityKey(e) === key)) return false;
  store.push({
    pinyinKey: evidence.pinyinKey,
    syllableStart: evidence.syllableStart,
    syllableEnd: evidence.syllableEnd,
    rawStart: evidence.rawStart,
    rawEnd: evidence.rawEnd,
    source: evidence.source,
  });
  return true;
}

type MappingCand = {
  kind: 'EXACT' | 'SUBSPAN';
  mapped: string;
  span: number;
  syllableStart: number;
  syllableEnd: number;
  pinyinKey: string;
  rawConflict: boolean;
};

/**
 * Deterministic EXACT / SUBSPAN mapper. Fail-closed on raw conflict / invalid / unsupported.
 */
export function mapEvidenceToStage2Window(
  evidenceStore: readonly RecallQueryEvidence[],
  window: Stage2WindowGeometry
): MapEvidenceToStage2WindowResult {
  const wS = window.syllableStart;
  const wE = window.syllableEnd;
  if (wE <= wS) {
    return { mappedPinyinKey: null, reason: 'NONE', querySource: 'ASR' };
  }

  const cands: MappingCand[] = [];
  let sawRawConflict = false;
  let sawInvalid = false;
  let sawUnsupported = false;

  for (const e of evidenceStore) {
    if (e.source !== RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS) continue;
    if (!isPinyinAlignedWithGeometry(e)) {
      sawInvalid = true;
      continue;
    }
    const eS = e.syllableStart;
    const eE = e.syllableEnd;
    const parts = e.pinyinKey.split('|').map((s) => s.trim()).filter(Boolean);

    const sylExact = eS === wS && eE === wE;
    const sylContains = eS <= wS && eE >= wE && !sylExact;
    const sylContained = wS <= eS && wE >= eE && !sylExact;
    const sylOverlap =
      eE > wS && wE > eS && !sylExact && !sylContains && !sylContained;

    if (sylContained || sylOverlap) {
      sawUnsupported = true;
      continue;
    }
    if (!sylExact && !sylContains) {
      // DISJOINT
      sawUnsupported = true;
      continue;
    }

    const rawExact = e.rawStart === window.rawStart && e.rawEnd === window.rawEnd;
    const rawContains = e.rawStart <= window.rawStart && e.rawEnd >= window.rawEnd;
    const rawOk = sylExact ? rawExact : rawContains;
    if (!rawOk) {
      sawRawConflict = true;
      continue;
    }

    if (sylExact) {
      cands.push({
        kind: 'EXACT',
        mapped: e.pinyinKey,
        span: eE - eS,
        syllableStart: eS,
        syllableEnd: eE,
        pinyinKey: e.pinyinKey,
        rawConflict: false,
      });
      continue;
    }

    const mapped = parts.slice(wS - eS, wE - eS).join('|');
    if (pinyinKeySyllableCount(mapped) !== wE - wS) {
      sawInvalid = true;
      continue;
    }
    cands.push({
      kind: 'SUBSPAN',
      mapped,
      span: eE - eS,
      syllableStart: eS,
      syllableEnd: eE,
      pinyinKey: e.pinyinKey,
      rawConflict: false,
    });
  }

  if (cands.length === 0) {
    if (sawRawConflict && !sawUnsupported && !sawInvalid) {
      return { mappedPinyinKey: null, reason: 'RAW_CONFLICT_REJECT', querySource: 'ASR' };
    }
    if (sawInvalid && !sawUnsupported && !sawRawConflict) {
      return { mappedPinyinKey: null, reason: 'INVALID_EVIDENCE', querySource: 'ASR' };
    }
    if (evidenceStore.length === 0) {
      return { mappedPinyinKey: null, reason: 'NONE', querySource: 'ASR' };
    }
    return { mappedPinyinKey: null, reason: 'UNSUPPORTED_GEOMETRY', querySource: 'ASR' };
  }

  cands.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'EXACT' ? -1 : 1;
    if (a.span !== b.span) return a.span - b.span;
    if (a.syllableStart !== b.syllableStart) return a.syllableStart - b.syllableStart;
    if (a.syllableEnd !== b.syllableEnd) return a.syllableEnd - b.syllableEnd;
    return a.pinyinKey < b.pinyinKey ? -1 : a.pinyinKey > b.pinyinKey ? 1 : 0;
  });

  const winner = cands[0]!;
  return {
    mappedPinyinKey: winner.mapped,
    reason: winner.kind,
    querySource: 'RECALL_QUERY_EVIDENCE',
  };
}
