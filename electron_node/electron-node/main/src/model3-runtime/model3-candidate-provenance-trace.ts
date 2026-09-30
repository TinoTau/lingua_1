/**
 * TRACE-ONLY candidate provenance collector (MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION).
 *
 * Observation side-channel only. Must not mutate caller inputs or change business outputs.
 * Gated by MODEL3_CANDIDATE_PROVENANCE_TRACE=1 (explicit).
 */

import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import type { RecallSpanTopKV2Hit } from '../lexicon-v2/recall-span-topk-v2';

export const CANDIDATE_PROVENANCE_TRACE_ENV = 'MODEL3_CANDIDATE_PROVENANCE_TRACE';

export type CandidateProvenanceStageName =
  | 'RAW_RECALL'
  | 'MATERIALIZED'
  | 'MERGE_PER_SPAN'
  | 'POST_RETRY_WORKING'
  | 'PRE_ASSEMBLY_POOL'
  | 'ASSEMBLY_INPUT_SELECTED'
  | 'ASSEMBLY_SENTENCES'
  | 'CROSS_PATH_MERGE'
  | 'KENLM_POOL';

export type CandidateProvenanceDropReason =
  | 'RANK_LIMIT'
  | 'DEDUP_EQUIVALENT'
  | 'DOMAIN_BUCKET_MISMATCH'
  | 'SPAN_CONFLICT'
  | 'PATH_FILTER'
  | 'CANDIDATE_CAP'
  | 'INVALID_LENGTH'
  | 'NO_ASSEMBLY_SLOT'
  | 'UNRESOLVED_DROP_REASON';

export type ProvenanceCandidateSnapshot = {
  candidateId: string;
  surface: string;
  score: number;
  domains: readonly string[];
  originSpanId: string | null;
  rawStart: number;
  rawEnd: number;
  source: string;
  rank: number;
  stage: CandidateProvenanceStageName;
};

export type ProvenanceRemovedEntry = {
  id: string;
  surface: string;
  reason: CandidateProvenanceDropReason;
};

export type ProvenanceStageEvent = {
  stage: CandidateProvenanceStageName;
  pathId?: string;
  regionId?: string;
  spanId?: string;
  inputIds: readonly string[];
  outputIds: readonly string[];
  removed: readonly ProvenanceRemovedEntry[];
  meta?: Record<string, unknown>;
};

export type PathProvenanceBag = {
  pathId: string;
  stages: ProvenanceStageEvent[];
  rawRecalls: Array<{
    regionId: string;
    query: Record<string, unknown>;
    hits: ProvenanceCandidateSnapshot[];
  }>;
  materialized: Array<{
    regionId: string;
    candidates: ProvenanceCandidateSnapshot[];
  }>;
  mergePerSpan: Array<{
    spanId: string;
    before: ProvenanceCandidateSnapshot[];
    retry: ProvenanceCandidateSnapshot[];
    after: ProvenanceCandidateSnapshot[];
    perSpanCap: number;
    removed: ProvenanceRemovedEntry[];
  }>;
  postRetryWorking?: ProvenanceCandidateSnapshot[];
  preAssembly?: ProvenanceCandidateSnapshot[];
  assemblyInputSelected?: ProvenanceCandidateSnapshot[];
  assemblySentences?: readonly string[];
};

export type UtteranceProvenanceBag = {
  stages: ProvenanceStageEvent[];
  crossPath?: {
    inputTexts: readonly string[];
    outputTexts: readonly string[];
    removed: readonly ProvenanceRemovedEntry[];
    globalCap: number;
  };
  kenlmPool?: readonly string[];
};

type PathBag = {
  pathId: string;
  stages: ProvenanceStageEvent[];
  rawRecalls: PathProvenanceBag['rawRecalls'];
  materialized: PathProvenanceBag['materialized'];
  mergePerSpan: PathProvenanceBag['mergePerSpan'];
  postRetryWorking?: ProvenanceCandidateSnapshot[];
  preAssembly?: ProvenanceCandidateSnapshot[];
  assemblyInputSelected?: ProvenanceCandidateSnapshot[];
  assemblySentences?: string[];
};

const pathBags = new Map<string, PathBag>();
let utteranceBag: UtteranceProvenanceBag | null = null;

export function isCandidateProvenanceTraceEnabled(): boolean {
  return process.env[CANDIDATE_PROVENANCE_TRACE_ENV] === '1';
}

function copyDomains(domains: readonly string[] | undefined): string[] {
  return domains ? [...domains] : [];
}

