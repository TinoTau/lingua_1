/**
 * Tone-first tier recall: composite SQL on all tiers, unified plain fallback when under limit.
 */

import type { HotwordEntry } from '../lexicon/hotword-types';
import { buildTonePinyinKeyFromSyllablesAndPattern } from '../lexicon/phonetic/tone-pinyin';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';
import { mergeSpanCandidatesCombined, type TierHotwordRow } from './merge-span-candidates';

export type ToneLookupStage = 'tone_exact' | 'plain_fallback' | 'plain_only_no_pattern';

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
  plainFallbackHitCount: number;
  toneSqlCount: number;
  queryTonePinyinKey?: string;
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

function lookupPlainTiers(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  termLength: number,
  domainIds: readonly string[],
  sqlLimit: number | undefined
): Pick<
  CollectTierCandidatesResult,
  'baseHits' | 'domainHits' | 'idiomHits' | 'baseLookupMs' | 'domainLookupMs' | 'idiomLookupMs'
> {
  const cfg = getLexiconRuntimeV2Config();

  const t0 = Date.now();
  const baseHits = runtimeV2.lookupBaseByPinyinKey(key, termLength, sqlLimit);
  const baseLookupMs = Date.now() - t0;

  const domainHits: HotwordEntry[] = [];
  let domainLookupMs = 0;
  for (const domainId of domainIds) {
    const td = Date.now();
    domainHits.push(...runtimeV2.lookupDomainByPinyinKey(domainId, key, termLength, sqlLimit));
    domainLookupMs += Date.now() - td;
  }

  let idiomHits: HotwordEntry[] = [];
  let idiomLookupMs = 0;
  if (termLength === 4 && cfg.maxIdiomCandidates > 0) {
    const ti = Date.now();
    idiomHits = runtimeV2.lookupIdiomByPinyinKey(key, termLength, sqlLimit);
    idiomLookupMs = Date.now() - ti;
  }

  return { baseHits, domainHits, idiomHits, baseLookupMs, domainLookupMs, idiomLookupMs };
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
  for (const domainId of domainIds) {
    const td = Date.now();
    domainHits.push(
      ...runtimeV2.lookupDomainByPinyinAndToneKey(domainId, key, tonePinyinKey, termLength, sqlLimit)
    );
    domainLookupMs += Date.now() - td;
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

function inferHotwordTier(hotword: HotwordEntry): TierHotwordRow['tier'] {
  if (hotword.domain || hotword.domains?.length) {
    return 'domain';
  }
  return 'base';
}

function dedupeByIdPreferToneExact(
  toneEntries: HotwordEntry[],
  plainEntries: HotwordEntry[]
): TierCandidateStage[] {
  const byId = new Map<string, TierCandidateStage>();

  for (const hotword of toneEntries) {
    byId.set(hotword.id, { hotword, stage: 'tone_exact' });
  }
  for (const hotword of plainEntries) {
    if (!byId.has(hotword.id)) {
      byId.set(hotword.id, { hotword, stage: 'plain_fallback' });
    }
  }

  return Array.from(byId.values());
}

function countToneSqlQueries(domainIds: readonly string[], termLength: number): number {
  const cfg = getLexiconRuntimeV2Config();
  let count = 1; // base
  count += domainIds.length;
  if (termLength === 4 && cfg.maxIdiomCandidates > 0) {
    count += 1;
  }
  return count;
}

export function collectTierCandidatesToneFirst(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  termLength: number,
  domainIds: readonly string[],
  perSpanLimit: number | undefined,
  variantSyllables: string[],
  acousticTonePattern?: number[]
): CollectTierCandidatesResult {
  const cfg = getLexiconRuntimeV2Config();
  const sqlLimit = perSpanLimit != null ? Math.max(perSpanLimit, 8) : undefined;
  const effectiveLimit = perSpanLimit != null && perSpanLimit > 0 ? perSpanLimit : undefined;

  const patternSlice = acousticTonePattern?.length
    ? acousticTonePattern.slice(0, variantSyllables.length)
    : undefined;
  const tonePinyinKey = buildTonePinyinKeyFromSyllablesAndPattern(variantSyllables, patternSlice);
  const toneActive =
    tonePinyinKey != null && runtimeV2.supportsToneFirstRecall();

  if (!toneActive) {
    const plain = lookupPlainTiers(runtimeV2, key, termLength, domainIds, sqlLimit);
    const entries = mergeTierCandidates(
      plain.baseHits,
      plain.domainHits,
      plain.idiomHits,
      cfg,
      effectiveLimit,
      domainIds
    );
    const entryStages = new Map<string, ToneLookupStage>();
    for (const hotword of entries) {
      entryStages.set(hotword.id, 'plain_only_no_pattern');
    }
    return {
      entries,
      entryStages,
      ...plain,
      toneExactHitCount: 0,
      plainFallbackHitCount: 0,
      toneSqlCount: 0,
    };
  }

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

  const needPlainFallback =
    effectiveLimit == null || toneMerged.length < effectiveLimit;

  if (!needPlainFallback) {
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
    };
  }

  const plain = lookupPlainTiers(runtimeV2, key, termLength, domainIds, sqlLimit);
  const plainMerged = mergeTierCandidates(
    plain.baseHits,
    plain.domainHits,
    plain.idiomHits,
    cfg,
    effectiveLimit,
    domainIds
  );

  const staged = dedupeByIdPreferToneExact(toneMerged, plainMerged);
  const tierRows: TierHotwordRow[] = staged.map(({ hotword }) => ({
    ...hotword,
    isAlias: hotword.isAlias === true,
    tier: inferHotwordTier(hotword),
  }));
  const entries =
    effectiveLimit != null && effectiveLimit > 0
      ? mergeSpanCandidatesCombined(tierRows, effectiveLimit, domainIds.length > 0)
      : staged.map((s) => s.hotword);
  const entryStages = new Map<string, ToneLookupStage>();
  for (const item of staged) {
    if (entries.some((e) => e.id === item.hotword.id)) {
      entryStages.set(item.hotword.id, item.stage);
    }
  }

  const plainFallbackHitCount = staged.filter((s) => s.stage === 'plain_fallback').length;

  return {
    entries,
    entryStages,
    baseHits: [...tone.baseHits, ...plain.baseHits],
    domainHits: [...tone.domainHits, ...plain.domainHits],
    idiomHits: [...tone.idiomHits, ...plain.idiomHits],
    baseLookupMs: tone.baseLookupMs + plain.baseLookupMs,
    domainLookupMs: tone.domainLookupMs + plain.domainLookupMs,
    idiomLookupMs: tone.idiomLookupMs + plain.idiomLookupMs,
    toneExactHitCount: toneMerged.length,
    plainFallbackHitCount,
    toneSqlCount,
    queryTonePinyinKey: tonePinyinKey,
  };
}
