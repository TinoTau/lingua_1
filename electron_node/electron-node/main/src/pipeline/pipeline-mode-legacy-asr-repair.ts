import type { PipelineMode, PipelineStepType } from './pipeline-mode-config';

const LEGACY_ASR_REPAIR_STEPS: PipelineStepType[] = ['LEXICON_RECALL', 'SENTENCE_REPAIR'];

/**
 * Non-FW engine: inject legacy lexicon recall + sentence repair after aggregation.
 * FW engine uses applyFwDetectorPipelineMode instead — base templates omit these steps.
 */
export function applyLegacyAsrRepairPipelineMode(mode: PipelineMode): PipelineMode {
  const steps: PipelineStepType[] = [];
  for (const step of mode.steps) {
    steps.push(step);
    if (step === 'AGGREGATION') {
      for (const legacyStep of LEGACY_ASR_REPAIR_STEPS) {
        if (!steps.includes(legacyStep)) {
          steps.push(legacyStep);
        }
      }
    }
  }

  return {
    ...mode,
    name: `${mode.name} (legacy ASR repair)`,
    steps,
    dependencies: {
      ...mode.dependencies,
      LEXICON_RECALL: ['AGGREGATION'],
      SENTENCE_REPAIR: ['LEXICON_RECALL'],
      PHONETIC_CORRECTION: ['SENTENCE_REPAIR'],
    },
  };
}
