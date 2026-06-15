import { CandidateLifecycleTracker } from './v4-diagnostics-lifecycle';
import type {
  BeamSpanSetTrace,
  BoundaryWindowTrace,
  CandidatePoolTrace,
  CoarsePathTrace,
  CoarseSpanTrace,
  CombinationTrace,
  CompatibilityEdgeTrace,
  EmittedEdgeTrace,
  GraphEdgeTrace,
  ParentSpanCandidateTrace,
  RecallHitPreFilterTrace,
  RecallHitTrace,
  SentenceCandidateTrace,
  SkippedRecallWindowTrace,
  SpanAssemblyV4TraceDiagnostics,
  TruncatedWindowTrace,
} from './v4-diagnostics-types';
import { V4_TRACE_LIMITS } from './v4-limits';

type TraceBucket =
  | 'coarseSpans'
  | 'boundaryWindows'
  | 'truncatedWindows'
  | 'skippedRecallWindows'
  | 'recallHitsPreFilter'
  | 'recallHits'
  | 'poolBeforeDrop'
  | 'poolAfterDrop'
  | 'compatibilityEdges'
  | 'emittedParentEvidence'
  | 'emittedEdges'
  | 'emittedParentSpanCandidates'
  | 'graphEdgesAfterMerge'
  | 'coarsePaths'
  | 'beamSpanSets'
  | 'sentenceCandidates';

const BUCKET_LIMITS: Record<TraceBucket, number> = {
  coarseSpans: V4_TRACE_LIMITS.maxTraceCoarseSpans,
  boundaryWindows: V4_TRACE_LIMITS.maxTraceWindows,
  truncatedWindows: V4_TRACE_LIMITS.maxTraceWindows,
  skippedRecallWindows: V4_TRACE_LIMITS.maxTraceWindows,
  recallHitsPreFilter: V4_TRACE_LIMITS.maxTraceRecallHits,
  recallHits: V4_TRACE_LIMITS.maxTraceRecallHits,
  poolBeforeDrop: V4_TRACE_LIMITS.maxTraceCandidates,
  poolAfterDrop: V4_TRACE_LIMITS.maxTraceCandidates,
  compatibilityEdges: V4_TRACE_LIMITS.maxTraceEdges,
  emittedParentEvidence: V4_TRACE_LIMITS.maxTraceEdges,
  emittedEdges: V4_TRACE_LIMITS.maxTraceEdges,
  emittedParentSpanCandidates: V4_TRACE_LIMITS.maxTraceCandidates,
  graphEdgesAfterMerge: V4_TRACE_LIMITS.maxTraceEdges,
  coarsePaths: V4_TRACE_LIMITS.maxTracePaths,
  beamSpanSets: V4_TRACE_LIMITS.maxTraceBeamSpans,
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

  pushSkippedRecallWindow(window: SkippedRecallWindowTrace): void {
    this.pushItem('skippedRecallWindows', window);
  }

  pushRecallHitPreFilter(hit: RecallHitPreFilterTrace): void {
    this.lifecycle.see(hit.replacement, 'recall');
    if (hit.filterStage === 'min_prior_rejected') {
      this.lifecycle.drop(hit.replacement, 'min_prior', 'below_min_prior');
    }
    this.pushItem('recallHitsPreFilter', hit);
  }

  pushRecallHit(hit: RecallHitTrace): void {
    this.lifecycle.see(hit.replacement, 'recall');
    this.pushItem('recallHits', hit);
  }

  pushPoolBeforeDrop(candidate: CandidatePoolTrace): void {
    this.lifecycle.see(candidate.replacement, 'pool');
    this.pushItem('poolBeforeDrop', candidate);
  }

  pushPoolAfterDrop(candidate: CandidatePoolTrace): void {
    this.lifecycle.see(candidate.replacement, 'pool');
    this.pushItem('poolAfterDrop', candidate);
  }

  pushCompatibilityEdge(edge: CompatibilityEdgeTrace): void {
    this.pushItem('compatibilityEdges', edge);
    if (edge.droppedCandidateId && edge.dropReason) {
      const dropped =
        edge.sourceCandidateId === edge.droppedCandidateId
          ? edge.sourceReplacement
          : edge.targetReplacement;
      this.lifecycle.drop(dropped, 'compatibility', edge.dropReason);
    }
  }

  pushEmittedParentEvidence(edge: EmittedEdgeTrace): void {
    this.lifecycle.see(edge.replacement, 'emit');
    this.pushItem('emittedParentEvidence', edge);
  }

  pushEmittedEdge(edge: EmittedEdgeTrace): void {
    this.lifecycle.see(edge.replacement, 'emit');
    this.pushItem('emittedEdges', edge);
  }

  pushEmittedParentSpanCandidate(candidate: ParentSpanCandidateTrace): void {
    this.lifecycle.see(candidate.candidateText, 'assembly');
    this.pushItem('emittedParentSpanCandidates', candidate);
  }

  pushGraphEdge(edge: GraphEdgeTrace): void {
    this.lifecycle.see(edge.replacement, 'graph');
    this.pushItem('graphEdgesAfterMerge', edge);
  }

  pushCoarsePath(path: CoarsePathTrace): void {
    for (const edge of path.edges) {
      this.lifecycle.see(edge.replacement, 'graph');
    }
    this.pushItem('coarsePaths', path);
  }

  pushBeamSpanSet(spanSet: BeamSpanSetTrace): void {
    for (const pick of spanSet.picks) {
      this.lifecycle.see(pick.replacement, 'beam');
    }
    this.pushItem('beamSpanSets', spanSet);
  }

  pushSentenceCandidate(candidate: SentenceCandidateTrace): void {
    for (const repl of candidate.replacements) {
      this.lifecycle.see(repl, 'kenlm');
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
        this.lifecycle.see(token, 'kenlm');
      }
    }
    this.combinations.push(combination);
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
