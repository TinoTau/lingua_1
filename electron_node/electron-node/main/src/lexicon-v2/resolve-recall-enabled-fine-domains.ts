/**
 * Recall Domain Set SSOT — Implementation Contract V1.2 §1.
 */

import { loadFwDetectorRuntimeConfig } from '../fw-detector/fw-config';
import {
  getRegistryEntry,
  isValidLLMDomain,
  loadLexiconProfileRegistry,
} from './profile-registry';

export const RECOMMENDED_MAX_ENABLED_FINE_DOMAINS = 12;

export type ResolveRecallEnabledFineDomainsInput = {
  jobOverride?: readonly string[] | null;
  configEnabledDomains?: readonly string[] | null;
};

function registryEnabledFineDomainIds(): string[] {
  return loadLexiconProfileRegistry()
    .filter((entry) => entry.enabled && entry.allowLLMSelect && entry.id !== 'general')
    .map((entry) => entry.id);
}

function expandToFineDomains(domainId: string): string[] {
  const trimmed = domainId.trim();
  if (!trimmed || trimmed === 'general') {
    return [];
  }

  const children = loadLexiconProfileRegistry()
    .filter((entry) => entry.parent === trimmed && entry.enabled && entry.allowLLMSelect)
    .map((entry) => entry.id);

  if (children.length > 0) {
    return children;
  }

  return isValidLLMDomain(trimmed) ? [trimmed] : [];
}

function resolveRawDomainIds(input: ResolveRecallEnabledFineDomainsInput): string[] {
  if (input.jobOverride?.length) {
    return [...input.jobOverride];
  }
  if (input.configEnabledDomains?.length) {
    return [...input.configEnabledDomains];
  }
  return registryEnabledFineDomainIds();
}

/** Single entry: Job Override → fw-config.enabledDomains → registry enabled fine domains. */
export function resolveRecallEnabledFineDomains(
  input: ResolveRecallEnabledFineDomainsInput = {}
): string[] {
  const configDomains =
    input.configEnabledDomains ?? loadFwDetectorRuntimeConfig().enabledDomains;
  const raw = resolveRawDomainIds({
    jobOverride: input.jobOverride,
    configEnabledDomains: configDomains,
  });

  const fine = new Set<string>();
  for (const domainId of raw) {
    for (const expanded of expandToFineDomains(domainId)) {
      fine.add(expanded);
    }
  }

  return [...fine].sort();
}

export function getParentDomainId(domainId: string): string | null {
  const entry = getRegistryEntry(domainId);
  const parent = entry?.parent?.trim();
  return parent && parent !== 'general' ? parent : null;
}

export function isExpandableCoarseDomain(domainId: string): boolean {
  return loadLexiconProfileRegistry().some(
    (entry) => entry.parent === domainId && entry.enabled
  );
}

export function isFineDomainEligibleForWinning(domainId: string): boolean {
  if (!domainId || domainId === 'general') {
    return false;
  }
  if (!isValidLLMDomain(domainId)) {
    return false;
  }
  return !isExpandableCoarseDomain(domainId);
}
