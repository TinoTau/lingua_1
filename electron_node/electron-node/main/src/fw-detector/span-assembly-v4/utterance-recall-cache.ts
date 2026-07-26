/**
 * Phase 1 — Utterance-level Recall Cache + Canonical RecallQueryKey.
 * Cache stores lexicon Fact hits only; window binding creates fresh WindowCandidate objects.
 */

import type { RecallSpanTopKV3Hit } from '../../lexicon-v2/recall-span-topkv3';

export type RecallQueryKind = 'span_v3_bundle';

export type CanonicalRecallQuery = {
  kind: RecallQueryKind;
  pinyinKey: string;
  /** '' = plain / no acoustic tone pattern for lookup path */
  toneNorm: string;
  domainScope: readonly string[];
  exactTopK: number;
  parentFragmentTopK: number;
  lexiconVersion: string;
  /**
   * Surface text enters key because V2/V3 candidateScore uses windowText
   * (WINDOW scoring input that must not be shared across different surfaces).
   */
  surfaceText: string;
};

export type UtteranceRecallCacheStats = {
  requestCount: number;
  uniqueKeyCount: number;
  duplicateKeyCount: number;
  hitCount: number;
  missCount: number;
  exactQueryCount: number;
  parentQueryCount: number;
  physicalSqlStatementCount: number;
  recallRequestBuildMs: number;
  utteranceCacheLookupMs: number;
  lexiconFactLookupMs: number;
  windowBindingMs: number;
  lexiconRecallTotalMs: number;
};

export type LexiconFactHit = Readonly<{
  hitKind: 'exact_term' | 'parent_fragment';
  word: string;
  hotwordId: string;
  domains: readonly string[];
  priorScore: number;
  repairTarget: boolean;
  candidateScore: number;
  source: string;
  toneLookupStage?: string;
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: string;
  parentTermId?: string;
  parentTerm?: string;
  parentPinyinKey?: string;
  matchedTermStart?: number;
  matchedTermEnd?: number;
  fragmentTonePinyinKey?: string;
  acousticTonePattern?: readonly number[];
  /** Frozen snapshot of underlying V3 hit for lossless rebind. */
  v3Hit: RecallSpanTopKV3Hit;
}>;

export type UtteranceRecallContext = {
  cache: Map<string, readonly LexiconFactHit[]>;
  stats: UtteranceRecallCacheStats;
  lexiconVersion: string;
  seenKeys: Set<string>;
};

export function createUtteranceRecallContext(lexiconVersion: string): UtteranceRecallContext {
  return {
    cache: new Map(),
    seenKeys: new Set(),
    lexiconVersion,
    stats: {
      requestCount: 0,
      uniqueKeyCount: 0,
      duplicateKeyCount: 0,
      hitCount: 0,
      missCount: 0,
      exactQueryCount: 0,
      parentQueryCount: 0,
      physicalSqlStatementCount: 0,
      recallRequestBuildMs: 0,
      utteranceCacheLookupMs: 0,
      lexiconFactLookupMs: 0,
      windowBindingMs: 0,
      lexiconRecallTotalMs: 0,
    },
  };
}

export function normalizeDomainScope(domainIds: readonly string[] | undefined): string[] {
  if (!domainIds?.length) {
    return [];
  }
  return [...domainIds].map((d) => d.trim()).filter(Boolean).sort();
}

/** Acoustic tone pattern → canonical toneNorm ('' = plain / missing). */
export function normalizeToneNorm(acousticTonePattern: readonly number[] | undefined): string {
  if (!acousticTonePattern?.length) {
    return '';
  }
  return acousticTonePattern.map((n) => String(n)).join(',');
}

export function serializeCanonicalRecallQueryKey(q: CanonicalRecallQuery): string {
  const domains = normalizeDomainScope(q.domainScope).join(',');
  const tone = q.toneNorm ?? '';
  const surface = q.surfaceText ?? '';
  return [
    'v1',
    q.kind,
    q.pinyinKey,
    tone,
    domains,
    String(q.exactTopK),
    String(q.parentFragmentTopK),
    q.lexiconVersion,
    surface,
  ].join('|');
}

