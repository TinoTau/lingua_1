/**
 * FW Repair V4 — LTR FineSpan Generator (Development Plan §6.1 / Constraint Addendum ICST-05).
 *
 * Single production FineSpan entry (ICST-01): cursor moves strictly left-to-right over the
 * utterance-global syllable coordinate, generates temporary overlapping 2..5-syllable options
 * at the current cursor (plus a 1-syllable fallback marker), and commits exactly one
 * non-overlapping FormalFineSpan per cursor position. No Beam, no DP, no full-sentence path
 * search (Development Plan §2.1 / §17).
 *
 * Coordinate SSOT (DCT-01): syllableStart/syllableEnd is the canonical boundary-decision
 * coordinate (cursor advance, overlap assertion). rawStart/rawEnd is trace/tone-mapping only.
 */

import {
  buildUtteranceSyllableCoordinate,
  type CharSyllableRange,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { DomainPrior, FineSpanSelectionReason, FormalWindowSource } from '../domain-context-contract';
import {
  collectDistinctCoarseSpanIds,
  resolveAnchorCoarseSpanId,
} from './collect-distinct-coarse-span-ids';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor, WindowCandidate } from './v4-types';

/**
 * K1 (Constraint Addendum DCN-01). `multi_unit_concat` is reserved by contract but never
 * produced in this version: detecting concatenation of two shorter lexicon units inside one
 * window would require sub-window decomposition search, which is exactly the Beam/DP surface
 * this development explicitly forbids (Development Plan §2.1, §6.1 "第一版不实现 one-step
 * lookahead"). Recall only reports whole-window `exact_term` / `parent_fragment` hits, so this
 * option is intentionally unreachable until a dedicated non-search decomposition rule ships.
 */
export type LexicalCompleteness = 'complete_single_term' | 'multi_unit_concat' | 'partial_fragment' | 'none';

/**
 * K2. Base ranks already encode the documented exception: `boundary_cross_complete` (1) beats
 * `in_span_single_char_fallback` (3) without any special-case branch, because both are ranked
 * below `in_span_complete` (0) and above nothing lower than `in_span_fallback` (2).
 */
export type BoundaryClass =
  | 'in_span_complete'
  | 'boundary_cross_complete'
  | 'in_span_fallback'
  | 'in_span_single_char_fallback';

const LEXICAL_RANK: Record<LexicalCompleteness, number> = {
  complete_single_term: 0,
  multi_unit_concat: 1,
  partial_fragment: 2,
  none: 3,
};

const BOUNDARY_RANK: Record<BoundaryClass, number> = {
  in_span_complete: 0,
  boundary_cross_complete: 1,
  in_span_fallback: 2,
  in_span_single_char_fallback: 3,
};

/** Temporary FineSpan option (Data Contract §5.5): GlobalWindowDescriptor + evaluation reason fields only. */
export type LtrFineSpanOption = GlobalWindowDescriptor & {
  lexicalCompleteness: LexicalCompleteness;
  boundaryClass: BoundaryClass;
  candidates: WindowCandidate[];
  priorMatchedDomains: string[];
  priorWeight: number;
};

/** Formal FineSpan (Data Contract §5.4). */
export type FormalFineSpan = {
  spanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  coarseSpanIds: string[];
  boundaryCrossCount: 0 | 1;
  windowSource: FormalWindowSource;
  candidates: WindowCandidate[];
  selectionReason: FineSpanSelectionReason;
  /** Diagnostics only — set by rebindToneAfterFormalCommit after Formal commit. */
  toneCommitTrace?: {
    optionRawStart: number;
    optionRawEnd: number;
    formalRawStart: number;
    formalRawEnd: number;
    finalToneRawStart: number;
    finalToneRawEnd: number;
    recomputedAfterCommit: true;
    acousticTonePattern: number[] | null;
  };
};

export type LtrFineSpanOptionTrace = {
  windowId: string;
  start: number;
  end: number;
  boundaryCrossCount: number;
  source: GlobalWindowDescriptor['windowSource'] | 'ineligible';
  lexicalCompleteness: LexicalCompleteness;
  candidateCount: number;
  priorMatchedDomains: string[];
  decision: 'selected' | 'rejected';
  rejectedReason?: 'rejected_cross_gt_1' | 'rejected_partial';
};

