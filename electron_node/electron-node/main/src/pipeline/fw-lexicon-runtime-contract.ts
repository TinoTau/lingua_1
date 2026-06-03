/**
 * FW job result — LexiconRuntimeV2 contract (v3 bundle).
 */

import { ensureLexiconRuntimeV2Loaded } from '../lexicon-v2/lexicon-runtime-v2-holder';
import type { LexiconRuntimeStatus } from '../lexicon/lexicon-types';
import type { LexiconRuntimeContractFields } from './lexicon-runtime-contract';

export function resolveFwLexiconRuntimeContract(): LexiconRuntimeContractFields {
  const v2State = ensureLexiconRuntimeV2Loaded();
  const status = v2State.status as LexiconRuntimeStatus;
  if (v2State.status === 'ok') {
    return {
      lexicon_runtime_status: status,
      lexicon_manifest_version: v2State.manifestVersion ?? null,
    };
  }
  return {
    lexicon_runtime_status: status,
    lexicon_manifest_version: null,
    ...(v2State.errorMessage ? { lexicon_runtime_error: v2State.errorMessage } : {}),
  };
}
