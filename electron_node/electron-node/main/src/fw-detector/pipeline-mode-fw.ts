import type { PipelineMode, PipelineStepType } from '../pipeline/pipeline-mode-config';
import { isFwDetectorEngineEnabled } from './fw-mode';

export function applyFwDetectorPipelineMode(mode: PipelineMode): PipelineMode {
  if (!isFwDetectorEngineEnabled()) {
    return mode;
  }

  const withoutRecover = mode.steps.filter(
    (step) => step !== 'LEXICON_RECALL' && step !== 'SENTENCE_REPAIR'
  );

  const steps: PipelineStepType[] = [];
  for (const step of withoutRecover) {
    steps.push(step);
    if (step === 'ASR' && !steps.includes('FW_SPAN_DETECTOR')) {
      steps.push('FW_SPAN_DETECTOR');
    }
  }

  const dependencies: Partial<Record<PipelineStepType, PipelineStepType[]>> = {
    ...mode.dependencies,
    FW_SPAN_DETECTOR: ['ASR'],
    AGGREGATION: ['FW_SPAN_DETECTOR'],
  };

  return {
    ...mode,
    name: `${mode.name} (FW)`,
    steps,
    dependencies,
  };
}
