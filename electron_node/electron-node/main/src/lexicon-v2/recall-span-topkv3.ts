/**
 * V3 recall — exact (delegates V2) + parent fragment lookup from term_pinyin_ngrams.
 */

import {
  computeCandidateScoreBreakdown,
  type CandidateScoreBreakdown,
  type RecallCandidateKind,
} from '../lexicon/candidate-score';
import type { DomainBoostContext } from '../lexicon/domain-boost-calculator';
import { scorePinyinSimilarity } from '../lexicon/phonetic/pinyin';
import { syllablesKey } from '../lexicon/pinyin-index';
import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import type { HotwordEntry } from '../lexicon/hotword-types';
import { resolveWindowCandidateSource, type WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION } from './lexicon-types-v2';
import type { ParentTermNgramRow } from './lexicon-types-v2';
import { computeToneScoreResult, type ToneReason } from '../fw-detector/tone-match-score';
import type { WeakDomainRecallPlan } from './weak-domain-recall-resolver';
import {
  recallSpanTopKV2,
  type RecallSpanTopKV2Hit,
  type RecallSpanTopKV2Input,
  type RecallSpanTopKV2Result,
} from './recall-span-topk-v2';

export type RecallHitKind = 'exact_term' | 'parent_fragment';

export type RecallSpanTopKV3Hit = {
  hitKind: RecallHitKind;
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  source: WindowCandidateSource;
  acousticTonePattern?: number[];
  parentTerm?: string;
  parentTermId?: string;
  parentPinyinKey?: string;
  matchedTermStart?: number;
  matchedTermEnd?: number;
  fragmentPinyinKey?: string;
  fragmentTonePinyinKey?: string;
  domainEvidenceTerm?: string;
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: ToneReason;
};

export type RecallSpanTopKV3Result = RecallSpanTopKV2Result & {
  hits: RecallSpanTopKV3Hit[];
  parentFragmentHitCount: number;
};

export type RecallSpanTopKV3Input = RecallSpanTopKV2Input & {
  exactTopK?: number;
  parentFragmentTopK?: number;
  perParentTermPerWindow?: number;
  ngramSqlLimit?: number;
  /** Diagnostics-only: observe fragment hits after tone score applied. */
  onFragmentHitsScored?: (hits: RecallSpanTopKV3Hit[]) => void;
};

const DEFAULT_EXACT_TOP_K = 2;
const DEFAULT_PARENT_FRAGMENT_TOP_K = 3;
const DEFAULT_PER_PARENT_TERM_PER_WINDOW = 1;
const DEFAULT_NGRAM_SQL_LIMIT = 12;

function minCandidateScore(): number {
  return getAsrRepairQualityConfig().minCandidateScore;
}

function domainBoostContextFromPlan(plan?: WeakDomainRecallPlan): DomainBoostContext | undefined {
  if (!plan?.enabled) {
    return undefined;
  }
  return {
    strongDomainIds: plan.strongDomainIds,
    weakDomainIds: plan.weakDomainIds,
  };
}

function classifyFragmentKind(row: ParentTermNgramRow, plan?: WeakDomainRecallPlan): RecallCandidateKind {
  if (row.tier === 'domain' && row.domainId) {
    if (plan?.enabled) {
      if (plan.strongDomainIds.includes(row.domainId)) {
        return 'exact_domain_strong';
      }
      if (plan.weakDomainIds.includes(row.domainId)) {
        return 'exact_domain_weak';
      }
    }
    return 'exact_domain_strong';
  }
  return 'exact_base';
}

function fragmentRowAllowed(
  row: ParentTermNgramRow,
  domainIds: readonly string[],
  plan?: WeakDomainRecallPlan
): boolean {
  if (row.tier === 'domain' && row.domainId) {
    if (domainIds.includes(row.domainId)) {
      return true;
    }
    if (plan?.enabled && plan.weakDomainIds.includes(row.domainId)) {
      return true;
    }
    return false;
  }
  return true;
}

function ngramRowToHotword(row: ParentTermNgramRow): HotwordEntry {
  const domains = row.domainId ? [row.domainId] : [];
  return {
    id: `ngram:${row.id}`,
    word: row.fragmentText,
    normalized: row.fragmentText,
    pinyin: row.ngramPinyinKey.split('|').filter(Boolean),
    priorScore: row.prior,
    frequency: 1,
    domain: row.domainId,
    domains,
    enabled: row.enabled,
    repairTarget: row.repairTarget,
    tonePinyinKey: row.ngramTonePinyinKey,
    source: row.source,
  };
}

