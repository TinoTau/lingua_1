import { loadNodeConfig } from '../node-config';
import { isLexiconRuntimeV2Enabled } from './lexicon-runtime-v2-config';

export function isIndustryRoutingEnabled(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.useIndustryRouting === true;
}