export type LtrFineSpanStepTrace = {
  cursor: number;
  options: LtrFineSpanOptionTrace[];
  selectedSpan: { start: number; end: number; reason: FineSpanSelectionReason; spanId: string };
  rankingBeforePrior: string[];
  rankingAfterPrior: string[];
  priorChangedWinner: boolean;
};

export type LtrFineSpanTrace = {
  steps: LtrFineSpanStepTrace[];
  formalOverlapCount: number;
};

export type LtrFineSpanGenerationResult = {
  formalSpans: FormalFineSpan[];
  trace: LtrFineSpanTrace;
};

type CharSyllableRanges = CharSyllableRange[];

function buildWindowAt(
  cursor: number,
  len: number,
  rawText: string,
  globalSyllables: string[],
  coarseSpans: CoarseSpan[],
  ranges: CharSyllableRanges
): GlobalWindowDescriptor | null {
  const syllableEnd = cursor + len;
  if (syllableEnd > globalSyllables.length) {
    return null;
  }
  const spanIds = collectDistinctCoarseSpanIds(cursor, syllableEnd, coarseSpans);
  if (!spanIds.length) {
    return null;
  }
  const boundaryCrossCount = spanIds.length - 1;
  const charRange = syllableRangeToRawCharRange(ranges, cursor, syllableEnd);
  if (!charRange) {
    return null;
  }
  const syllables = globalSyllables.slice(cursor, syllableEnd);
  const blocked = boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount;

  return {
    windowId: `${cursor}:${syllableEnd}`,
    syllableStart: cursor,
    syllableEnd,
    rawStart: charRange.start,
    rawEnd: charRange.end,
    windowText: rawText.slice(charRange.start, charRange.end),
    windowPinyinKey: syllables.join('|'),
    spanIds,
    boundaryCrossCount,
    windowSource: blocked ? 'blocked' : boundaryCrossCount === 1 ? 'boundary_window' : 'in_span_window',
    anchorCoarseSpanId: resolveAnchorCoarseSpanId(spanIds, coarseSpans),
    blocked,
    blockedBoundaryReason: blocked ? 'boundary_cross_count' : undefined,
  };
}

/**
 * Phase A — generate local 2..5-syllable temporary options anchored exactly at `cursor`.
 * Options crossing more than one coarse boundary are included (temporary options may overlap
 * and blocked options are still visible for diagnostics) but flagged `blocked`/`windowSource:
 * 'blocked'`; they never reach commit (Constraint Addendum ICST-05).
 */
export function generateLocalOptionsAtCursor(input: {
  cursor: number;
  rawText: string;
  globalSyllables: string[];
  coarseSpans: CoarseSpan[];
  /** Utterance-level FineSpan ranges SSOT — build once per utterance. */
  charSyllableRanges?: readonly CharSyllableRange[];
}): GlobalWindowDescriptor[] {
  const ranges = input.charSyllableRanges
    ? input.charSyllableRanges.map((r) => ({ ...r }))
    : buildUtteranceSyllableCoordinate(input.rawText).ranges;
  const windows: GlobalWindowDescriptor[] = [];
  const maxLen = Math.min(V4_LIMITS.windowMaxSyllables, input.globalSyllables.length - input.cursor);
  for (let len = V4_LIMITS.windowMinSyllables; len <= maxLen; len += 1) {
    const w = buildWindowAt(input.cursor, len, input.rawText, input.globalSyllables, input.coarseSpans, ranges);
    if (w) {
      windows.push(w);
    }
  }
  return windows;
}

/** Alias kept for Development Plan naming ("Phase A: buildLtrOptionWindows"). */
export const buildLtrOptionWindows = generateLocalOptionsAtCursor;

