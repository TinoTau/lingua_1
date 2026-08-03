/**
 * Phase 1 — Utterance-level Recall Cache + Canonical RecallQueryKey.
 * Phase 2/3 (Parent Fragment Full Retirement): cache stores exact-term Fact hits only
 * (RecallSpanTopKV2Hit); window binding creates fresh WindowCandidate objects.
 */

import type { RecallSpanTopKV2Hit } from '../../lexicon-v2/recall-span-topk-v2';

export type RecallQueryKind = 'span_v3_bundle';

export type CanonicalRecallQuery = {
  kind: RecallQueryKind;
  pinyinKey: string;
  /** '' = plain / no acoustic tone pattern for lookup path */
  toneNorm: string;
  domainScope: readonly string[];
  exactTopK: number;
  lexiconVersion: string;
  /**
   * Surface text enters key because V2 candidateScore uses windowText
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
  physicalSqlStatementCount: number;
  recallRequestBuildMs: number;
  utteranceCacheLookupMs: number;
  lexiconFactLookupMs: number;
  windowBindingMs: number;
  lexiconRecallTotalMs: number;
};

export type LexiconFactHit = Readonly<{
  hitKind: 'exact_term';
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
  acousticTonePattern?: readonly number[];
  /** Frozen snapshot of underlying exact Recall hit for lossless rebind. */
  exactHit: RecallSpanTopKV2Hit;
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
  // v2: parentFragmentTopK removed from production cache contract (Phase 1 PF retirement).
  return [
    'v2',
    q.kind,
    q.pinyinKey,
    tone,
    domains,
    String(q.exactTopK),
    q.lexiconVersion,
    surface,
  ].join('|');
}

export function buildSpanV3CanonicalQuery(input: {
  pinyinKey: string;
  toneNorm: string;
  domainIds: readonly string[];
  exactTopK: number;
  lexiconVersion: string;
  surfaceText: string;
}): CanonicalRecallQuery {
  return {
    kind: 'span_v3_bundle',
    pinyinKey: input.pinyinKey,
    toneNorm: input.toneNorm ?? '',
    domainScope: normalizeDomainScope(input.domainIds),
    exactTopK: input.exactTopK,
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
    exactHit: hit.exactHit,
  });
}

function cloneFrozenExactHit(hit: RecallSpanTopKV2Hit): RecallSpanTopKV2Hit {
  const domains = hit.hotword.domains?.length ? Object.freeze([...hit.hotword.domains]) : hit.hotword.domains;
  const hotword = Object.freeze({ ...hit.hotword, domains });
  return Object.freeze({
    ...hit,
    hotword,
    acousticTonePattern: hit.acousticTonePattern ? Object.freeze([...hit.acousticTonePattern]) : undefined,
  }) as RecallSpanTopKV2Hit;
}

export function lexiconFactsFromExactHits(hits: readonly RecallSpanTopKV2Hit[]): readonly LexiconFactHit[] {
  const out: LexiconFactHit[] = [];
  for (const hit of hits) {
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? [...hit.hotword.domains]
        : [];
    out.push(
      freezeFact({
        hitKind: 'exact_term',
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
        acousticTonePattern: hit.acousticTonePattern,
        exactHit: cloneFrozenExactHit(hit),
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

export function exactHitsFromLexiconFacts(facts: readonly LexiconFactHit[]): RecallSpanTopKV2Hit[] {
  // Return shallow copies of frozen exact hits so downstream may attach window fields safely.
  return facts.map((f) => ({ ...f.exactHit, hotword: { ...f.exactHit.hotword } }));
}
