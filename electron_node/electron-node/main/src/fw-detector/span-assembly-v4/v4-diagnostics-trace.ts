import { CandidateLifecycleTracker } from './v4-diagnostics-lifecycle';
import type {
  BoundaryWindowTrace,
  CandidatePoolTrace,
  CoarseSpanTrace,
  CombinationTrace,
  CompatibilityEdgeTrace,
  EmittedEdgeTrace,
  RecallHitPreFilterTrace,
  RecallHitTrace,
  SentenceCandidateTrace,
  SpanAssemblyV4TraceDiagnostics,
  TruncatedWindowTrace,
} from './v4-diagnostics-types';
import { V4_TRACE_LIMITS } from './v4-limits';

type TraceBucket =
  | 'coarseSpans'
  | 'boundaryWindows'
  | 'truncatedWindows'
  | 'recallHitsPreFilter'
  | 'recallHits'
  | 'poolBeforeDrop'
  | 'poolAfterDrop'
  | 'compatibilityEdges'
  | 'emittedEdges'
  | 'sentenceCandidates';

const BUCKET_LIMITS: Record<TraceBucket, number> = {
  coarseSpans: V4_TRACE_LIMITS.maxTraceCoarseSpans,
  boundaryWindows: V4_TRACE_LIMITS.maxTraceWindows,
  truncatedWindows: V4_TRACE_LIMITS.maxTraceWindows,
  recallHitsPreFilter: V4_TRACE_LIMITS.maxTraceRecallHits,
  recallHits: V4_TRACE_LIMITS.maxTraceRecallHits,
  poolBeforeDrop: V4_TRACE_LIMITS.maxTraceCandidates,
  poolAfterDrop: V4_TRACE_LIMITS.maxTraceCandidates,
  compatibilityEdges: V4_TRACE_LIMITS.maxTraceEdges,
  emittedEdges: V4_TRACE_LIMITS.maxTraceEdges,
  sentenceCandidates: V4_TRACE_LIMITS.maxTraceSentenceCandidates,
};

export class V4TraceCollector {
  readonly lifecycle = new CandidateLifecycleTracker();
  private traceTruncated = false;
  private traceTruncatedReason?: string;
  private readonly data: Partial<SpanAssemblyV4TraceDiagnostics> = {};

  constructor(
    readonly traceTargetMatched: boolean,
    private readonly combinations: CombinationTrace[] = []
  ) {}

  private canPush(bucket: TraceBucket): boolean {
    const list = (this.data[bucket] as unknown[] | undefined) ?? [];
    if (list.length >= BUCKET_LIMITS[bucket]) {
      this.traceTruncated = true;
      this.traceTruncatedReason = `${bucket}_limit`;
      return false;
    }
    return true;
  }

  private pushItem<T>(bucket: TraceBucket, item: T): void {
    if (!this.canPush(bucket)) {
      return;
    }
    const list = (this.data[bucket] as T[] | undefined) ?? [];
    list.push(item);
    this.data[bucket] = list as never;
  }

  pushCoarseSpan(span: CoarseSpanTrace): void {
    this.pushItem('coarseSpans', span);
  }

  pushBoundaryWindow(window: BoundaryWindowTrace): void {
    this.pushItem('boundaryWindows', window);
  }

  pushTruncatedWindow(window: TruncatedWindowTrace): void {
    this.pushItem('truncatedWindows', window);
  }

  pushRecallHitPreFilter(hit: RecallHitPreFilterTrace): void {
    this.lifecycle.see(hit.replacement, hit.replacement, 'recall');
    if (hit.filterStage === 'min_prior_rejected') {
      this.lifecycle.drop(hit.replacement, hit.replacement, 'min_prior', 'below_min_prior');
    }
    this.pushItem('recallHitsPreFilter', hit);
  }

  pushRecallHit(hit: RecallHitTrace): void {
    this.lifecycle.see(hit.candidateId, hit.replacement, 'recall');
    this.pushItem('recallHits', hit);
  }

  pushPoolBeforeDrop(candidate: CandidatePoolTrace): void {
    this.lifecycle.see(candidate.candidateId, candidate.replacement, 'pool');
    this.pushItem('poolBeforeDrop', candidate);
  }

  pushPoolAfterDrop(candidate: CandidatePoolTrace): void {
    this.lifecycle.see(candidate.candidateId, candidate.replacement, 'pool');
    this.pushItem('poolAfterDrop', candidate);
  }

  pushCompatibilityEdge(edge: CompatibilityEdgeTrace): void {
    this.pushItem('compatibilityEdges', edge);
  }

  pushEmittedEdge(edge: EmittedEdgeTrace): void {
    this.lifecycle.see(edge.replacement, edge.replacement, 'emit');
    this.pushItem('emittedEdges', edge);
  }

  pushSentenceCandidate(candidate: SentenceCandidateTrace): void {
    for (const repl of candidate.replacements) {
      this.lifecycle.see(repl, repl, 'kenlm');
    }
    this.pushItem('sentenceCandidates', candidate);
  }

  pushCombination(combination: CombinationTrace): void {
    if (this.combinations.length >= V4_TRACE_LIMITS.maxTraceCombinations) {
      this.traceTruncated = true;
      this.traceTruncatedReason = 'combinations_limit';
      return;
    }
    for (const token of combination.sentence.match(/[\u4e00-\u9fff]+/g) ?? []) {
      if (token.length >= 2) {
        this.lifecycle.see(token, token, 'kenlm');
      }
    }
    this.combinations.push(combination);
  }

  /** Phase 2 Path Enumeration OPTIONAL fact-only payloads. */
  pushPathEnumerationFacts(
    facts: NonNullable<SpanAssemblyV4TraceDiagnostics['pathEnumerationFacts']>
  ): void {
    this.data.pathEnumerationFacts = facts;
  }

  /** Phase 2 Path Enumeration OPTIONAL cap events. */
  pushPathCapEvents(
    events: NonNullable<SpanAssemblyV4TraceDiagnostics['pathCapEvents']>
  ): void {
    this.data.pathCapEvents = events;
  }

  /** Phase 2 Path Enumeration OPTIONAL per-path facts. */
  pushPathFacts(
    facts: NonNullable<SpanAssemblyV4TraceDiagnostics['pathFacts']>
  ): void {
    this.data.pathFacts = facts;
  }

  toDiagnostics(): SpanAssemblyV4TraceDiagnostics {
    return {
      ...this.data,
      traceTargetMatched: this.traceTargetMatched,
      traceTruncated: this.traceTruncated || undefined,
      traceTruncatedReason: this.traceTruncatedReason,
      candidateLifecycle: this.lifecycle.toArray(),
    };
  }

  getCombinations(): CombinationTrace[] {
    return this.combinations;
  }
}

export function createV4TraceCollector(traceTargetMatched: boolean): V4TraceCollector | null {
  if (!traceTargetMatched) {
    return null;
  }
  return new V4TraceCollector(traceTargetMatched);
}
