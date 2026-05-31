import { loadNodeConfig } from '../node-config';
import { getConfigLoadDiagnostics } from '../config-load-diagnostics';
import { isLexiconV2Enabled } from './lexicon-v2-config';

export type LexiconRuntimeV2Config = {
  enabled?: boolean;
  bundlePath?: string;
  lruBucketCacheSize?: number;
  maxBaseCandidates?: number;
  maxDomainCandidates?: number;
  maxIdiomCandidates?: number;
  recallDiagnosticsEnabled?: boolean;
};

const DEFAULTS: Required<LexiconRuntimeV2Config> = {
  enabled: true,
  bundlePath: 'node_runtime/lexicon/v2_shadow',
  lruBucketCacheSize: 512,
  maxBaseCandidates: 2,
  maxDomainCandidates: 3,
  maxIdiomCandidates: 0,
  recallDiagnosticsEnabled: true,
};

export function isLexiconRuntimeV2Enabled(): boolean {
  if (getConfigLoadDiagnostics().runtimeFeatureDowngrade) {
    return false;
  }
  return loadNodeConfig()?.features?.lexiconRuntimeV2?.enabled === true;
}

export function getLexiconRuntimeV2Config(): Required<LexiconRuntimeV2Config> {
  const cfg = loadNodeConfig()?.features?.lexiconRuntimeV2 ?? {};
  return {
    enabled: cfg.enabled ?? DEFAULTS.enabled,
    bundlePath: cfg.bundlePath?.trim() || DEFAULTS.bundlePath,
    lruBucketCacheSize: cfg.lruBucketCacheSize ?? DEFAULTS.lruBucketCacheSize,
    maxBaseCandidates: cfg.maxBaseCandidates ?? DEFAULTS.maxBaseCandidates,
    maxDomainCandidates: cfg.maxDomainCandidates ?? DEFAULTS.maxDomainCandidates,
    maxIdiomCandidates: cfg.maxIdiomCandidates ?? DEFAULTS.maxIdiomCandidates,
    recallDiagnosticsEnabled: cfg.recallDiagnosticsEnabled ?? DEFAULTS.recallDiagnosticsEnabled,
  };
}

export function getLexiconRuntimeV2MergeCap(): number {
  const cfg = getLexiconRuntimeV2Config();
  return (
    cfg.maxBaseCandidates +
    cfg.maxDomainCandidates +
    (cfg.maxIdiomCandidates > 0 ? cfg.maxIdiomCandidates : 0)
  );
}

export function getLexiconRuntimeV2BundlePathConfig(): string {
  return getLexiconRuntimeV2Config().bundlePath;
}

export function isLexiconV2SessionIntentWriteEnabled(): boolean {
  if (!isLexiconV2Enabled()) {
    return false;
  }
  return loadNodeConfig()?.features?.lexiconV2?.sessionIntentWriteEnabled === true;
}
