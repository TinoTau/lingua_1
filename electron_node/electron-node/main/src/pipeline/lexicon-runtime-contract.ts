/**
 * Lexicon runtime status for Result extra (FW + non-FW).
 * Not legacy Recover — shared observability only.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import {
  getLexiconRecallSkipReason,
  isLexiconRecallLanguage,
  isFwDetectorFeatureEnabled,
  resolveJobUseLexicon,
} from '../node-config';
import { ensureLexiconRuntimeLoaded } from '../lexicon/lexicon-runtime-holder';
import { markLexiconDisabled } from '../lexicon/lexicon-runtime';
import type { LexiconRuntimeStatus } from '../lexicon/lexicon-types';

export type LexiconRuntimeContractFields = {
  lexicon_runtime_status: LexiconRuntimeStatus;
  lexicon_manifest_version: string | null;
  lexicon_runtime_error?: string;
  lexicon_disabled_reason?: string;
};

export function resolveLexiconRuntimeContract(
  job: JobAssignMessage,
  ctx: JobContext
): LexiconRuntimeContractFields {
  if (ctx.lexiconRuntimeStatus) {
    return {
      lexicon_runtime_status: ctx.lexiconRuntimeStatus,
      lexicon_manifest_version: ctx.lexiconManifestVersion ?? null,
      ...(ctx.lexiconRuntimeError ? { lexicon_runtime_error: ctx.lexiconRuntimeError } : {}),
      ...(ctx.lexiconDisabledReason ? { lexicon_disabled_reason: ctx.lexiconDisabledReason } : {}),
    };
  }

  const skipReason = getLexiconRecallSkipReason(job, ctx);
  if (skipReason) {
    const fwWantsRuntime =
      skipReason === 'feature_lexicon_recall_disabled' &&
      isFwDetectorFeatureEnabled() &&
      resolveJobUseLexicon(job);
    if (fwWantsRuntime) {
      const runtimeState = ensureLexiconRuntimeLoaded();
      return {
        lexicon_runtime_status: runtimeState.status as LexiconRuntimeStatus,
        lexicon_manifest_version: runtimeState.manifestVersion ?? null,
        lexicon_disabled_reason: skipReason,
        ...(runtimeState.errorMessage ? { lexicon_runtime_error: runtimeState.errorMessage } : {}),
      };
    }
    const disabled = markLexiconDisabled();
    return {
      lexicon_runtime_status: disabled.status,
      lexicon_manifest_version: null,
      lexicon_disabled_reason: skipReason,
      ...(disabled.errorMessage ? { lexicon_runtime_error: disabled.errorMessage } : {}),
    };
  }

  if (!isLexiconRecallLanguage(job, ctx)) {
    return {
      lexicon_runtime_status: 'disabled',
      lexicon_manifest_version: null,
      lexicon_disabled_reason: 'unsupported_source_language',
    };
  }

  const runtimeState = ensureLexiconRuntimeLoaded();
  return {
    lexicon_runtime_status: runtimeState.status,
    lexicon_manifest_version: runtimeState.manifestVersion ?? null,
    ...(runtimeState.errorMessage ? { lexicon_runtime_error: runtimeState.errorMessage } : {}),
  };
}
