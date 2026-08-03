import type { LexicalEdge } from './build-lexical-edges';

export type {
  PathFineSpan,
  PathFineSpanToneRebindTrace,
  PathFineSpanView,
} from './path-fine-span-types';
export { assertPathFineSpansNonOverlapping } from './path-fine-span-types';

export interface SegmentationPath {
  pathId: string;
  boundaryKey: string;
  edgeRefs: readonly LexicalEdge[];
  lexicalEdgeCount: number;
  fallbackEdgeCount: number;
  structuralEvidence: {
    exactEdgeCount: number;
    toneRelaxedEdgeCount: number;
    fuzzyEdgeCount: number;
  };
}

export interface PrunedSegmentationPathTrace {
  boundaryKey: string;
  pruneStage: 'per_position_cap' | 'complete_path_cap';
  pruneReason: string;
  structuralEvidence: {
    fallbackEdgeCount: number;
    fuzzyEdgeCount: number;
    toneRelaxedEdgeCount: number;
    exactEdgeCount: number;
  };
}

export type PathCapEvent = {
  pruneStage: 'per_position_cap' | 'complete_path_cap';
  position?: number;
  beforeCount: number;
  afterCount: number;
  prunedBoundaryPrefixes: string[];
  reason: string;
};
