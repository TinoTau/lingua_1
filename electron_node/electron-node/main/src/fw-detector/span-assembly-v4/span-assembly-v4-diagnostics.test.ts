import { describe, expect, it } from '@jest/globals';
import { truncateWindows } from './blocked-window-filter';
import type { GlobalWindowDescriptor } from './v4-types';
import { V4TraceCollector } from './v4-diagnostics-trace';
import { resolveV4DiagnosticsConfig } from './v4-diagnostics-config';
import { resolveCompatibilityRelations } from './candidate-compatibility-graph';
import type { WindowCandidate } from './v4-types';
import { buildCombinationTraces } from './v4-diagnostics-mappers';

function makeWindow(overrides: Partial<GlobalWindowDescriptor>): GlobalWindowDescriptor {
  return {
    windowId: '0:2',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowText: '你好',
    windowPinyinKey: 'ni|hao',
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
    ...overrides,
  };
}

describe('span-assembly-v4 diagnostics', () => {
  it('resolveV4DiagnosticsConfig matches targetIds', () => {
    const prev = process.env.NODE_CONFIG_PATH;
    process.env.NODE_CONFIG_PATH = '';
    const cfg = resolveV4DiagnosticsConfig('d001');
    expect(cfg.enabled).toBe(false);
    expect(cfg.traceActive).toBe(false);
    if (prev) {
      process.env.NODE_CONFIG_PATH = prev;
    }
  });

  it('truncateWindows exports truncatedWindows list', () => {
    const windows: GlobalWindowDescriptor[] = [];
    for (let i = 0; i < 130; i += 1) {
      windows.push(
        makeWindow({
          windowId: `${i}:${i + 2}`,
          syllableStart: i,
          syllableEnd: i + 2,
          windowPinyinKey: `k${i}`,
        })
      );
    }
    const { windows: kept, truncatedWindows } = truncateWindows(windows);
    expect(kept.length).toBeLessThan(windows.length);
    expect(truncatedWindows.length).toBeGreaterThan(0);
  });

  it('V4TraceCollector records lifecycle without tone_filter drop on penalized', () => {
    const trace = new V4TraceCollector(true);
    trace.pushRecallHitPreFilter({
      windowId: '10:12',
      windowPinyinKey: 'zhong|bei',
      replacement: '中杯',
      candidateScore: 0.792,
      toneCompatible: false,
      tonePenalty: 0.8,
      toneReason: 'mismatch',
      minPriorPassed: true,
      filterStage: 'tone_penalized',
      sqlReturned: true,
      toneLookupStage: 'tone_exact',
      queryTonePinyinKey: 'zhong1|bei1',
    });
    const out = trace.toDiagnostics();
    const pre = out.recallHitsPreFilter?.[0];
    expect(pre?.toneLookupStage).toBe('tone_exact');
    expect(pre?.queryTonePinyinKey).toBe('zhong1|bei1');
    const life = out.candidateLifecycle?.find((c) => c.candidateText === '中杯');
    expect(life?.candidateId).toBe('中杯');
    expect(life?.firstSeenLayer).toBe('recall');
    expect(life?.firstDroppedLayer).toBeUndefined();
  });

  it('resolveCompatibilityRelations trace records pool before/after without dropping', () => {
    const trace = new V4TraceCollector(true);
    const base: Omit<WindowCandidate, 'candidateId'> = {
      windowId: 'w1',
      windowSource: 'in_span_window',
      anchorCoarseSpanId: 'c0',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
      windowPinyinKey: 'a|b',
      candidateScore: 1,
      score: 1,
      boundaryPenalty: 1,
      candidateRank: 1,
      hitKind: 'exact_term',
      replacement: 'x',
      source: 'base_term',
      recallSource: 'canonical_exact',
      repairTarget: true,
    };
    const a: WindowCandidate = { ...base, candidateId: 'a', replacement: '甲', score: 1 };
    const b: WindowCandidate = {
      ...base,
      candidateId: 'b',
      replacement: '乙',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 2,
    };
    const result = resolveCompatibilityRelations([a, b], trace);
    expect(result.activeCandidates.length).toBe(2);
    expect(result.metrics.hardDropCount).toBe(0);
    expect(result.metrics.conflictRelationCount).toBeGreaterThan(0);
    expect(trace.toDiagnostics().poolBeforeDrop?.length).toBe(2);
    expect(trace.toDiagnostics().poolAfterDrop?.length).toBe(2);
  });

  it('buildCombinationTraces marks picked_raw when delta below threshold', () => {
    const traces = buildCombinationTraces({
      combinations: [
        {
          text: 'sentence-a',
          replacements: [],
          candidateScore: 1,
        },
      ],
      deltas: [0.001],
      minDeltaToReplace: 0.03,
      pickedIsRaw: true,
      candidateRequireRepairTarget: true,
      picked: null,
    });
    expect(traces[0]?.rejectedReason).toBe('picked_raw');
  });
});