function candidateKey(c: {
  termId?: string;
  replacement?: string;
  surface?: string;
  rawStart?: number;
  rawEnd?: number;
}): string {
  if (c.termId) return `tid:${c.termId}`;
  const surface = c.replacement ?? c.surface ?? '';
  return `surf:${surface}:${c.rawStart ?? 0}:${c.rawEnd ?? 0}`;
}

export function snapshotWindowCandidate(
  c: WindowCandidate,
  rank: number,
  stage: CandidateProvenanceStageName
): ProvenanceCandidateSnapshot {
  return {
    candidateId: String(c.candidateId),
    surface: String(c.replacement ?? ''),
    score: Number(c.candidateScore ?? c.score ?? 0),
    domains: copyDomains(c.domains),
    originSpanId: c.originSpanId ?? null,
    rawStart: c.rawStart,
    rawEnd: c.rawEnd,
    source: String(c.source ?? c.recallSource ?? ''),
    rank,
    stage,
  };
}

export function snapshotRecallHit(
  hit: RecallSpanTopKV2Hit,
  rank: number,
  stage: CandidateProvenanceStageName = 'RAW_RECALL'
): ProvenanceCandidateSnapshot {
  const surface = String(hit.hotword?.word ?? '');
  const termId =
    hit.hotword?.id != null && String(hit.hotword.id).length > 0
      ? String(hit.hotword.id)
      : undefined;
  return {
    candidateId: termId ? `tid:${termId}` : `raw:${rank}:${surface}`,
    surface,
    score: Number(hit.candidateScore ?? 0),
    domains: copyDomains(hit.hotword?.domains),
    originSpanId: null,
    rawStart: -1,
    rawEnd: -1,
    source: String(hit.source ?? ''),
    rank,
    stage,
  };
}

function copySnapshots(
  list: readonly ProvenanceCandidateSnapshot[]
): ProvenanceCandidateSnapshot[] {
  return list.map((c) => ({
    ...c,
    domains: [...c.domains],
  }));
}

function ensurePathBag(pathId: string): PathBag {
  let bag = pathBags.get(pathId);
  if (!bag) {
    bag = {
      pathId,
      stages: [],
      rawRecalls: [],
      materialized: [],
      mergePerSpan: [],
    };
    pathBags.set(pathId, bag);
  }
  return bag;
}

function ensureUtteranceBag(): UtteranceProvenanceBag {
  if (!utteranceBag) {
    utteranceBag = { stages: [] };
  }
  return utteranceBag;
}

export function beginPathProvenance(pathId: string): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  pathBags.set(pathId, {
    pathId,
    stages: [],
    rawRecalls: [],
    materialized: [],
    mergePerSpan: [],
  });
}

export function beginUtteranceProvenance(): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  utteranceBag = { stages: [] };
}

/**
 * Classify merge removals to mirror mergeSpanCandidates (existing-first dedup + score sort + slice).
 * Does not mutate inputs.
 */
export function classifyMergeDropReasons(
  before: readonly WindowCandidate[],
  retry: readonly WindowCandidate[],
  after: readonly WindowCandidate[],
  perSpanCap: number
): ProvenanceRemovedEntry[] {
  const beforeKeys = new Set(before.map((c) => candidateKey(c)));
  const afterIds = new Set(after.map((c) => String(c.candidateId)));
  const afterKeys = new Set(after.map((c) => candidateKey(c)));

  const byKey = new Map<string, WindowCandidate>();
  for (const c of before) {
    const k = candidateKey(c);
    if (!byKey.has(k)) byKey.set(k, c);
  }
  const dedupDroppedRetry: WindowCandidate[] = [];
  for (const c of retry) {
    const k = candidateKey(c);
    if (!byKey.has(k)) {
      byKey.set(k, c);
    } else {
      dedupDroppedRetry.push(c);
    }
  }
  const sorted = [...byKey.values()].sort(
    (a, b) =>
      (b.candidateScore ?? b.score ?? 0) - (a.candidateScore ?? a.score ?? 0) ||
      String(a.candidateId).localeCompare(String(b.candidateId))
  );
  const kept = sorted.slice(0, perSpanCap);
  const keptIds = new Set(kept.map((c) => String(c.candidateId)));
  const rankDropped = sorted.slice(perSpanCap);

  const removed: ProvenanceRemovedEntry[] = [];
  const seen = new Set<string>();

  for (const c of dedupDroppedRetry) {
    const id = String(c.candidateId);
    if (seen.has(id) || afterIds.has(id)) continue;
    seen.add(id);
    removed.push({
      id,
      surface: String(c.replacement ?? ''),
      reason: 'DEDUP_EQUIVALENT',
    });
  }

  for (const c of rankDropped) {
    const id = String(c.candidateId);
    if (seen.has(id) || afterIds.has(id)) continue;
    seen.add(id);
    removed.push({
      id,
      surface: String(c.replacement ?? ''),
      reason: 'RANK_LIMIT',
    });
  }

  // Any remaining missing from after that we cannot classify via the merge mirror.
  for (const c of [...before, ...retry]) {
    const id = String(c.candidateId);
    if (afterIds.has(id) || afterKeys.has(candidateKey(c)) || seen.has(id)) continue;
    if (beforeKeys.has(candidateKey(c)) && keptIds.has(id)) continue;
    seen.add(id);
    removed.push({
      id,
      surface: String(c.replacement ?? ''),
      reason: 'UNRESOLVED_DROP_REASON',
    });
  }

  return removed;
}

