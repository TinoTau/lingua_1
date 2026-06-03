import { describe, expect, it } from '@jest/globals';
import { buildPinyinImeV2DictFromEntries } from './pinyin-ime-v2-dict-load';
import { runPinyinImeV2SpanProposal } from './run-pinyin-ime-v2-span-proposal';

const testDict = buildPinyinImeV2DictFromEntries([
  { word: '你好', syllables: ['ni', 'hao'], prior: 1.0 },
  { word: '世界', syllables: ['shi', 'jie'], prior: 0.9 },
]);

describe('runPinyinImeV2SpanProposal', () => {
  it('runs decode → diff → instability → boundary pipeline', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: '你号世界',
      dict: testDict,
      config: { topK: 5 },
    });
    expect(proposal.candidates.length).toBeGreaterThan(0);
    expect(proposal.diagnostics.candidateCount).toBeGreaterThan(0);
    expect(proposal.diagnostics.boundaryAlignmentScores.length).toBe(
      proposal.candidates.length
    );
    expect(proposal.diagnostics.rawBoundaryMatchedTopKCount).toBeGreaterThanOrEqual(0);
    expect(proposal.boundaryCompatibleTopKSpans).toBeDefined();
    expect(proposal.diagnostics.trustedTopKCount).toBeGreaterThanOrEqual(0);
  });

  it('returns empty for non-CJK input', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: 'hello world',
      dict: testDict,
      config: { topK: 5 },
    });
    expect(proposal.candidates).toEqual([]);
    expect(proposal.diffSpans).toEqual([]);
  });
});