export function buildSpanV3CanonicalQuery(input: {
  pinyinKey: string;
  toneNorm: string;
  domainIds: readonly string[];
  exactTopK: number;
  parentFragmentTopK: number;
  lexiconVersion: string;
  surfaceText: string;
}): CanonicalRecallQuery {
  return {
    kind: 'span_v3_bundle',
    pinyinKey: input.pinyinKey,
    toneNorm: input.toneNorm ?? '',
    domainScope: normalizeDomainScope(input.domainIds),
    exactTopK: input.exactTopK,
    parentFragmentTopK: input.parentFragmentTopK,
    lexiconVersion: input.lexiconVersion,
    surfaceText: input.surfaceText,
  };
}

function freezeFact(hit: LexiconFactHit): LexiconFactHit {
  return Object.freeze({
    ...hit,
    domains: Object.freeze([...hit.domains]),
    acousticTonePattern: hit.acousticTonePattern
      ? Object.freeze([...hit.acousticTonePattern])
      : undefined,
    v3Hit: hit.v3Hit,
  });
}

function cloneFrozenV3Hit(hit: RecallSpanTopKV3Hit): RecallSpanTopKV3Hit {
  const domains = hit.hotword.domains?.length ? Object.freeze([...hit.hotword.domains]) : hit.hotword.domains;
  const hotword = Object.freeze({ ...hit.hotword, domains });
  return Object.freeze({
    ...hit,
    hotword,
    acousticTonePattern: hit.acousticTonePattern ? Object.freeze([...hit.acousticTonePattern]) : undefined,
  }) as RecallSpanTopKV3Hit;
}

export function lexiconFactsFromV3Hits(hits: readonly RecallSpanTopKV3Hit[]): readonly LexiconFactHit[] {
  const out: LexiconFactHit[] = [];
  for (const hit of hits) {
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? [...hit.hotword.domains]
        : [];
    out.push(
      freezeFact({
        hitKind: hit.hitKind === 'parent_fragment' ? 'parent_fragment' : 'exact_term',
        word: hit.hotword.word,
        hotwordId: hit.hotword.id,
        domains,
        priorScore: hit.hotword.priorScore,
        repairTarget: hit.hotword.repairTarget === true,
        candidateScore: hit.candidateScore,
        source: hit.source,
        toneLookupStage: hit.toneLookupStage,
        toneCompatible: hit.toneCompatible,
        tonePenalty: hit.tonePenalty,
        toneReason: hit.toneReason,
        parentTermId: hit.parentTermId,
        parentTerm: hit.parentTerm,
        parentPinyinKey: hit.parentPinyinKey,
        matchedTermStart: hit.matchedTermStart,
        matchedTermEnd: hit.matchedTermEnd,
        fragmentTonePinyinKey: hit.fragmentTonePinyinKey,
        acousticTonePattern: hit.acousticTonePattern,
        v3Hit: cloneFrozenV3Hit(hit),
      })
    );
  }
  return Object.freeze(out);
}

export function releaseUtteranceRecallContext(ctx: UtteranceRecallContext): void {
  ctx.cache.clear();
  ctx.seenKeys.clear();
}

export function utteranceCacheGet(
  ctx: UtteranceRecallContext,
  key: string
): readonly LexiconFactHit[] | undefined {
  ctx.stats.requestCount += 1;
  if (ctx.seenKeys.has(key)) {
    ctx.stats.duplicateKeyCount += 1;
  } else {
    ctx.seenKeys.add(key);
    ctx.stats.uniqueKeyCount += 1;
  }
  const hit = ctx.cache.get(key);
  if (hit) {
    ctx.stats.hitCount += 1;
    return hit;
  }
  ctx.stats.missCount += 1;
  return undefined;
}

export function utteranceCacheSet(
  ctx: UtteranceRecallContext,
  key: string,
  facts: readonly LexiconFactHit[]
): void {
  ctx.cache.set(key, facts);
}

export function v3HitsFromLexiconFacts(facts: readonly LexiconFactHit[]): RecallSpanTopKV3Hit[] {
  // Return shallow copies of frozen V3 hits so downstream may attach window fields safely.
  return facts.map((f) => ({ ...f.v3Hit, hotword: { ...f.v3Hit.hotword } }));
}