export function recordRawRecall(
  pathId: string,
  regionId: string,
  query: Record<string, unknown>,
  hits: readonly RecallSpanTopKV2Hit[] | readonly ProvenanceCandidateSnapshot[]
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const snapHits: ProvenanceCandidateSnapshot[] = Array.isArray(hits)
    ? hits.map((h, i) => {
        if (h && typeof h === 'object' && 'hotword' in (h as object)) {
          return snapshotRecallHit(h as RecallSpanTopKV2Hit, i + 1);
        }
        const s = h as ProvenanceCandidateSnapshot;
        return {
          ...s,
          domains: [...(s.domains ?? [])],
          stage: 'RAW_RECALL',
          rank: s.rank ?? i + 1,
        };
      })
    : [];
  const queryCopy: Record<string, unknown> = { ...query };
  if (Array.isArray(query.syllables)) queryCopy.syllables = [...(query.syllables as unknown[])];
  if (Array.isArray(query.retainedDomains)) {
    queryCopy.retainedDomains = [...(query.retainedDomains as unknown[])];
  }
  bag.rawRecalls.push({
    regionId,
    query: queryCopy,
    hits: snapHits,
  });
  bag.stages.push({
    stage: 'RAW_RECALL',
    pathId,
    regionId,
    inputIds: [],
    outputIds: snapHits.map((h) => h.candidateId),
    removed: [],
    meta: { query: queryCopy, hitCount: snapHits.length },
  });
}

export function recordMaterialized(
  pathId: string,
  regionId: string,
  cands: readonly WindowCandidate[]
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const snaps = cands.map((c, i) => snapshotWindowCandidate(c, i + 1, 'MATERIALIZED'));
  bag.materialized.push({ regionId, candidates: snaps });
  bag.stages.push({
    stage: 'MATERIALIZED',
    pathId,
    regionId,
    inputIds: [],
    outputIds: snaps.map((c) => c.candidateId),
    removed: [],
  });
}

export function recordMergePerSpan(
  pathId: string,
  spanId: string,
  before: readonly WindowCandidate[],
  retry: readonly WindowCandidate[],
  after: readonly WindowCandidate[],
  perSpanCap: number
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const beforeSnaps = before.map((c, i) => snapshotWindowCandidate(c, i + 1, 'MERGE_PER_SPAN'));
  const retrySnaps = retry.map((c, i) => snapshotWindowCandidate(c, i + 1, 'MERGE_PER_SPAN'));
  const afterSnaps = after.map((c, i) => snapshotWindowCandidate(c, i + 1, 'MERGE_PER_SPAN'));
  const removed = classifyMergeDropReasons(before, retry, after, perSpanCap);
  bag.mergePerSpan.push({
    spanId,
    before: beforeSnaps,
    retry: retrySnaps,
    after: afterSnaps,
    perSpanCap,
    removed,
  });
  bag.stages.push({
    stage: 'MERGE_PER_SPAN',
    pathId,
    spanId,
    inputIds: [...beforeSnaps, ...retrySnaps].map((c) => c.candidateId),
    outputIds: afterSnaps.map((c) => c.candidateId),
    removed,
    meta: { perSpanCap },
  });
}

export function recordPostRetryWorking(
  pathId: string,
  cands: readonly WindowCandidate[]
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const snaps = cands.map((c, i) => snapshotWindowCandidate(c, i + 1, 'POST_RETRY_WORKING'));
  bag.postRetryWorking = snaps;
  bag.stages.push({
    stage: 'POST_RETRY_WORKING',
    pathId,
    inputIds: [],
    outputIds: snaps.map((c) => c.candidateId),
    removed: [],
  });
}

