import { describe, expect, it, jest } from '@jest/globals';

jest.mock('./fw-mode', () => ({
  isFwDetectorEngineEnabled: jest.fn(() => true),
}));

import { PIPELINE_MODES } from '../pipeline/pipeline-mode-config';
import { applyFwDetectorPipelineMode } from './pipeline-mode-fw';

describe('applyFwDetectorPipelineMode', () => {
  it('在 ASR 后插入 FW_SPAN_DETECTOR，基础模板不含 legacy ASR repair 步骤', () => {
    const mode = applyFwDetectorPipelineMode(PIPELINE_MODES.GENERAL_VOICE_TRANSLATION);
    expect(mode.steps).toContain('FW_SPAN_DETECTOR');
    expect(mode.steps).not.toContain('LEXICON_RECALL');
    expect(mode.steps).not.toContain('SENTENCE_REPAIR');
    const asrIdx = mode.steps.indexOf('ASR');
    const fwIdx = mode.steps.indexOf('FW_SPAN_DETECTOR');
    const aggIdx = mode.steps.indexOf('AGGREGATION');
    expect(fwIdx).toBe(asrIdx + 1);
    expect(aggIdx).toBeGreaterThan(fwIdx);
  });
});