function buildFallbackOption(
  cursor: number,
  rawText: string,
  globalSyllables: string[],
  coarseSpans: CoarseSpan[],
  charSyllableRanges: readonly CharSyllableRange[]
): GlobalWindowDescriptor {
  const ranges = charSyllableRanges.map((r) => ({ ...r }));
  const w = buildWindowAt(cursor, 1, rawText, globalSyllables, coarseSpans, ranges);
  if (!w) {
    throw new Error(`[LTR_FINE_SPAN] unable to build fallback option at cursor=${cursor}`);
  }
  return w;
}

function classifyLexicalCompleteness(candidates: WindowCandidate[]): LexicalCompleteness {
  if (candidates.some((c) => c.hitKind === 'exact_term')) {
    return 'complete_single_term';
  }
  if (candidates.some((c) => c.hitKind === 'parent_fragment')) {
    return 'partial_fragment';
  }
  return 'none';
}

/**
 * K2. Returns 'ineligible' when a cross-boundary option fails to form a complete lexical unit
 * (Development Plan §6.1 constraint #11: "跨界option只有形成有效完整词时才可胜出").
 */
function classifyBoundaryClass(
  syllableLength: number,
  boundaryCrossCount: number,
  lexicalCompleteness: LexicalCompleteness
): BoundaryClass | 'ineligible' {
  const isComplete = lexicalCompleteness === 'complete_single_term' || lexicalCompleteness === 'multi_unit_concat';
  if (isComplete) {
    return boundaryCrossCount === 0 ? 'in_span_complete' : 'boundary_cross_complete';
  }
  if (boundaryCrossCount >= 1) {
    return 'ineligible';
  }
  return syllableLength === 1 ? 'in_span_single_char_fallback' : 'in_span_fallback';
}

function computePriorMatch(
  candidates: WindowCandidate[],
  domainPriors: readonly DomainPrior[]
): { matchedDomains: string[]; weight: number } {
  if (!domainPriors.length || !candidates.length) {
    return { matchedDomains: [], weight: 0 };
  }
  const priorMap = new Map(domainPriors.map((p) => [p.domain, p.weight]));
  const matched = new Set<string>();
  let weight = 0;
  for (const c of candidates) {
    for (const d of c.domains ?? []) {
      if (priorMap.has(d) && !matched.has(d)) {
        matched.add(d);
        weight += priorMap.get(d) as number;
      }
    }
  }
  return { matchedDomains: [...matched].sort(), weight };
}

function spanLen(o: LtrFineSpanOption): number {
  return o.syllableEnd - o.syllableStart;
}

function rankEqual(a: LtrFineSpanOption, b: LtrFineSpanOption): boolean {
  return (
    LEXICAL_RANK[a.lexicalCompleteness] === LEXICAL_RANK[b.lexicalCompleteness] &&
    BOUNDARY_RANK[a.boundaryClass] === BOUNDARY_RANK[b.boundaryClass]
  );
}

/** Decision precedence (Constraint Addendum DCN-01): K1 > K2 > K3 (prior) > K4 (length) > K5 (stable). */
function compareOptions(a: LtrFineSpanOption, b: LtrFineSpanOption, ignorePrior = false): number {
  const k1 = LEXICAL_RANK[a.lexicalCompleteness] - LEXICAL_RANK[b.lexicalCompleteness];
  if (k1 !== 0) return k1;
  const k2 = BOUNDARY_RANK[a.boundaryClass] - BOUNDARY_RANK[b.boundaryClass];
  if (k2 !== 0) return k2;
  if (!ignorePrior) {
    const k3 = b.priorWeight - a.priorWeight;
    if (k3 !== 0) return k3;
  }
  const k4 = spanLen(a) - spanLen(b);
  if (k4 !== 0) return k4;
  if (a.rawEnd !== b.rawEnd) return a.rawEnd - b.rawEnd;
  if (a.rawStart !== b.rawStart) return a.rawStart - b.rawStart;
  return a.windowId.localeCompare(b.windowId);
}

