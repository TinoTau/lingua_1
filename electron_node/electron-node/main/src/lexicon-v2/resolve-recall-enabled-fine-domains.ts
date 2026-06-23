/**
 * Recall Domain Set SSOT — RS-03A (Frozen Addendum v1.1).
 */

import logger from '../logger';
import { loadFwDetectorRuntimeConfig } from '../fw-detector/fw-config';
import {
  getRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from './runtime-domain-registry';

export const RECOMMENDED_MAX_ENABLED_FINE_DOMAINS = 12;

export type RecallScopeSource = 'available' | 'policy' | 'job_override';

export type ResolveRecallEnabledFineDomainsInput = {
  jobOverride?: readonly string[] | null;
  configEnabledDomains?: readonly string[] | null;
};

export type RecallScopeResolution = {
  domainIds: string[];
  source: RecallScopeSource;
  policyDomains: string[];
};

function capFineDomains(domainIds: string[]): string[] {
  const sorted = [...domainIds].sort();
  if (sorted.length <= RECOMMENDED_MAX_ENABLED_FINE_DOMAINS) {
    return sorted;
  }
  return sorted.slice(0, RECOMMENDED_MAX_ENABLED_FINE_DOMAINS);
}

/** RS-03A: coarse/fine policy → expand → intersect availableFineDomains. */
export function expandPolicyToFineDomains(
  policy: readonly string[],
  registry: RuntimeDomainRegistry
): string[] {
  const available = new Set(registry.availableFineDomains);
  const fine = new Set<string>();

  for (const raw of policy) {
    const domainId = raw.trim();
    if (!domainId || domainId === 'general') {
      continue;
    }
    const children = registry.coarseToFineMap[domainId];
    if (children?.length) {
      for (const child of children) {
        if (available.has(child)) {
          fine.add(child);
        }
      }
      continue;
    }
    if (available.has(domainId)) {
      fine.add(domainId);
    }
  }

  return [...fine].sort();
}

export function resolveRecallScope(
  input: ResolveRecallEnabledFineDomainsInput = {}
): RecallScopeResolution {
  const registry = getRuntimeDomainRegistry();
  const configDomains =
    input.configEnabledDomains ?? loadFwDetectorRuntimeConfig().enabledDomains;

  if (input.jobOverride?.length) {
    const domainIds = capFineDomains(expandPolicyToFineDomains(input.jobOverride, registry));
    return {
      domainIds,
      source: 'job_override',
      policyDomains: [...input.jobOverride],
    };
  }

  if (configDomains.length > 0) {
    const expanded = expandPolicyToFineDomains(configDomains, registry);
    if (expanded.length === 0) {
      logger.warn(
        { policy: [...configDomains], availableFine: [...registry.availableFineDomains] },
        '[RecallScope] policy expanded to empty — CFG-02 warn+truncate'
      );
    }
    return {
      domainIds: capFineDomains(expanded),
      source: 'policy',
      policyDomains: [...configDomains],
    };
  }

  return {
    domainIds: capFineDomains([...registry.availableFineDomains]),
    source: 'available',
    policyDomains: [],
  };
}

/** Single entry: Job Override → fw-config.enabledDomains → availableFineDomains. */
export function resolveRecallEnabledFineDomains(
  input: ResolveRecallEnabledFineDomainsInput = {}
): string[] {
  return resolveRecallScope(input).domainIds;
}

export {
  getParentDomainId,
  isFineDomainEligibleForWinning,
} from './runtime-domain-registry';

/** @deprecated use RuntimeDomainRegistry.coarseToFineMap */
export function isExpandableCoarseDomain(domainId: string): boolean {
  const registry = getRuntimeDomainRegistry();
  return (registry.coarseToFineMap[domainId]?.length ?? 0) > 0;
}
