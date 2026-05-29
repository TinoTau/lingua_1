import { describe, expect, it, jest } from '@jest/globals';
import type { KenLMScorer } from '../asr-repair/sentence-rerank/types';
import type { LexiconRuntime } from '../lexicon/lexicon-runtime';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { runFwTopKDecisionPipeline } from './fw-topk-decision-pipeline';
import type { FwSpanDiagnostics } from './types';

jest.mock('../lexicon/local-span-recall', () => ({
  recallSpanTopK: jest.fn(() => ({
    hits: [
      {
        word: '咖啡店',
        priorScore: 0.6,
        candidateScore: 0.6,
        phoneticScore: 0.5,
        source: 'pinyin',
        domains: ['restaurant'],
        repairTarget: true,
      },
      {
        word: '咖啡馆',
        priorScore: 0.9,
        candidateScore: 0.9,
        phoneticScore: 0.85,
        source: 'pinyin',
        domains: ['restaurant'],
        repairTarget: true,
      },
    ],
  })),
}));

describe('runFwTopKDecisionPipeline', () => {
  it('picks non-recall-order winner by finalScore when KenLM disabled', async () => {
    const spans: FwSpanDiagnostics[] = [
      {
        text: '咖啡厅',
        start: 3,
        end: 6,
        domain: 'restaurant',
        riskScore: 2,
        signals: ['detector_pinyin_hint'],
        candidates: [],
        applied: false,
      },
    ];

    const result = await runFwTopKDecisionPipeline({
      rawText: '我想去咖啡厅坐坐',
      spans,
      runtime: {} as LexiconRuntime,
      profile: defaultGeneralProfile(),
      config: {
        topK: 3,
        minPrior: 0.5,
        finalScoreWeights: { pinyin: 0.4, prior: 0.3, domain: 0.2, kenlm: 0.1 },
        candidateRequireRepairTarget: false,
        repairTargetScoreBoost: 0,
      },
      enabledDomains: ['restaurant'],
      kenlmScorer: null,
      gateOptions: {
        enabled: false,
        mode: 'weak_veto',
        deltaThreshold: 0.8,
        vetoThreshold: -0.2,
      },
    });

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.candidateText).toBe('咖啡馆');
    expect(result.pickedTopKWinCount).toBe(1);
    expect(spans[0]?.selectedCandidateIndex).toBe(1);
  });

  it('D-greedy keeps only one replacement on overlap', async () => {
    const spans: FwSpanDiagnostics[] = [
      {
        text: 'ab',
        start: 0,
        end: 2,
        domain: 'general',
        riskScore: 2,
        signals: [],
        candidates: [],
        applied: false,
      },
      {
        text: 'bc',
        start: 1,
        end: 3,
        domain: 'general',
        riskScore: 2,
        signals: [],
        candidates: [],
        applied: false,
      },
    ];

    const { recallSpanTopK } = await import('../lexicon/local-span-recall');
    (recallSpanTopK as jest.Mock).mockImplementation((_rt, text: string) => ({
      hits: [
        {
          word: text === 'ab' ? 'AX' : 'BY',
          priorScore: text === 'ab' ? 0.5 : 0.95,
          candidateScore: text === 'ab' ? 0.5 : 0.95,
          phoneticScore: 0.5,
          source: 'pinyin',
          domains: [],
          repairTarget: true,
        },
      ],
    }));

    const result = await runFwTopKDecisionPipeline({
      rawText: 'abc',
      spans,
      runtime: {} as LexiconRuntime,
      profile: defaultGeneralProfile(),
      config: {
        topK: 1,
        minPrior: 0.5,
        finalScoreWeights: { pinyin: 0.4, prior: 0.3, domain: 0.2, kenlm: 0.1 },
      },
      enabledDomains: [],
      kenlmScorer: null as KenLMScorer | null,
      gateOptions: {
        enabled: false,
        mode: 'weak_veto',
        deltaThreshold: 0.8,
        vetoThreshold: -0.2,
      },
    });

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.candidateText).toBe('BY');
  });

  it('candidateRequireRepairTarget=true 时仅 pick repairTarget 候选', async () => {
    const spans: FwSpanDiagnostics[] = [
      {
        text: '美食',
        start: 2,
        end: 4,
        domain: 'restaurant',
        riskScore: 4,
        signals: ['detector_pinyin_hint', 'domain_anchor_nearby'],
        candidates: [],
        applied: false,
      },
    ];

    const { recallSpanTopK } = await import('../lexicon/local-span-recall');
    (recallSpanTopK as jest.Mock).mockImplementation(() => ({
      hits: [
        {
          word: '拿铁',
          priorScore: 0.99,
          candidateScore: 0.99,
          phoneticScore: 0.99,
          source: 'pinyin',
          domains: ['restaurant'],
          repairTarget: false,
        },
        {
          word: '美式',
          priorScore: 0.8,
          candidateScore: 0.8,
          phoneticScore: 0.8,
          source: 'alias_pinyin',
          domains: ['restaurant'],
          repairTarget: true,
        },
      ],
    }));

    const result = await runFwTopKDecisionPipeline({
      rawText: '一杯美食',
      spans,
      runtime: {} as LexiconRuntime,
      profile: defaultGeneralProfile(),
      config: {
        topK: 3,
        minPrior: 0.5,
        finalScoreWeights: { pinyin: 0.4, prior: 0.3, domain: 0.2, kenlm: 0.1 },
        candidateRequireRepairTarget: true,
        repairTargetScoreBoost: 0,
      },
      enabledDomains: ['restaurant'],
      kenlmScorer: null,
      gateOptions: {
        enabled: false,
        mode: 'weak_veto',
        deltaThreshold: 0.8,
        vetoThreshold: -0.2,
      },
    });

    expect(spans[0]?.candidates).toHaveLength(2);
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]?.candidateText).toBe('美式');
  });
});
