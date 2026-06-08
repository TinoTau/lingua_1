import { loadNodeConfig } from '../node-config';
import { isLexiconRuntimeV2Enabled } from './lexicon-runtime-v2-config';

export function isWeakDomainRecallEnabled(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.weakDomainRecallEnabled === true;
}

export function isFuzzyPinyinRecallEnabled(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.fuzzyPinyinRecallEnabled === true;
}

export function shouldUseIndustryRouting(): boolean {
  if (!isLexiconRuntimeV2Enabled()) {
    return false;
  }
  if (isWeakDomainRecallEnabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.fwDetector?.useIndustryRouting === true;
}

export function isIndustryRoutingEnabled(): boolean {
  return shouldUseIndustryRouting();
}
