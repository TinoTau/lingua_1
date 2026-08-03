/**
 * B1 — Recall Core full traversal (no attempt budget gate).
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor } from './v4-types';

jest.mock('../../lexicon-v2/recall-span-topk-v2', () => ({
  recallSpanTopKV2: () => ({
    hits: [],
    queryTonePinyinKey: undefined,
    recallToneCompatibleCount: 0,
    recallToneFallbackCount: 0,
    toneExactHitCount: 0,
    plainFallbackHitCount: 0,
  }),
}));

// Import after mock so recallTopKForWindows picks up stubbed recallSpanTopKV2.
const { recallTopKForWindows } = require('./recall-topk-for-windows') as typeof import('./recall-topk-for-windows');

function fakeWindow(start: number, end: number): GlobalWindowDescriptor {
  return {
    windowId: `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    rawStart: start,
    rawEnd: end,
    windowText: '测'.repeat(Math.max(1, end - start)),
    windowPinyinKey: Array.from({ length: end - start }, () => 'ce').join('|'),
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
  };
}

function stubRuntime(): LexiconRuntimeV2 {
  return {
    getManifestVersion: () => 'test',
    getPhysicalStatementStats: () => ({ total: 0 }),
  } as unknown as LexiconRuntimeV2;
}

function stubProfile(): ActiveLexiconProfileSnapshot {
  return {} as ActiveLexiconProfileSnapshot;
}

describe('B1 recallTopKForWindows full traversal', () => {
  it('does not keep maxSqlPerUtterance on V4_LIMITS', () => {
    expect('maxSqlPerUtterance' in V4_LIMITS).toBe(false);
  });

  it.each([0, 1, 150, 151, 165])(
    'logicalWindowRecallCount equals input length for %i windows',
    (n) => {
      const windows = Array.from({ length: n }, (_, i) => fakeWindow(i, Math.min(i + 1, i + 1)));
      const globalSyllables = Array.from({ length: Math.max(n, 1) }, () => 'ce');
      const result = recallTopKForWindows({
        rawText: '测'.repeat(Math.max(n, 1)),
        globalSyllables,
        windows,
        runtime: stubRuntime(),
        profile: stubProfile(),
        domainIds: [],
        minPrior: 0,
        fuzzyRecallEnabled: false,
        toneTimestampOnlyEnabled: false,
      });
      expect(result.logicalWindowRecallCount).toBe(n);
      expect(result).not.toHaveProperty('ngramQueryCount');
    }
  );
});