function determineSelectionReason(
  winner: LtrFineSpanOption,
  runnerUp: LtrFineSpanOption | undefined,
  priorChangedWinner: boolean
): FineSpanSelectionReason {
  if (priorChangedWinner) {
    return 'prior_tiebreak';
  }
  if (runnerUp && rankEqual(winner, runnerUp)) {
    return spanLen(winner) !== spanLen(runnerUp) ? 'shorter_exact_tiebreak' : 'stable_tiebreak';
  }
  if (winner.boundaryClass === 'in_span_complete') {
    return 'complete_in_span';
  }
  if (winner.boundaryClass === 'boundary_cross_complete') {
    return 'complete_cross_boundary';
  }
  return 'fallback_single_step';
}

/**
 * DCT-03: any winner with zero lexical evidence (`lexicalCompleteness === 'none'`, i.e. no
 * exact_term/parent_fragment candidate at all — whether it is the 1-syllable marker or a longer
 * no-hit in-span window) is reported as `windowSource: 'fallback'` with `candidates: []`, so
 * downstream never mistakes an evidence-free commit for a real lexicon hit.
 */
function resolveFormalWindowSource(option: LtrFineSpanOption): FormalWindowSource {
  if (option.lexicalCompleteness === 'none') {
    return 'fallback';
  }
  return option.windowSource === 'boundary_window' ? 'boundary_window' : 'in_span_window';
}

/**
 * Phase B — evaluate options generated at `cursor` (plus the mandatory 1-syllable fallback
 * marker) and commit exactly one FormalFineSpan.
 *
 * `candidatesByWindowId` must already carry recall results computed specifically for each
 * windowId's own coordinates (never a rejected/different window's tone-aligned data — this is
 * what satisfies the "tone must use the final committed range" constraint, because each
 * FormalFineSpan only ever consumes candidates keyed by its own windowId).
 */