function mapV2Hit(hit: RecallSpanTopKV2Hit): RecallSpanTopKV3Hit {
  const toneFields = hit as RecallSpanTopKV2Hit & {
    toneCompatible?: boolean;
    tonePenalty?: number;
    toneReason?: ToneReason;
  };
  return {
    hitKind: 'exact_term',
    hotword: hit.hotword,
    phoneticScore: hit.phoneticScore,
    candidateScore: hit.candidateScore,
    candidateScoreBreakdown: hit.candidateScoreBreakdown,
    source: hit.source,
    acousticTonePattern: hit.acousticTonePattern,
    toneCompatible: toneFields.toneCompatible,
    tonePenalty: toneFields.tonePenalty,
    toneReason: toneFields.toneReason,
  };
}

function scoreFragmentHit(
  row: ParentTermNgramRow,
  syllables: string[],
  windowText: string,
  profile: ActiveLexiconProfileSnapshot,
  boostContext: DomainBoostContext | undefined,
  plan: WeakDomainRecallPlan | undefined,
  acousticTonePattern: number[] | undefined
): RecallSpanTopKV3Hit | null {
  const hotword = ngramRowToHotword(row);
  const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
  const recallCandidateKind = classifyFragmentKind(row, plan);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    profile,
    recallCandidateKind,
    domainBoostContext: boostContext,
  });
  const candidateScore =
    candidateScoreBreakdown.priorScore +
    candidateScoreBreakdown.phoneticSimilarity +
    candidateScoreBreakdown.exactLengthBonus +
    candidateScoreBreakdown.domainBoost -
    candidateScoreBreakdown.editDistancePenalty -
    candidateScoreBreakdown.fuzzyPenalty;

  if (candidateScore < minCandidateScore()) {
    return null;
  }

  const tonePattern = acousticTonePattern?.length
    ? acousticTonePattern.slice(0, syllables.length)
    : undefined;

  return {
    hitKind: 'parent_fragment',
    hotword,
    phoneticScore,
    candidateScore,
    candidateScoreBreakdown,
    source: resolveWindowCandidateSource({ viaPinyin: true }),
    acousticTonePattern: tonePattern,
    parentTerm: row.parentWord,
    parentTermId: row.parentTermId,
    parentPinyinKey: row.parentPinyinKey,
    matchedTermStart: row.ngramStart,
    matchedTermEnd: row.ngramEnd,
    fragmentPinyinKey: row.ngramPinyinKey,
    fragmentTonePinyinKey: row.ngramTonePinyinKey,
    domainEvidenceTerm: row.parentWord,
  };
}

function applyToneScoreToFragmentHits(
  hits: RecallSpanTopKV3Hit[],
  acousticTonePattern: number[] | undefined
): { penalizedCount: number; compatibleCount: number } {
  let penalizedCount = 0;
  let compatibleCount = 0;

  for (const hit of hits) {
    const toneResult = computeToneScoreResult(
      acousticTonePattern,
      hit.fragmentTonePinyinKey ?? hit.hotword.tonePinyinKey ?? '',
      hit.hotword.word
    );
    hit.toneCompatible = toneResult.toneCompatible;
    hit.tonePenalty = toneResult.tonePenalty;
    hit.toneReason = toneResult.toneReason;
    hit.candidateScore *= toneResult.tonePenalty;
    if (toneResult.toneReason === 'match') {
      compatibleCount += 1;
    }
    if (toneResult.tonePenalty < 1) {
      penalizedCount += 1;
    }
  }

  hits.sort((a, b) => b.candidateScore - a.candidateScore);
  return { penalizedCount, compatibleCount };
}

