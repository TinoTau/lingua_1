import type { CandidateLifecycle, CandidateLifecycleLayer } from './v4-diagnostics-types';

export class CandidateLifecycleTracker {
  private readonly entries = new Map<string, CandidateLifecycle>();

  see(candidateId: string, candidateText: string, layer: CandidateLifecycleLayer): void {
    if (!candidateId) {
      return;
    }
    const existing = this.entries.get(candidateId);
    if (!existing) {
      this.entries.set(candidateId, { candidateId, candidateText, firstSeenLayer: layer });
      return;
    }
    if (!existing.candidateText && candidateText) {
      existing.candidateText = candidateText;
    }
  }

  markCovered(childId: string, childText: string, parentId: string): void {
    const existing = this.entries.get(childId) ?? {
      candidateId: childId,
      candidateText: childText,
      firstSeenLayer: 'compatibility' as CandidateLifecycleLayer,
    };
    existing.coverageParentId = parentId;
    existing.lifecycleState = 'covered_by_parent';
    this.entries.set(childId, existing);
  }

  markRevived(candidateId: string, candidateText: string): void {
    const existing = this.entries.get(candidateId) ?? {
      candidateId,
      candidateText,
      firstSeenLayer: 'compatibility' as CandidateLifecycleLayer,
    };
    existing.lifecycleState = 'revived_after_parent_drop';
    existing.coverageParentId = undefined;
    this.entries.set(candidateId, existing);
  }

  markConflictRelationCreated(candidateId: string, candidateText: string): void {
    const existing = this.entries.get(candidateId) ?? {
      candidateId,
      candidateText,
      firstSeenLayer: 'compatibility' as CandidateLifecycleLayer,
    };
    existing.lifecycleState = 'conflict_relation_created';
    this.entries.set(candidateId, existing);
  }

  drop(candidateId: string, candidateText: string, layer: string, reason: string): void {
    if (!candidateId) {
      return;
    }
    const existing = this.entries.get(candidateId) ?? {
      candidateId,
      candidateText,
      firstSeenLayer: 'recall' as CandidateLifecycleLayer,
    };
    if (!existing.firstDroppedLayer) {
      existing.firstDroppedLayer = layer;
      existing.dropReason = reason;
    }
    this.entries.set(candidateId, existing);
  }

  toArray(): CandidateLifecycle[] {
    return [...this.entries.values()];
  }
}
