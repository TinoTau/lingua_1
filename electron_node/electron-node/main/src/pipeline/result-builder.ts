/**
 * ResultBuilder — dispatches to FW or legacy path without loading legacy modules on FW engine.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { JobContext } from './context/job-context';
import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';
import { buildFwJobResult } from './result-builder-fw';

export function buildJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  if (isFwDetectorEngineEnabled()) {
    return buildFwJobResult(job, ctx);
  }
  // Lazy load — FW mainline must not statically import legacy ASR repair modules.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildLegacyJobResult } = require('./result-builder-legacy') as typeof import('./result-builder-legacy');
  return buildLegacyJobResult(job, ctx);
}