function lookupParentFragments(
  runtimeV2: LexiconRuntimeV2,
  input: RecallSpanTopKV3Input
): { hits: RecallSpanTopKV3Hit[]; penalizedCount: number; compatibleCount: number } {
  if (runtimeV2.getManifestVersion() !== LEXICON_V3_FIVE_TABLE_RUNTIME_SCHEMA_VERSION) {
    return { hits: [], penalizedCount: 0, compatibleCount: 0 };
  }

  const {
    syllables,
    windowText,
    domainIds,
    acousticTonePattern,
    weakDomainPlan,
    parentFragmentTopK = DEFAULT_PARENT_FRAGMENT_TOP_K,
    perParentTermPerWindow = DEFAULT_PER_PARENT_TERM_PER_WINDOW,
    ngramSqlLimit = DEFAULT_NGRAM_SQL_LIMIT,
  } = input;

  if (syllables.length < 2 || syllables.length > 5) {
    return { hits: [], penalizedCount: 0, compatibleCount: 0 };
  }

  const profile = input.profile ?? defaultGeneralProfile();
  const boostContext = domainBoostContextFromPlan(weakDomainPlan);
  const key = syllablesKey(syllables);
  const rows = runtimeV2.lookupParentFragmentsByNgramKey(key, ngramSqlLimit);

  const perParentCount = new Map<string, number>();
  const hits: RecallSpanTopKV3Hit[] = [];

  for (const row of rows) {
    if (!fragmentRowAllowed(row, domainIds, weakDomainPlan)) {
      continue;
    }

    const parentId = row.parentTermId;
    const used = perParentCount.get(parentId) ?? 0;
    if (used >= perParentTermPerWindow) {
      continue;
    }

    const hit = scoreFragmentHit(
      row,
      syllables,
      windowText,
      profile,
      boostContext,
      weakDomainPlan,
      acousticTonePattern
    );
    if (!hit) {
      continue;
    }

    perParentCount.set(parentId, used + 1);
    hits.push(hit);
    if (hits.length >= parentFragmentTopK) {
      break;
    }
  }

  if (!acousticTonePattern?.length) {
    for (const hit of hits) {
      const toneResult = computeToneScoreResult(
        undefined,
        hit.fragmentTonePinyinKey ?? hit.hotword.tonePinyinKey ?? '',
        hit.hotword.word
      );
      hit.toneCompatible = toneResult.toneCompatible;
      hit.tonePenalty = toneResult.tonePenalty;
      hit.toneReason = toneResult.toneReason;
    }
    if (input.onFragmentHitsScored) {
      input.onFragmentHitsScored([...hits]);
    }
    return { hits, penalizedCount: 0, compatibleCount: 0 };
  }

  const toneCounts = applyToneScoreToFragmentHits(hits, acousticTonePattern);

  if (input.onFragmentHitsScored) {
    input.onFragmentHitsScored([...hits]);
  }

  return { hits, ...toneCounts };
}

function mergeExactAndFragmentHits(
  exactHits: RecallSpanTopKV3Hit[],
  fragmentHits: RecallSpanTopKV3Hit[],
  exactTopK: number,
  parentFragmentTopK: number
): RecallSpanTopKV3Hit[] {
  const exact = exactHits.slice(0, exactTopK);
  const fragments = fragmentHits.slice(0, parentFragmentTopK);
  return [...exact, ...fragments];
}

export function recallSpanTopKV3(
  runtimeV2: LexiconRuntimeV2,
  input: RecallSpanTopKV3Input
): RecallSpanTopKV3Result {
  const exactTopK = input.exactTopK ?? DEFAULT_EXACT_TOP_K;
  const parentFragmentTopK = input.parentFragmentTopK ?? DEFAULT_PARENT_FRAGMENT_TOP_K;

  const v2Result = recallSpanTopKV2(runtimeV2, {
    ...input,
    topK: exactTopK,
    perSpanLimit: exactTopK,
    fuzzyRecallEnabled: input.fuzzyRecallEnabled,
  });

  const exactHits = v2Result.hits.map(mapV2Hit);
  const fragmentLookup = lookupParentFragments(runtimeV2, input);
  const fragmentHits = fragmentLookup.hits;
  const merged = mergeExactAndFragmentHits(exactHits, fragmentHits, exactTopK, parentFragmentTopK);

  return {
    hits: merged,
    maxDomainBoostApplied: v2Result.maxDomainBoostApplied,
    recallToneCompatibleCount:
      v2Result.recallToneCompatibleCount + fragmentLookup.compatibleCount,
    recallToneFallbackCount:
      v2Result.recallToneFallbackCount + fragmentLookup.penalizedCount,
    parentFragmentHitCount: fragmentHits.length,
  };
}
