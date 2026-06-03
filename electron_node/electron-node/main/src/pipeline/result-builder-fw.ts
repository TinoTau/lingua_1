/**
 * FW frozen mainline result builder — no legacy ASR repair imports.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { JobContext } from './context/job-context';
import { resolveFwLexiconRuntimeContract } from './fw-lexicon-runtime-contract';
import { assembleJobResult, buildCoreResultExtra } from './result-builder-core';

function buildFwResultExtra(job: JobAssignMessage, ctx: JobContext): Record<string, unknown> {
  const lexicon = resolveFwLexiconRuntimeContract();
  return {
    ...buildCoreResultExtra(job, ctx),
    lexicon_runtime_status: lexicon.lexicon_runtime_status,
    lexicon_manifest_version: lexicon.lexicon_manifest_version,
    ...(lexicon.lexicon_runtime_error
      ? { lexicon_runtime_error: lexicon.lexicon_runtime_error }
      : {}),
    ...(lexicon.lexicon_disabled_reason
      ? { lexicon_disabled_reason: lexicon.lexicon_disabled_reason }
      : {}),
  };
}

export function buildFwJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  return assembleJobResult(job, ctx, buildFwResultExtra(job, ctx));
}