export function commitBestFormalFineSpan(input: {
  cursor: number;
  rawText: string;
  globalSyllables: string[];
  coarseSpans: CoarseSpan[];
  rawOptions: GlobalWindowDescriptor[];
  candidatesByWindowId: ReadonlyMap<string, WindowCandidate[]>;
  domainPriors: readonly DomainPrior[];
  charSyllableRanges?: readonly CharSyllableRange[];
}): { formalSpan: FormalFineSpan; stepTrace: LtrFineSpanStepTrace } {
  const { cursor, rawOptions, candidatesByWindowId, domainPriors } = input;
  const optionTraces: LtrFineSpanOptionTrace[] = [];
  const eligible: LtrFineSpanOption[] = [];
  const charSyllableRanges =
    input.charSyllableRanges ?? buildUtteranceSyllableCoordinate(input.rawText).ranges;

  for (const raw of rawOptions) {
    if (raw.blocked || raw.boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount) {
      optionTraces.push({
        windowId: raw.windowId,
        start: raw.syllableStart,
        end: raw.syllableEnd,
        boundaryCrossCount: raw.boundaryCrossCount,
        source: 'blocked',
        lexicalCompleteness: 'none',
        candidateCount: 0,
        priorMatchedDomains: [],
        decision: 'rejected',
        rejectedReason: 'rejected_cross_gt_1',
      });
      continue;
    }

    const candidates = candidatesByWindowId.get(raw.windowId) ?? [];
    const lexicalCompleteness = classifyLexicalCompleteness(candidates);
    const boundaryClass = classifyBoundaryClass(
      raw.syllableEnd - raw.syllableStart,
      raw.boundaryCrossCount,
      lexicalCompleteness
    );
    const { matchedDomains, weight } = computePriorMatch(candidates, domainPriors);

    if (boundaryClass === 'ineligible') {
      optionTraces.push({
        windowId: raw.windowId,
        start: raw.syllableStart,
        end: raw.syllableEnd,
        boundaryCrossCount: raw.boundaryCrossCount,
        source: 'ineligible',
        lexicalCompleteness,
        candidateCount: candidates.length,
        priorMatchedDomains: matchedDomains,
        decision: 'rejected',
        rejectedReason: 'rejected_partial',
      });
      continue;
    }

    eligible.push({
      ...raw,
      lexicalCompleteness,
      boundaryClass,
      candidates,
      priorMatchedDomains: matchedDomains,
      priorWeight: weight,
    });
  }

  // Mandatory fallback marker (K2 worst rank) — guarantees cursor progress even with zero recall hits.
  const fallbackRaw = buildFallbackOption(
    cursor,
    input.rawText,
    input.globalSyllables,
    input.coarseSpans,
    charSyllableRanges
  );
  eligible.push({
    ...fallbackRaw,
    lexicalCompleteness: 'none',
    boundaryClass: 'in_span_single_char_fallback',
    candidates: [],
    priorMatchedDomains: [],
    priorWeight: 0,
  });

  const sortedWithPrior = [...eligible].sort((a, b) => compareOptions(a, b, false));
  const sortedWithoutPrior = [...eligible].sort((a, b) => compareOptions(a, b, true));
  const winner = sortedWithPrior[0]!;
  const winnerWithoutPrior = sortedWithoutPrior[0]!;
  const priorChangedWinner = winner.windowId !== winnerWithoutPrior.windowId;

  if (priorChangedWinner && !rankEqual(winner, winnerWithoutPrior)) {
    // DCN-01 / DIA-02: prior may only act as a tie-break once K1/K2 are already equal.
    throw new Error(
      `[LTR_FINE_SPAN] domainPriors changed winner without K1/K2 equality at cursor=${cursor} — architecture violation`
    );
  }

  for (const option of eligible) {
    if (option === winner) continue;
    optionTraces.push({
      windowId: option.windowId,
      start: option.syllableStart,
      end: option.syllableEnd,
      boundaryCrossCount: option.boundaryCrossCount,
      source: option.windowSource,
      lexicalCompleteness: option.lexicalCompleteness,
      candidateCount: option.candidates.length,
      priorMatchedDomains: option.priorMatchedDomains,
      decision: 'rejected',
    });
  }

  const selectionReason = determineSelectionReason(winner, sortedWithPrior[1], priorChangedWinner);
  const windowSource = resolveFormalWindowSource(winner);

  optionTraces.push({
    windowId: winner.windowId,
    start: winner.syllableStart,
    end: winner.syllableEnd,
    boundaryCrossCount: winner.boundaryCrossCount,
    source: winner.windowSource,
    lexicalCompleteness: winner.lexicalCompleteness,
    candidateCount: winner.candidates.length,
    priorMatchedDomains: winner.priorMatchedDomains,
    decision: 'selected',
  });

  const formalSpan: FormalFineSpan = {
    spanId: `fine:${winner.syllableStart}:${winner.syllableEnd}`,
    rawStart: winner.rawStart,
    rawEnd: winner.rawEnd,
    syllableStart: winner.syllableStart,
    syllableEnd: winner.syllableEnd,
    coarseSpanIds: winner.spanIds,
    boundaryCrossCount: winner.boundaryCrossCount as 0 | 1,
    windowSource,
    candidates: windowSource === 'fallback' ? [] : winner.candidates,
    selectionReason,
  };

  return {
    formalSpan,
    stepTrace: {
      cursor,
      options: optionTraces,
      selectedSpan: {
        start: winner.syllableStart,
        end: winner.syllableEnd,
        reason: selectionReason,
        spanId: formalSpan.spanId,
      },
      rankingBeforePrior: sortedWithoutPrior.map((o) => o.windowId),
      rankingAfterPrior: sortedWithPrior.map((o) => o.windowId),
      priorChangedWinner,
    },
  };
}

/** Alias kept for Development Plan naming ("Phase B: commitBestFormalFineSpan"). */
export const runLtrFineSpanCommit = commitBestFormalFineSpan;

