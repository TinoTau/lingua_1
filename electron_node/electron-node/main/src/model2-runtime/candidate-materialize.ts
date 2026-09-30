/**
 * Materialize Lexicon hits → WindowCandidate (authoritative type).
 * Provenance is diagnostic / non-gating.
 *
 * Model2 D binding contract:
 *   A domain hit binds only to the FineSpan that triggered that retrieval
 *   AND whose syllable-range length matches the hit pinyin length.
 *   No first / iterator / nearest / fallback rebind.
 *   Length-inconsistent hits are not materialized (expected contract rejection
 *   remains if no matching origin window exists).
 */

import type { RecallSpanTopKV2Hit } from '../lexicon-v2/recall-span-topk-v2';
import type { GraphEdgeSource } from '../fw-detector/span-assembly-shared/types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { Model2DomainHit, Model2PolicyInput, RetrievalProvenance } from './types';
import type { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';

export type DomainHitBindingStatus = 'BOUND_TO_ORIGIN_SPAN' | 'REJECTED_RANGE_INCONSISTENT';

export function pinyinSyllableCount(pinyinKey: string | undefined | null): number {
  return String(pinyinKey || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean).length;
}

export function originSpanSyllableCount(
  policyInput: Pick<Model2PolicyInput, 'syllableStart' | 'syllableEnd'>
): number {
  return policyInput.syllableEnd - policyInput.syllableStart;
}

/** True iff hit phonetic length equals the originating FineSpan syllable range. */
export function domainHitMatchesOriginSpanRange(
  hit: Pick<Model2DomainHit, 'pinyin_key'>,
  policyInput: Pick<Model2PolicyInput, 'syllableStart' | 'syllableEnd'>
): boolean {
  const spanSyl = originSpanSyllableCount(policyInput);
  const hitSyl = pinyinSyllableCount(hit.pinyin_key);
  return spanSyl > 0 && hitSyl > 0 && hitSyl === spanSyl;
}

export function domainHitBindingStatus(
  hit: Pick<Model2DomainHit, 'pinyin_key'>,
  policyInput: Pick<Model2PolicyInput, 'syllableStart' | 'syllableEnd'>
): DomainHitBindingStatus {
  return domainHitMatchesOriginSpanRange(hit, policyInput)
    ? 'BOUND_TO_ORIGIN_SPAN'
    : 'REJECTED_RANGE_INCONSISTENT';
}

function resolveGraphSource(domains: readonly string[] | undefined): GraphEdgeSource {
  const fine = (domains ?? []).filter((d) => d && d !== 'general' && d !== 'base_term');
  return fine.length ? 'domain_term' : 'base_term';
}

export function materializeProfileHits(args: {
  hits: readonly RecallSpanTopKV2Hit[];
  policyInput: Model2PolicyInput;
  actionId: string;
  seqStart: number;
  retrievalId?: string;
}): WindowCandidate[] {
  const out: WindowCandidate[] = [];
  let seq = args.seqStart;
  for (const hit of args.hits) {
    seq += 1;
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? Object.freeze([...hit.hotword.domains])
        : undefined;
    const termId =
      hit.hotword?.id != null && String(hit.hotword.id).length > 0
        ? String(hit.hotword.id)
        : undefined;
    const cand: WindowCandidate & { retrievalProvenance?: RetrievalProvenance; model2ActionId?: string } =
      {
        candidateId: `m2:${args.policyInput.spanId}:${seq}`,
        windowId: `${args.policyInput.syllableStart}:${args.policyInput.syllableEnd}`,
        windowSource: 'in_span_window',
        anchorCoarseSpanId: args.policyInput.spanId,
        originSpanId: args.policyInput.spanId,
        retrievalId: args.retrievalId,
        syllableStart: args.policyInput.syllableStart,
        syllableEnd: args.policyInput.syllableEnd,
        rawStart: args.policyInput.rawStart,
        rawEnd: args.policyInput.rawEnd,
        windowPinyinKey: args.policyInput.windowPinyinKey,
        candidateScore: hit.candidateScore,
        score: hit.candidateScore,
        boundaryPenalty: 1,
        candidateRank: seq,
        hitKind: 'exact_term',
        replacement: hit.hotword.word,
        termId,
        recallCandidateKind: hit.recallCandidateKind,
        domains,
        source: resolveGraphSource(domains),
        recallSource: hit.source,
        repairTarget: hit.hotword.repairTarget === true,
        retrievalProvenance: 'PROFILE_PRONUNCIATION',
        model2ActionId: args.actionId,
      };
    out.push(cand);
  }
  return out;
}

/** Materialize restored Stage-D FuzzyPool hits (already retrieved in sidecar). */
export function materializeDomainHits(args: {
  hits: readonly Model2DomainHit[];
  policyInput: Model2PolicyInput;
  actionId: string;
  seqStart: number;
  runtime?: LexiconRuntimeV2;
  retrievalId?: string;
}): WindowCandidate[] {
  const out: WindowCandidate[] = [];
  let seq = args.seqStart;
  for (const hit of args.hits) {
    if (!domainHitMatchesOriginSpanRange(hit, args.policyInput)) {
      continue;
    }
    seq += 1;
    const domains = hit.domain_ids?.length ? Object.freeze([...hit.domain_ids]) : undefined;
    let termId = hit.sqlite_term_id || undefined;
    if (!termId && args.runtime && hit.surface && hit.pinyin_key) {
      const found = args.runtime.lookupBaseByExactSurfaceAndPinyin(
        hit.pinyin_key,
        hit.surface,
        Math.max(1, hit.pinyin_key.split('|').filter(Boolean).length)
      );
      termId = found[0]?.id;
    }
    if (!termId) termId = hit.term_id;
    const score = typeof hit.prior_score === 'number' ? hit.prior_score : 0.5;
    const cand: WindowCandidate & { retrievalProvenance?: RetrievalProvenance; model2ActionId?: string } =
      {
        candidateId: `m2d:${args.policyInput.spanId}:${seq}`,
        windowId: `${args.policyInput.syllableStart}:${args.policyInput.syllableEnd}`,
        windowSource: 'in_span_window',
        anchorCoarseSpanId: args.policyInput.spanId,
        originSpanId: args.policyInput.spanId,
        retrievalId: args.retrievalId,
        syllableStart: args.policyInput.syllableStart,
        syllableEnd: args.policyInput.syllableEnd,
        rawStart: args.policyInput.rawStart,
        rawEnd: args.policyInput.rawEnd,
        windowPinyinKey: args.policyInput.windowPinyinKey,
        candidateScore: score,
        score,
        boundaryPenalty: 1,
        candidateRank: seq,
        hitKind: 'exact_term',
        replacement: hit.surface,
        termId,
        domains,
        source: resolveGraphSource(domains),
        recallSource: 'lexicon_pinyin_topk',
        repairTarget: false,
        retrievalProvenance: 'PROFILE_DOMAIN',
        model2ActionId: args.actionId,
      };
    out.push(cand);
  }
  return out;
}

/** Mark base candidates with BASE_FUZZY provenance when missing (non-breaking). */
export function tagBaseProvenance(cands: WindowCandidate[]): void {
  for (const c of cands) {
    const ext = c as WindowCandidate & { retrievalProvenance?: RetrievalProvenance };
    if (!ext.retrievalProvenance) {
      ext.retrievalProvenance = 'BASE_FUZZY';
    }
  }
}
