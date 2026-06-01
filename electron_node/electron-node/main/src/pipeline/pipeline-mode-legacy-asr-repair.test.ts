import { describe, expect, it } from '@jest/globals';
import { PIPELINE_MODES } from './pipeline-mode-config';
import { applyLegacyAsrRepairPipelineMode } from './pipeline-mode-legacy-asr-repair';

describe('applyLegacyAsrRepairPipelineMode', () => {
  it('在 AGGREGATION 后注入 LEXICON_RECALL 与 SENTENCE_REPAIR', () => {
    const mode = applyLegacyAsrRepairPipelineMode(PIPELINE_MODES.GENERAL_VOICE_TRANSLATION);
    const aggIdx = mode.steps.indexOf('AGGREGATION');
    expect(mode.steps[aggIdx + 1]).toBe('LEXICON_RECALL');
    expect(mode.steps[aggIdx + 2]).toBe('SENTENCE_REPAIR');
    expect(mode.dependencies?.PHONETIC_CORRECTION).toEqual(['SENTENCE_REPAIR']);
  });
});