export function recordPreAssembly(
  pathId: string,
  candidates: readonly WindowCandidate[] | readonly { candidateId?: string; surface?: string; replacement?: string }[]
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const snaps: ProvenanceCandidateSnapshot[] = candidates.map((c, i) => {
    if (c && typeof c === 'object' && 'replacement' in c && 'rawStart' in c) {
      return snapshotWindowCandidate(c as WindowCandidate, i + 1, 'PRE_ASSEMBLY_POOL');
    }
    const loose = c as { candidateId?: string; surface?: string; replacement?: string };
    return {
      candidateId: String(loose.candidateId ?? `pre:${i + 1}`),
      surface: String(loose.surface ?? loose.replacement ?? ''),
      score: 0,
      domains: [],
      originSpanId: null,
      rawStart: -1,
      rawEnd: -1,
      source: '',
      rank: i + 1,
      stage: 'PRE_ASSEMBLY_POOL' as const,
    };
  });
  bag.preAssembly = snaps;
  bag.stages.push({
    stage: 'PRE_ASSEMBLY_POOL',
    pathId,
    inputIds: [],
    outputIds: snaps.map((c) => c.candidateId),
    removed: [],
  });
}

/**
 * Observation-only: Assembly span picks after domain filter + per-span budget (pre sentence gen).
 * Diff vs PRE_ASSEMBLY_POOL surfaces → DOMAIN_BUCKET_MISMATCH / RANK_LIMIT / UNRESOLVED.
 */
export function recordAssemblyInputSelected(
  pathId: string,
  picks: readonly { word: string; span?: { start: number; end: number }; domains?: readonly string[] }[],
  preAssemblySurfaces?: readonly string[]
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const snaps: ProvenanceCandidateSnapshot[] = picks.map((p, i) => ({
    candidateId: `asm-in:${p.span?.start ?? -1}-${p.span?.end ?? -1}:${p.word}:${i}`,
    surface: p.word,
    score: 0,
    domains: p.domains ? [...p.domains] : [],
    originSpanId: null,
    rawStart: p.span?.start ?? -1,
    rawEnd: p.span?.end ?? -1,
    source: 'assembly_input_selected',
    rank: i + 1,
    stage: 'ASSEMBLY_INPUT_SELECTED' as const,
  }));
  bag.assemblyInputSelected = snaps;
  const selectedSet = new Set(snaps.map((s) => s.surface));
  const removed: ProvenanceRemovedEntry[] = [];
  if (preAssemblySurfaces) {
    for (const surf of preAssemblySurfaces) {
      if (!selectedSet.has(surf)) {
        removed.push({
          id: `asm-drop:${surf}`,
          surface: surf,
          reason: 'DOMAIN_BUCKET_MISMATCH',
        });
      }
    }
  }
  bag.stages.push({
    stage: 'ASSEMBLY_INPUT_SELECTED',
    pathId,
    inputIds: preAssemblySurfaces ? preAssemblySurfaces.map((s, i) => `pre:${i}:${s}`) : [],
    outputIds: snaps.map((c) => c.candidateId),
    removed,
  });
}

export function recordAssemblySentences(pathId: string, texts: readonly string[]): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensurePathBag(pathId);
  const copied = [...texts];
  bag.assemblySentences = copied;
  bag.stages.push({
    stage: 'ASSEMBLY_SENTENCES',
    pathId,
    inputIds: [],
    outputIds: copied.map((t, i) => `sent:${i}:${t}`),
    removed: [],
    meta: { texts: copied },
  });
}