/** ICST-05 — mandatory runtime commit assertions. */
function assertCommitInvariants(
  span: FormalFineSpan,
  cursor: number,
  previous: FormalFineSpan | undefined
): void {
  if (span.syllableEnd <= cursor) {
    throw new Error(`[LTR_FINE_SPAN] commit did not advance cursor (cursor=${cursor}, end=${span.syllableEnd})`);
  }
  if (span.boundaryCrossCount > V4_LIMITS.maxBoundaryCrossCount) {
    throw new Error(`[LTR_FINE_SPAN] committed span exceeds boundaryCrossCount<=1 (span=${span.spanId})`);
  }
  if (span.syllableStart !== cursor) {
    throw new Error(
      `[LTR_FINE_SPAN] committed span does not start at cursor (cursor=${cursor}, start=${span.syllableStart})`
    );
  }
  if (previous && span.syllableStart < previous.syllableEnd) {
    throw new Error(
      `[LTR_FINE_SPAN] committed span overlaps previous formal span (prevEnd=${previous.syllableEnd}, start=${span.syllableStart})`
    );
  }
  if ((span.windowSource as string) === 'blocked') {
    throw new Error(`[LTR_FINE_SPAN] blocked option reached commit (span=${span.spanId})`);
  }
}

function groupCandidatesByWindowId(candidates: readonly WindowCandidate[]): Map<string, WindowCandidate[]> {
  const map = new Map<string, WindowCandidate[]>();
  for (const c of candidates) {
    const list = map.get(c.windowId);
    if (list) {
      list.push(c);
    } else {
      map.set(c.windowId, [c]);
    }
  }
  return map;
}

/**
 * Phase C — full LTR loop. `recallForWindows` is injected so the orchestrator can reuse the
 * exact same recall/tone pipeline (`recallTopKForWindows`) it already uses elsewhere; this
 * generator performs no SQL/lexicon access itself.
 */
export function runLtrFineSpanGeneration(input: {
  rawText: string;
  globalSyllables: string[];
  coarseSpans: CoarseSpan[];
  domainPriors: readonly DomainPrior[];
  recallForWindows: (windows: GlobalWindowDescriptor[]) => WindowCandidate[];
  /** Utterance FineSpan ranges SSOT — required for production; rebuilt only if omitted. */
  charSyllableRanges?: readonly CharSyllableRange[];
}): LtrFineSpanGenerationResult {
  const { rawText, globalSyllables, coarseSpans, domainPriors, recallForWindows } = input;
  const charSyllableRanges =
    input.charSyllableRanges ?? buildUtteranceSyllableCoordinate(rawText).ranges;
  const formalSpans: FormalFineSpan[] = [];
  const steps: LtrFineSpanStepTrace[] = [];

  let cursor = 0;
  let guard = 0;
  const guardLimit = globalSyllables.length + 8;

  while (cursor < globalSyllables.length) {
    guard += 1;
    if (guard > guardLimit) {
      throw new Error('[LTR_FINE_SPAN] cursor failed to reach utterance end within guard budget');
    }

    const rawOptions = generateLocalOptionsAtCursor({
      cursor,
      rawText,
      globalSyllables,
      coarseSpans,
      charSyllableRanges,
    });
    const recallable = rawOptions.filter((w) => !w.blocked);
    const candidates = recallable.length ? recallForWindows(recallable) : [];
    const candidatesByWindowId = groupCandidatesByWindowId(candidates);

    const { formalSpan, stepTrace } = commitBestFormalFineSpan({
      cursor,
      rawText,
      globalSyllables,
      coarseSpans,
      rawOptions,
      candidatesByWindowId,
      domainPriors,
      charSyllableRanges,
    });

    assertCommitInvariants(formalSpan, cursor, formalSpans[formalSpans.length - 1]);

    formalSpans.push(formalSpan);
    steps.push(stepTrace);
    cursor = formalSpan.syllableEnd;
  }

  return {
    formalSpans,
    trace: { steps, formalOverlapCount: 0 },
  };
}

/** AR-03 — reusable runtime invariant check (fail-fast, not auto-repair). */
export function assertFormalFineSpansNonOverlapping(spans: readonly FormalFineSpan[]): void {
  const sorted = [...spans].sort((a, b) => a.syllableStart - b.syllableStart);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.syllableStart < sorted[i - 1]!.syllableEnd) {
      throw new Error(
        `[LTR_FINE_SPAN] formal FineSpan overlap detected (${sorted[i - 1]!.spanId} vs ${sorted[i]!.spanId}) — Assembly must fail-fast, not auto-repair`
      );
    }
  }
}
