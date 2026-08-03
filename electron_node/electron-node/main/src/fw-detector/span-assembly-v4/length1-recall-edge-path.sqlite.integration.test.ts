/**
 * Batch 1.0C — call-site / Candidate→Edge→Path / Vote with real Runtime after gate alignment.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { defaultGeneralProfile } from '../../lexicon-v2/profile-registry';
import * as recallV2 from '../../lexicon-v2/recall-span-topk-v2';
import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { buildLexicalEdges } from './build-lexical-edges';
import { latticeHardBlockFilter } from './lattice-hard-block-filter';
import { runPhase1WindowEdgeHarness } from './phase1-window-edge-harness';
import { runPhase2PathHarnessFromLexicalEdges } from './phase2-path-harness';
import { recallTopKForWindows } from './recall-topk-for-windows';
import { makeCharToneFixtures } from './test-tone-fixtures';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import {
  createUtteranceRecallContext,
  releaseUtteranceRecallContext,
} from './utterance-recall-cache';
import type { GlobalWindowDescriptor } from './v4-types';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { V4_LIMITS } from './v4-limits';
import {
  batch10bLimit8Rows,
  batch10bStandardBaseRows,
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from './length1-real-sqlite.test.helpers';

jest.mock('../../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

function makeWindow(
  partial: Partial<GlobalWindowDescriptor> &
    Pick<
      GlobalWindowDescriptor,
      'windowId' | 'syllableStart' | 'syllableEnd' | 'rawStart' | 'rawEnd' | 'windowText' | 'windowPinyinKey'
    >
): GlobalWindowDescriptor {
  return {
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
    ...partial,
  };
}

function span(
  id: string,
  sylStart: number,
  sylEnd: number,
  rawStart: number,
  rawEnd: number,
  text: string
): CoarseSpan {
  return {
    id,
    text,
    rawStart,
    rawEnd,
    syllableStart: sylStart,
    syllableEnd: sylEnd,
    source: 'punctuation_fallback',
    boundaryConfidence: 0.3,
  };
}


function toneArgs(rawText: string, tones: Array<1 | 2 | 3 | 4 | 5>) {
  const fix = makeCharToneFixtures(rawText, tones);
  return {
    toneTimestampOnlyEnabled: true as const,
    acousticSlices: fix.acousticSlices,
    wordTimeSpans: fix.wordTimeSpans,
  };
}

describe('Batch 1.0C Edge/Path/Vote/call-site (SQLite)', () => {
  let bundle: Length1TempBundle | null = null;
  let runtime: LexiconRuntimeV2 | null = null;

  afterEach(() => {
    runtime?.close();
    runtime = null;
    bundle?.cleanup();
    bundle = null;
  });

  function boot(): LexiconRuntimeV2 {
    bundle = createLength1TempSqliteBundle({
      baseRows: batch10bStandardBaseRows(),
      prefix: 'b0c-chain-',
    });
    runtime = bundle.loadRuntime();
    return runtime;
  }

  it('Call-site Integration: length=1 exactTopK=1 domainIds=[] fuzzy=false; no parentFragmentTopK (retired)', () => {
    const rt = boot();
    const spy = jest.spyOn(recallV2, 'recallSpanTopKV2');
    recallTopKForWindows({
      rawText: '我',
      globalSyllables: ['wo'],
      windows: [
        makeWindow({
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          windowText: '我',
          windowPinyinKey: 'wo',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      minPrior: 0.5,
      fuzzyRecallEnabled: true,
      ...toneArgs('我', [3]),
    });
    const arg = spy.mock.calls[0]![1] as {
      topK: number;
      domainIds: readonly string[];
      fuzzyRecallEnabled?: boolean;
      parentFragmentTopK?: number;
    };
    expect(arg.topK).toBe(1);
    expect(arg.domainIds).toEqual([]);
    expect(arg.fuzzyRecallEnabled).toBe(false);
    expect(arg.parentFragmentTopK).toBeUndefined();
    spy.mockRestore();
  });

  it('Call-site Integration: length=2 keeps exactTopK and domainIds', () => {
    const rt = boot();
    const spy = jest.spyOn(recallV2, 'recallSpanTopKV2');
    recallTopKForWindows({
      rawText: '甲乙',
      globalSyllables: ['jia', 'yi'],
      windows: [
        makeWindow({
          windowId: '0:2',
          syllableStart: 0,
          syllableEnd: 2,
          rawStart: 0,
          rawEnd: 2,
          windowText: '甲乙',
          windowPinyinKey: 'jia|yi',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs('甲乙', [3, 3]),
    });
    const arg = spy.mock.calls[0]![1] as {
      topK: number;
      domainIds: readonly string[];
    };
    expect(arg.topK).toBe(V4_LIMITS.exactTopK);
    expect(arg.domainIds).toEqual(['coffee']);
    spy.mockRestore();
  });

  it('does not invoke parent fragment lookup on any window length (API fully retired)', () => {
    const rt = boot();
    expect((rt as unknown as Record<string, unknown>).lookupParentFragmentsByNgramKey).toBeUndefined();
    const recall = recallTopKForWindows({
      rawText: '点',
      globalSyllables: ['dian'],
      windows: [
        makeWindow({
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          windowText: '点',
          windowPinyinKey: 'dian',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      minPrior: 0.5,
      fuzzyRecallEnabled: true,
      ...toneArgs('点', [3]),
    });
    expect(recall.parentFragmentHitCount).toBe(0);
    expect(recall.candidates.every((c) => c.hitKind === 'exact_term')).toBe(true);
  });

  it('Cache Integration: length=1 key dedupe with real Candidate', () => {
    const rt = boot();
    const window = makeWindow({
      windowId: '0:1',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      windowText: '点',
      windowPinyinKey: 'dian',
    });
    const ctx = createUtteranceRecallContext('batch1-0c');
    const first = recallTopKForWindows({
      rawText: '点',
      globalSyllables: ['dian'],
      windows: [window, { ...window }],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['coffee'],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs('点', [3]),
      utteranceRecall: ctx,
    });
    expect(first.logicalWindowRecallCount).toBe(2);
    expect(ctx.stats.uniqueKeyCount).toBe(1);
    expect(ctx.stats.hitCount).toBeGreaterThanOrEqual(1);
    expect(first.candidates.length).toBeGreaterThanOrEqual(1);
    expect(first.candidates[0]!.replacement).toBe('点');
    expect(first.candidates[0]!.source).toBe('base_term');
    expect(first.candidates[0]!.domains ?? []).toEqual([]);
    expect(first.candidates[0]!.repairTarget).toBe(false);
    releaseUtteranceRecallContext(ctx);
  });

  it('Edge/Path Integration: length=1 Candidate→Edge→retained Path (点)', () => {
    const rt = boot();
    const rawText = '点';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const window = makeWindow({
      windowId: '0:1',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      windowText: '点',
      windowPinyinKey: 'dian',
    });
    const recall = recallTopKForWindows({
      rawText,
      globalSyllables: [...coordinate.syllables],
      windows: [window],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs(rawText, [3]),
    });
    expect(recall.candidates).toHaveLength(1);
    expect(recall.candidates[0]!.source).toBe('base_term');
    const edges = buildLexicalEdges({
      recalledWindows: [
        {
          windowId: window.windowId,
          syllableStart: 0,
          syllableEnd: 1,
          candidates: recall.candidates,
        },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.edgeKind).toBe('lexical');
    expect(edges[0]!.syllableEnd - edges[0]!.syllableStart).toBe(1);
    const pathOut = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: 'b0c-path-l1',
      rawText,
      coordinate,
      syllableCount: 1,
      lexicalEdges: edges,
    });
    expect(pathOut.retainedCompletePathCount).toBeGreaterThanOrEqual(1);
    expect(pathOut.diagnostics.singleCharLexicalEdgeCount).toBe(1);
    expect(pathOut.diagnostics.singleCharLexicalEdgeUsedCount).toBeGreaterThanOrEqual(1);
  });

  it('Batch 1.1A: truncated false-unique seed yields no Candidate / no lexical Edge', () => {
    bundle = createLength1TempSqliteBundle({
      baseRows: batch10bLimit8Rows(),
      prefix: 'b11a-edge-lim-',
    });
    runtime = bundle.loadRuntime();
    const rawText = '零';
    const window = makeWindow({
      windowId: '0:1',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      windowText: '零',
      windowPinyinKey: 'lim',
    });
    const recall = recallTopKForWindows({
      rawText,
      globalSyllables: ['lim'],
      windows: [window],
      runtime,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs(rawText, [1]),
    });
    expect(recall.candidates).toHaveLength(0);
    const edges = buildLexicalEdges({
      recalledWindows: [
        {
          windowId: window.windowId,
          syllableStart: 0,
          syllableEnd: 1,
          candidates: recall.candidates,
        },
      ],
    });
    expect(edges).toHaveLength(0);
    const vote = voteUtteranceDomainFromPool([{ candidates: recall.candidates }]);
    expect(Object.keys(vote.domainScores)).toHaveLength(0);
  });

  it('Edge/Path Integration: length=1 mid-span 丙 with length=2 bridges', () => {
    const rt = boot();
    const rawText = '甲乙丙丁戊';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const windows = [
      makeWindow({
        windowId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        rawStart: 0,
        rawEnd: 2,
        windowText: '甲乙',
        windowPinyinKey: 'jia|yi',
      }),
      makeWindow({
        windowId: '2:3',
        syllableStart: 2,
        syllableEnd: 3,
        rawStart: 2,
        rawEnd: 3,
        windowText: '丙',
        windowPinyinKey: 'bing',
      }),
      makeWindow({
        windowId: '3:5',
        syllableStart: 3,
        syllableEnd: 5,
        rawStart: 3,
        rawEnd: 5,
        windowText: '丁戊',
        windowPinyinKey: 'ding|wu',
      }),
    ];
    const recall = recallTopKForWindows({
      rawText,
      globalSyllables: [...coordinate.syllables],
      windows,
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs(rawText, [3, 3, 3, 1, 4]),
    });
    expect(recall.candidates.some((c) => c.replacement === '丙' && c.source === 'base_term')).toBe(
      true
    );
    expect(recall.candidates.some((c) => c.replacement === '甲乙')).toBe(true);
    expect(recall.candidates.some((c) => c.replacement === '丁戊')).toBe(true);

    const byWindow = new Map<string, typeof recall.candidates>();
    for (const c of recall.candidates) {
      const list = byWindow.get(c.windowId) ?? [];
      list.push(c);
      byWindow.set(c.windowId, list);
    }
    const edges = buildLexicalEdges({
      recalledWindows: windows
        .map((w) => ({
          windowId: w.windowId,
          syllableStart: w.syllableStart,
          syllableEnd: w.syllableEnd,
          candidates: byWindow.get(w.windowId) ?? [],
        }))
        .filter((b) => b.candidates.length > 0),
    });
    expect(edges.some((e) => e.syllableEnd - e.syllableStart === 1)).toBe(true);
    const pathOut = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: 'b0c-path-bridge',
      rawText,
      coordinate,
      syllableCount: 5,
      lexicalEdges: edges,
    });
    expect(pathOut.retainedCompletePathCount).toBeGreaterThanOrEqual(1);
    expect(pathOut.diagnostics.singleCharLexicalEdgeUsedCount).toBeGreaterThanOrEqual(1);
  });

  it('Vote Integration: base 单字 vote=0; domain 多字 votes', () => {
    const rt = boot();
    const charRecall = recallTopKForWindows({
      rawText: '点',
      globalSyllables: ['dian'],
      windows: [
        makeWindow({
          windowId: '0:1',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          windowText: '点',
          windowPinyinKey: 'dian',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs('点', [3]),
    });
    expect(charRecall.candidates).toHaveLength(1);
    expect(charRecall.candidates[0]!.source).toBe('base_term');
    expect(charRecall.candidates[0]!.domains ?? []).toEqual([]);

    const voteBaseOnly = voteUtteranceDomainFromPool([{ candidates: charRecall.candidates }]);
    expect(Object.keys(voteBaseOnly.domainScores)).toHaveLength(0);

    const domRecall = recallTopKForWindows({
      rawText: '高速',
      globalSyllables: ['gao', 'su'],
      windows: [
        makeWindow({
          windowId: '0:2',
          syllableStart: 0,
          syllableEnd: 2,
          rawStart: 0,
          rawEnd: 2,
          windowText: '高速',
          windowPinyinKey: 'gao|su',
        }),
      ],
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: ['tourism_transport'],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs('高速', [1, 4]),
    });
    const domainCand = domRecall.candidates.find((c) => c.source === 'domain_term');
    expect(domainCand).toBeDefined();
    const vote = voteUtteranceDomainFromPool([
      { candidates: charRecall.candidates },
      { candidates: [domainCand!] },
    ]);
    expect(vote.domainScores).not.toHaveProperty('base_term');
    expect(vote.domainScores.tourism_transport).toBe(1);
  });

  it('Diagnostics: singleChar* counters non-zero on real length=1 windows', () => {
    const rt = boot();
    const rawText = '点';
    const out = runPhase1WindowEdgeHarness({
      rawText,
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      // coarseSpans provided → partitionCoarseSpans not invoked; stubs unused.
      imeConfig: { maxSpanLen: 5 } as never,
      dict: { entries: [] } as never,
      coarseSpans: [span('c0', 0, 1, 0, 1, '点')],
      ...toneArgs(rawText, [3]),
    });
    expect(out.diagnostics.singleCharWindowCount).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharRecallCount).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharHitCount).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharCandidateCount).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharLexicalEdgeCount).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharCandidateCapHitCount).toBeGreaterThanOrEqual(1);
  });

  it('Hard-block allow + length=1 Recall Candidate (吗)', () => {
    const rt = boot();
    const rawText = '你要吗？';
    const coarse = [span('c0', 0, 3, 0, 3, '你要吗')];
    const windows = [
      makeWindow({
        windowId: '2:3',
        syllableStart: 2,
        syllableEnd: 3,
        rawStart: 2,
        rawEnd: 3,
        windowText: '吗',
        windowPinyinKey: 'ma',
      }),
    ];
    const filtered = latticeHardBlockFilter({ windows, rawText, coarseSpans: coarse });
    expect(filtered[0]!.blocked).toBe(false);
    const recall = recallTopKForWindows({
      rawText,
      globalSyllables: ['ni', 'yao', 'ma'],
      windows: filtered.filter((w) => !w.blocked),
      runtime: rt,
      profile: defaultGeneralProfile(),
      domainIds: [],
      minPrior: 0.5,
      fuzzyRecallEnabled: false,
      ...toneArgs(rawText, [3, 4, 5, 1]),
    });
    expect(recall.candidates.some((c) => c.replacement === '吗' && c.source === 'base_term')).toBe(
      true
    );
  });
});
