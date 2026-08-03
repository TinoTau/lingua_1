/**
 * Tone-first tier recall (Batch 1.1C Mandatory Tone Recall — Fail Closed).
 * No Plain-only path; no underfill Plain fill.
 */

import type { HotwordEntry } from '../lexicon/hotword-types';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';
import { mergeSpanCandidatesCombined, type TierHotwordRow } from './merge-span-candidates';
import {
  resolveToneRecallReadiness,
  type ToneRecallReadiness,
} from './tone-recall-readiness';

/** Production assignment: only tone_exact. Legacy plain_* stages removed (1.1C). */
export type ToneLookupStage = 'tone_exact';

export type TierCandidateStage = {
  hotword: HotwordEntry;
  stage: ToneLookupStage;
};

export type CollectTierCandidatesResult = {
  entries: HotwordEntry[];
  entryStages: Map<string, ToneLookupStage>;
  baseHits: HotwordEntry[];
  domainHits: HotwordEntry[];
  idiomHits: HotwordEntry[];
  baseLookupMs: number;
  domainLookupMs: number;
  idiomLookupMs: number;
  toneExactHitCount: number;
  /** Always 0 after Batch 1.1C (Plain fill removed). */
  plainFallbackHitCount: number;
  toneSqlCount: number;
  queryTonePinyinKey?: string;
  toneRecallReadiness: ToneRecallReadiness;
};

function hotwordToTierRow(hotword: HotwordEntry, tier: TierHotwordRow['tier']): TierHotwordRow {
  return {
    ...hotword,
    isAlias: hotword.isAlias === true,
    tier,
  };
}

function mergeTierCandidates(
  baseHits: HotwordEntry[],
  domainHits: HotwordEntry[],
  idiomHits: HotwordEntry[],
  cfg: ReturnType<typeof getLexiconRuntimeV2Config>,
  perSpanLimit?: number,
  domainIds?: readonly string[]
): HotwordEntry[] {
  if (perSpanLimit != null && perSpanLimit > 0) {
    const rows: TierHotwordRow[] = [
      ...domainHits.map((h) => hotwordToTierRow(h, 'domain')),
      ...baseHits.map((h) => hotwordToTierRow(h, 'base')),
      ...idiomHits.map((h) => hotwordToTierRow(h, 'idiom')),
    ];
    const hasActiveDomain = (domainIds?.length ?? 0) > 0;
    return mergeSpanCandidatesCombined(rows, perSpanLimit, hasActiveDomain);
  }

  const base = baseHits.slice(0, cfg.maxBaseCandidates);
  const domain = [...domainHits]
    .sort((a, b) => b.priorScore - a.priorScore)
    .slice(0, cfg.maxDomainCandidates);
  const idiom =
    cfg.maxIdiomCandidates > 0 ? idiomHits.slice(0, cfg.maxIdiomCandidates) : [];
  return [...base, ...domain, ...idiom];
}

function lookupToneTiers(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  tonePinyinKey: string,
  termLength: number,
  domainIds: readonly string[],
  sqlLimit: number | undefined
): Pick<
  CollectTierCandidatesResult,
  'baseHits' | 'domainHits' | 'idiomHits' | 'baseLookupMs' | 'domainLookupMs' | 'idiomLookupMs'
> {
  const cfg = getLexiconRuntimeV2Config();

  const t0 = Date.now();
  const baseHits = runtimeV2.lookupBaseByPinyinAndToneKey(key, tonePinyinKey, termLength, sqlLimit);
  const baseLookupMs = Date.now() - t0;

  const domainHits: HotwordEntry[] = [];
  let domainLookupMs = 0;
  if (domainIds.length > 0) {
    const td = Date.now();
    domainHits.push(
      ...runtimeV2.lookupDomainsByPinyinAndToneKeyMulti(
        domainIds,
        key,
        tonePinyinKey,
        termLength,
        sqlLimit
      )
    );
    domainLookupMs = Date.now() - td;
  }

  let idiomHits: HotwordEntry[] = [];
  let idiomLookupMs = 0;
  if (termLength === 4 && cfg.maxIdiomCandidates > 0) {
    const ti = Date.now();
    idiomHits = runtimeV2.lookupIdiomByPinyinAndToneKey(key, tonePinyinKey, termLength, sqlLimit);
    idiomLookupMs = Date.now() - ti;
  }

  return { baseHits, domainHits, idiomHits, baseLookupMs, domainLookupMs, idiomLookupMs };
}

function countToneSqlQueries(domainIds: readonly string[], termLength: number): number {
  const cfg = getLexiconRuntimeV2Config();
  let count = 1; // base
  if (domainIds.length > 0) {
    count += 1; // domain multi lookup
  }
  if (termLength === 4 && cfg.maxIdiomCandidates > 0) {
    count += 1;
  }
  return count;
}

function emptySkipResult(
  readiness: ToneRecallReadiness
): CollectTierCandidatesResult {
  return {
    entries: [],
    entryStages: new Map(),
    baseHits: [],
    domainHits: [],
    idiomHits: [],
    baseLookupMs: 0,
    domainLookupMs: 0,
    idiomLookupMs: 0,
    toneExactHitCount: 0,
    plainFallbackHitCount: 0,
    toneSqlCount: 0,
    toneRecallReadiness: readiness,
  };
}

export function collectTierCandidatesToneFirst(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  termLength: number,
  domainIds: readonly string[],
  perSpanLimit: number | undefined,
  variantSyllables: string[],
  acousticTonePattern?: number[],
  toneCallerEnabled?: boolean
): CollectTierCandidatesResult {
  const cfg = getLexiconRuntimeV2Config();
  const sqlLimit = perSpanLimit != null ? Math.max(perSpanLimit, 8) : undefined;
  const effectiveLimit = perSpanLimit != null && perSpanLimit > 0 ? perSpanLimit : undefined;

  const readiness = resolveToneRecallReadiness({
    syllables: variantSyllables,
    runtimeSupportsTone: runtimeV2.supportsToneFirstRecall(),
    acousticTonePattern,
    toneCallerEnabled,
  });

  if (readiness.state !== 'ready') {
    return emptySkipResult(readiness);
  }

  const tonePinyinKey = readiness.tonePinyinKey;
  const toneSqlCount = countToneSqlQueries(domainIds, termLength);
  const tone = lookupToneTiers(runtimeV2, key, tonePinyinKey, termLength, domainIds, sqlLimit);
  const toneMerged = mergeTierCandidates(
    tone.baseHits,
    tone.domainHits,
    tone.idiomHits,
    cfg,
    effectiveLimit,
    domainIds
  );

  const entryStages = new Map<string, ToneLookupStage>();
  for (const hotword of toneMerged) {
    entryStages.set(hotword.id, 'tone_exact');
  }

  return {
    entries: toneMerged,
    entryStages,
    baseHits: tone.baseHits,
    domainHits: tone.domainHits,
    idiomHits: tone.idiomHits,
    baseLookupMs: tone.baseLookupMs,
    domainLookupMs: tone.domainLookupMs,
    idiomLookupMs: tone.idiomLookupMs,
    toneExactHitCount: toneMerged.length,
    plainFallbackHitCount: 0,
    toneSqlCount,
    queryTonePinyinKey: tonePinyinKey,
    toneRecallReadiness: readiness,
  };
}
