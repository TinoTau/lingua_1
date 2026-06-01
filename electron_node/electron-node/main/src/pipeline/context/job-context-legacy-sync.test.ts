import { syncJobContextLegacyPartition } from './job-context-legacy-sync';
import type { JobContext } from './job-context';

describe('job-context-legacy-sync', () => {
  it('mirrors asrRepair fields into legacy.asrRepair partition', () => {
    const ctx = {
      asrRepairLifecycle: { executed: true, gated: false, skipped: false, skipReason: null },
      asrRepairLifecycleSkipReason: 'no_diff_span',
      asrRepairSkipped: true,
      repairSkipReason: 'no_diff_span',
      restoreMetrics: { phonetic_expanded_sentence_candidates_count: 1 },
      sentenceCandidates: [{ text: 'a', candidateSource: 'window_single' }],
      sentenceCandidateTrace: [{ candidateIndex: 0, source: 'window_single' }],
      sentenceRepairDecision: { text: 'a', candidateSource: 'window_single', replacements: [] },
      sentenceRepairExtra: { executed: true, modified: false, candidateSource: null, selectedText: 'a' },
    } as JobContext;

    syncJobContextLegacyPartition(ctx);

    expect(ctx.legacy?.asrRepair?.asrRepairLifecycle?.executed).toBe(true);
    expect(ctx.legacy?.asrRepair?.asrRepairLifecycleSkipReason).toBe('no_diff_span');
    expect(ctx.legacy?.asrRepair?.asrRepairSkipped).toBe(true);
    expect(ctx.legacy?.asrRepair?.repairSkipReason).toBe('no_diff_span');
    expect(ctx.legacy?.asrRepair?.restoreMetrics).toEqual(ctx.restoreMetrics);
  });
});
