import type { CandidateLifecycle, CandidateLifecycleLayer } from './v4-diagnostics-types';

export class CandidateLifecycleTracker {
  private readonly entries = new Map<string, CandidateLifecycle>();

  see(text: string, layer: CandidateLifecycleLayer): void {
    if (!text) {
      return;
    }
    const existing = this.entries.get(text);
    if (!existing) {
      this.entries.set(text, { candidateText: text, firstSeenLayer: layer });
    }
  }

  drop(text: string, layer: string, reason: string): void {
    if (!text) {
      return;
    }
    const existing = this.entries.get(text) ?? {
      candidateText: text,
      firstSeenLayer: 'recall' as CandidateLifecycleLayer,
    };
    if (!existing.firstDroppedLayer) {
      existing.firstDroppedLayer = layer;
      existing.dropReason = reason;
    }
    this.entries.set(text, existing);
  }

  toArray(): CandidateLifecycle[] {
    return [...this.entries.values()];
  }
}
