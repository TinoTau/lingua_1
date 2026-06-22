import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION } from './lexicon-types-v2';
import { recallSpanTopKV3 } from './recall-span-topkv3';

jest.mock('./recall-span-topk-v2', () => ({
  recallSpanTopKV2: jest.fn(),
}));

import { recallSpanTopKV2 } from './recall-span-topk-v2';

const mockedRecallSpanTopKV2 = recallSpanTopKV2 as jest.MockedFunction<typeof recallSpanTopKV2>;

function mockRuntime(): LexiconRuntimeV2 {
  return {
    getManifestVersion: () => LEXICON_V3_FIVE_TABLE_V2_RUNTIME_SCHEMA_VERSION,
    lookupParentFragmentsByNgramKey: () => [],
  } as unknown as LexiconRuntimeV2;
}

describe('recallSpanTopKV3 diagnostics passthrough', () => {
  beforeEach(() => {
    mockedRecallSpanTopKV2.mockReset();
  });

  it('mapV2Hit preserves toneLookupStage and V2 result tone fields', () => {
    mockedRecallSpanTopKV2.mockReturnValue({
      hits: [
        {
          hotword: {
            id: 'hw:1',
            word: '中杯',
            normalized: '中杯',
            pinyin: ['zhong', 'bei'],
            priorScore: 0.8,
            frequency: 1,
            enabled: true,
            repairTarget: true,
            tonePinyinKey: 'zhong1|bei1',
          },
          phoneticScore: 1,
          candidateScore: 1.5,
          candidateScoreBreakdown: {
            priorScore: 0.8,
            phoneticSimilarity: 0.5,
            exactLengthBonus: 0.1,
            domainBoost: 0,
            editDistancePenalty: 0,
            fuzzyPenalty: 0,
          },
          source: 'canonical_exact',
          toneLookupStage: 'tone_exact',
          toneCompatible: true,
          tonePenalty: 1,
          toneReason: 'match',
        },
      ],
      maxDomainBoostApplied: 0,
      recallToneCompatibleCount: 1,
      recallToneFallbackCount: 0,
      queryTonePinyinKey: 'zhong1|bei1',
      toneExactHitCount: 1,
      plainFallbackHitCount: undefined,
    });

    const result = recallSpanTopKV3(mockRuntime(), {
      syllables: ['zhong', 'bei'],
      windowText: '中杯',
      termLength: 2,
      topK: 2,
      domainIds: [],
    });

    expect(result.hits[0]!.toneLookupStage).toBe('tone_exact');
    expect(result.queryTonePinyinKey).toBe('zhong1|bei1');
    expect(result.toneExactHitCount).toBe(1);
    expect(result.plainFallbackHitCount).toBeUndefined();
  });
});