export function recordCrossPathMerge(
  inputTexts: readonly string[],
  outputTexts: readonly string[],
  globalCap: number
): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensureUtteranceBag();
  const input = [...inputTexts];
  const output = [...outputTexts];
  const outSet = new Set(output);
  const removed: ProvenanceRemovedEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const text = input[i]!;
    if (outSet.has(text)) continue;
    if (seen.has(text)) {
      removed.push({ id: `xpath:${i}:${text}`, surface: text, reason: 'DEDUP_EQUIVALENT' });
      continue;
    }
    seen.add(text);
    // Prefer DEDUP when duplicate earlier in input; else RANK_LIMIT when past cap of unique.
    const firstIdx = input.indexOf(text);
    if (firstIdx >= 0 && firstIdx < i) {
      removed.push({ id: `xpath:${i}:${text}`, surface: text, reason: 'DEDUP_EQUIVALENT' });
    } else {
      removed.push({
        id: `xpath:${i}:${text}`,
        surface: text,
        reason: output.length >= globalCap ? 'RANK_LIMIT' : 'UNRESOLVED_DROP_REASON',
      });
    }
  }
  bag.crossPath = { inputTexts: input, outputTexts: output, removed, globalCap };
  bag.stages.push({
    stage: 'CROSS_PATH_MERGE',
    inputIds: input.map((t, i) => `xpath-in:${i}:${t}`),
    outputIds: output.map((t, i) => `xpath-out:${i}:${t}`),
    removed,
    meta: { globalCap },
  });
}

export function recordKenlmPool(texts: readonly string[]): void {
  if (!isCandidateProvenanceTraceEnabled()) return;
  const bag = ensureUtteranceBag();
  const copied = [...texts];
  bag.kenlmPool = copied;
  bag.stages.push({
    stage: 'KENLM_POOL',
    inputIds: [],
    outputIds: copied.map((t, i) => `kenlm:${i}:${t}`),
    removed: [],
    meta: { texts: copied },
  });
}

function freezePathBag(bag: PathBag): PathProvenanceBag {
  return {
    pathId: bag.pathId,
    stages: bag.stages.map((s) => ({
      ...s,
      inputIds: [...s.inputIds],
      outputIds: [...s.outputIds],
      removed: s.removed.map((r) => ({ ...r })),
      meta: s.meta ? { ...s.meta } : undefined,
    })),
    rawRecalls: bag.rawRecalls.map((r) => ({
      regionId: r.regionId,
      query: { ...r.query },
      hits: copySnapshots(r.hits),
    })),
    materialized: bag.materialized.map((m) => ({
      regionId: m.regionId,
      candidates: copySnapshots(m.candidates),
    })),
    mergePerSpan: bag.mergePerSpan.map((m) => ({
      spanId: m.spanId,
      before: copySnapshots(m.before),
      retry: copySnapshots(m.retry),
      after: copySnapshots(m.after),
      perSpanCap: m.perSpanCap,
      removed: m.removed.map((r) => ({ ...r })),
    })),
    postRetryWorking: bag.postRetryWorking
      ? copySnapshots(bag.postRetryWorking)
      : undefined,
    preAssembly: bag.preAssembly ? copySnapshots(bag.preAssembly) : undefined,
    assemblyInputSelected: bag.assemblyInputSelected
      ? copySnapshots(bag.assemblyInputSelected)
      : undefined,
    assemblySentences: bag.assemblySentences ? [...bag.assemblySentences] : undefined,
  };
}

export function snapshotPathProvenance(pathId: string): PathProvenanceBag | null {
  if (!isCandidateProvenanceTraceEnabled()) return null;
  const bag = pathBags.get(pathId);
  if (!bag) return null;
  return freezePathBag(bag);
}

export function takePathProvenance(pathId: string): PathProvenanceBag | null {
  if (!isCandidateProvenanceTraceEnabled()) return null;
  const bag = pathBags.get(pathId);
  if (!bag) return null;
  const out = freezePathBag(bag);
  pathBags.delete(pathId);
  return out;
}

export function takeUtteranceProvenance(): UtteranceProvenanceBag | null {
  if (!isCandidateProvenanceTraceEnabled()) return null;
  if (!utteranceBag) return null;
  const out: UtteranceProvenanceBag = {
    stages: utteranceBag.stages.map((s) => ({
      ...s,
      inputIds: [...s.inputIds],
      outputIds: [...s.outputIds],
      removed: s.removed.map((r) => ({ ...r })),
      meta: s.meta ? { ...s.meta } : undefined,
    })),
    crossPath: utteranceBag.crossPath
      ? {
          inputTexts: [...utteranceBag.crossPath.inputTexts],
          outputTexts: [...utteranceBag.crossPath.outputTexts],
          removed: utteranceBag.crossPath.removed.map((r) => ({ ...r })),
          globalCap: utteranceBag.crossPath.globalCap,
        }
      : undefined,
    kenlmPool: utteranceBag.kenlmPool ? [...utteranceBag.kenlmPool] : undefined,
  };
  utteranceBag = null;
  return out;
}

/** Test helper — clear module bags between cases. */
export function resetCandidateProvenanceCollectorForTests(): void {
  pathBags.clear();
  utteranceBag = null;
}
