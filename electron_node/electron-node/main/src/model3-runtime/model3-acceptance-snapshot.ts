/**
 * MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION — test/audit-only upstream snapshot + hash.
 *
 * NOT a JobResult field. NOT a production cross-service contract.
 * Acceptance integrity only: proves BASELINE input == S3 input at Model3 fork.
 */

import { createHash } from 'crypto';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { Model3AnchorMark, Model3SpanDecision } from './model3-types';

export const MODEL3_ACCEPTANCE_SNAPSHOT_SCHEMA = 'MODEL3_ACCEPTANCE_UPSTREAM_SNAPSHOT_V1';
export const MODEL3_ACCEPTANCE_HASH_ALGO = 'sha256_canonical_json_v1';
export const MODEL3_ACCEPTANCE_CAUSAL_FORK_ENV = 'MODEL3_ACCEPTANCE_CAUSAL_FORK';
export const MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT_ENV =
  'MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT';

export function isModel3AcceptanceCausalForkEnabled(): boolean {
  return process.env.MODEL3_ACCEPTANCE_CAUSAL_FORK === '1';
}

/** Class-weight audit: baseline S3 weights vs A1_RERUN1 on same upstream (not KEEP override). */
export function isDualWeightClassWeightAuditEnabled(): boolean {
  return process.env.MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT === '1';
}

/** Canonical JSON for deterministic hashing (sorted keys, no undefined). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = sortKeys(v);
  }
  return out;
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export type Model3AcceptancePackedSpan = {
  spanId: string;
  surface: string;
  isAnchor: boolean;
  rawStart: number;
  rawEnd: number;
  seqIndex: number;
  tokenIds: number[] | null;
  featVector: number[] | null;
  availMask: number[] | null;
  features: Record<string, number> | null;
  rawFirstPassCandidateCount: number;
  rawPinyinChannelAvail: boolean;
};

export type Model3AcceptanceUpstreamHashPayload = {
  schema: typeof MODEL3_ACCEPTANCE_SNAPSHOT_SCHEMA;
  rawAsrText: string;
  pathId?: string;
  pathFineSpans: Array<{
    spanId: string;
    rawStart: number;
    rawEnd: number;
    surface: string;
    syllableStart: number;
    syllableEnd: number;
    candidateIds: string[];
    candidateCount: number;
  }>;
  candidateState: Array<{
    candidateId: string;
    replacement: string;
    originSpanId?: string;
    source?: string;
    domains?: string[];
    isCovered?: boolean;
  }>;
  retainedDomains: string[];
  anchors: Array<{
    spanId: string;
    surface: string;
    rawStart: number;
    rawEnd: number;
    source: string;
  }>;
  packedSpans: Model3AcceptancePackedSpan[];
};

export function buildPackedSpanFromDecision(d: Model3SpanDecision): Model3AcceptancePackedSpan {
  return {
    spanId: d.spanId,
    surface: d.surface || '',
    isAnchor: Boolean(d.isAnchor),
    rawStart: d.rawStart ?? -1,
    rawEnd: d.rawEnd ?? -1,
    seqIndex: d.seqIndex ?? 0,
    tokenIds: d.tokenIds ? [...d.tokenIds] : null,
    featVector: d.featVector ? [...d.featVector] : null,
    availMask: d.availMask ? [...d.availMask] : null,
    features: d.features ? { ...d.features } : null,
    rawFirstPassCandidateCount: d.rawFirstPassCandidateCount ?? 0,
    rawPinyinChannelAvail: Boolean(d.rawPinyinChannelAvail),
  };
}

export function buildAcceptanceHashPayload(args: {
  rawAsrText: string;
  pathId?: string;
  pathFineSpans: readonly PathFineSpan[];
  activeCandidates: readonly WindowCandidate[];
  retainedDomains: readonly string[];
  anchors: readonly Model3AnchorMark[];
  packedDecisions: readonly Model3SpanDecision[];
}): Model3AcceptanceUpstreamHashPayload {
  const packedSpans = args.packedDecisions
    .map(buildPackedSpanFromDecision)
    .sort((a, b) => a.spanId.localeCompare(b.spanId) || a.seqIndex - b.seqIndex);

  return {
    schema: MODEL3_ACCEPTANCE_SNAPSHOT_SCHEMA,
    rawAsrText: args.rawAsrText,
    pathId: args.pathId,
    pathFineSpans: args.pathFineSpans.map((s) => ({
      spanId: s.spanId,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
      surface: args.rawAsrText.slice(s.rawStart, s.rawEnd),
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      candidateIds: s.candidates
        .filter((c) => !c.isCovered)
        .map((c) => c.candidateId)
        .sort(),
      candidateCount: s.candidates.filter((c) => !c.isCovered).length,
    })),
    candidateState: args.activeCandidates
      .map((c) => ({
        candidateId: c.candidateId,
        replacement: c.replacement,
        originSpanId: c.originSpanId,
        source: c.source,
        domains: c.domains ? [...c.domains].sort() : undefined,
        isCovered: c.isCovered,
      }))
      .sort((a, b) => a.candidateId.localeCompare(b.candidateId)),
    retainedDomains: [...args.retainedDomains].sort(),
    anchors: args.anchors
      .map((a) => ({
        spanId: a.spanId,
        surface: a.surface,
        rawStart: a.rawStart,
        rawEnd: a.rawEnd,
        source: a.source,
      }))
      .sort((a, b) => a.spanId.localeCompare(b.spanId)),
    packedSpans,
  };
}

export function hashAcceptanceUpstream(payload: Model3AcceptanceUpstreamHashPayload): string {
  return sha256Canonical(payload);
}

export function hashPackedOnly(packedSpans: readonly Model3AcceptancePackedSpan[]): string {
  return sha256Canonical([...packedSpans].sort((a, b) => a.spanId.localeCompare(b.spanId)));
}

export function keepOverrideFromPacked(
  packed: readonly Model3SpanDecision[],
  anchorIds: ReadonlySet<string>
): Model3SpanDecision[] {
  return packed.map((d) => ({
    ...d,
    decision: 'KEEP' as const,
    eligible: !anchorIds.has(d.spanId),
    // Preserve packed tensors / features for symmetrical traces.
    features: d.features ? { ...d.features } : d.features,
    featVector: d.featVector ? [...d.featVector] : d.featVector,
    availMask: d.availMask ? [...d.availMask] : d.availMask,
    tokenIds: d.tokenIds ? [...d.tokenIds] : d.tokenIds,
  }));
}

/** Deep-clone candidates so Retry mutation cannot cross branches. */
export function cloneActiveCandidates(cands: readonly WindowCandidate[]): WindowCandidate[] {
  return structuredClone(cands) as WindowCandidate[];
}

export function clonePathFineSpans(spans: readonly PathFineSpan[]): PathFineSpan[] {
  return structuredClone(spans) as PathFineSpan[];
}
