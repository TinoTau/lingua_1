import type { GraphEdge } from './types';

export type ParentSpanAssemblyResult = {
  edges: GraphEdge[];
  parentSpanCandidateEmittedCount: number;
  parentSpanCandidateSelectedCount: number;
  dominatedPrunedCount: number;
  ruleBRejectedByHoleCount: number;
  parentSpanCoverageAvg: number;
};
