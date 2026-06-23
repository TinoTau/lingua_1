import {
  lexiconV2BundleFileNames,
  resolveLexiconV2BundleDir,
} from '../lexicon-v2/lexicon-v2-bundle-path';
import type { RecallScopeResolution } from '../lexicon-v2/resolve-recall-enabled-fine-domains';
import {
  getRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from '../lexicon-v2/runtime-domain-registry';
import type { LexiconRuntimeV2State } from '../lexicon-v2/lexicon-types-v2';
import type { ContextPriorStats } from './span-assembly-shared/domain-rerank';
import type { FwDetectorRuntimeDiag } from './types';

function readRuntimeDomainRegistry(): RuntimeDomainRegistry | null {
  try {
    return getRuntimeDomainRegistry();
  } catch {
    return null;
  }
}

export function buildFwRuntimeDiag(
  v2State: LexiconRuntimeV2State,
  profilePrimary: string | null,
  enabledDomainsPolicy: string[],
  recallScope?: RecallScopeResolution
): FwDetectorRuntimeDiag {
  const bundleDir = resolveLexiconV2BundleDir();
  const bundleFiles = bundleDir ? lexiconV2BundleFileNames(bundleDir) : null;
  const counts = v2State.tableCounts;
  const lexiconRows = counts ? counts.base + counts.domain + counts.idiom : null;
  const domainRegistry = readRuntimeDomainRegistry();

  return {
    loaded: v2State.status === 'ok',
    status: v2State.status,
    bundleDir: bundleDir ?? v2State.bundleDir ?? null,
    sqlitePath: bundleFiles?.sqlitePath ?? null,
    manifestVersion: v2State.manifestVersion ?? null,
    lexiconRows,
    profilePrimary,
    enabledDomains: enabledDomainsPolicy,
    recallDomainScope: recallScope?.domainIds,
    recallScopeSource: recallScope?.source,
    availableFineDomains: domainRegistry ? [...domainRegistry.availableFineDomains] : undefined,
    availableCoarseDomains: domainRegistry ? [...domainRegistry.availableCoarseDomains] : undefined,
    llmAllowedDomains: domainRegistry ? [...domainRegistry.llmAllowedDomains] : undefined,
    domainHierarchyVersion:
      domainRegistry?.domainHierarchyVersion ?? v2State.domainHierarchyVersion ?? null,
  };
}

export function mergeContextPriorIntoRuntimeDiag(
  base: FwDetectorRuntimeDiag,
  contextPriorDomainInput: string | null | undefined,
  stats: ContextPriorStats
): FwDetectorRuntimeDiag {
  const coarse = contextPriorDomainInput?.trim() ?? '';
  const contextPriorDomain =
    coarse && coarse !== 'general' ? coarse : null;

  return {
    ...base,
    contextPriorDomain,
    contextPriorApplied: stats.applied,
    contextPriorSkippedReason: stats.applied ? undefined : stats.skippedReason,
  };
}
