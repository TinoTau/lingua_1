import { describe, expect, it, jest } from '@jest/globals';
import type { JobAssignMessage } from '@shared/protocols/messages';
import { inferPipelineMode } from './pipeline-mode-config';
import * as fwMode from '../fw-detector/fw-mode';
import * as pipelineModeLegacy from './pipeline-mode-legacy-asr-repair';

function dynamicAsrTtsJob(): JobAssignMessage {
  return {
    job_id: 'test-dynamic',
    session_id: 'sess-dynamic',
    utterance_index: 0,
    pipeline: {
      use_asr: true,
      use_nmt: false,
      use_tts: true,
    },
  } as JobAssignMessage;
}

describe('inferPipelineMode dynamic combinations', () => {
  it('finalizePipelineMode injects FW_SPAN_DETECTOR when FW engine is enabled', () => {
    jest.spyOn(fwMode, 'isFwDetectorEngineEnabled').mockReturnValue(true);
    const mode = inferPipelineMode(dynamicAsrTtsJob());
    expect(mode.steps).toContain('FW_SPAN_DETECTOR');
    expect(mode.steps).not.toContain('LEXICON_RECALL');
    jest.restoreAllMocks();
  });

  it('finalizePipelineMode injects legacy ASR repair when FW engine is disabled', () => {
    jest.spyOn(fwMode, 'isFwDetectorEngineEnabled').mockReturnValue(false);
    jest.spyOn(pipelineModeLegacy, 'applyLegacyAsrRepairPipelineMode').mockImplementation((mode) => ({
      ...mode,
      steps: [...mode.steps, 'LEXICON_RECALL', 'SENTENCE_REPAIR'],
    }));
    const mode = inferPipelineMode(dynamicAsrTtsJob());
    expect(mode.steps).toContain('LEXICON_RECALL');
    expect(mode.steps).toContain('SENTENCE_REPAIR');
    jest.restoreAllMocks();
  });
});
