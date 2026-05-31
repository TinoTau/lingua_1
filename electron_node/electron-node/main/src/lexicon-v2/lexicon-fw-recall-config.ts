import { loadNodeConfig } from '../node-config';
import { isLexiconRuntimeV2Enabled } from './lexicon-runtime-v2-config';

/** Requires lexiconRuntimeV2.enabled AND useLexiconRuntimeV2Recall (both true on frozen defaults). */
export function isLexiconRuntimeV2RecallEnabled(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.useLexiconRuntimeV2Recall === true;
}

export function isIndustryRoutingEnabled(): boolean {
  if (!isLexiconRuntimeV2RecallEnabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.useIndustryRouting === true;
}
