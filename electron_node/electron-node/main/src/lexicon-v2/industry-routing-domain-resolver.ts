/**
 * Phase 4 — session-level domain resolution for V2 recall.
 *
 * Fallback (explicit steps):
 * 1. Session intent primaryDomain (confidence >= threshold)
 * 2. industry_routing_lexicon weighted vote
 * 3. domain_anchor keyword match in session text
 * 4. enabledDomains union
 */

import { loadDomainAnchors } from '../fw-detector/fw-config';
import { loadNodeConfig } from '../node-config';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { resolveDomainIdsFromSessionIntent } from './domain-recall-merge';
import { isValidLLMDomain } from './profile-registry';
import type { LexiconSessionIntent } from '../session-runtime/types';
import { recordIndustryRoutingLookup } from './recall-v2-diagnostics';

const LLM_DOMAIN_CONFIDENCE_THRESHOLD = 0.75;

export type RecallDomainResolutionSource =
  | 'session_intent'
  | 'industry_routing'
  | 'fallback_anchor'
  | 'enabled_domains';

export type RecallDomainResolution = {
  domainIds: string[];
  source: RecallDomainResolutionSource;
};

function filterEnabled(domainIds: readonly string[], enabledDomains: readonly string[]): string[] {
  const enabled = new Set(enabledDomains);
  return domainIds.filter((id) => enabled.has(id) && isValidLLMDomain(id));
}

function resolveFromIndustryRouting(
  runtimeV2: LexiconRuntimeV2,
  pinyinKeys: readonly string[],
  enabledDomains: readonly string[]
): string[] {
  if (!pinyinKeys.length) {
    return [];
  }
  const weightByDomain = new Map<string, number>();
  for (const hit of runtimeV2.lookupIndustryRoutes(pinyinKeys)) {
    if (!enabledDomains.includes(hit.domainId)) {
      continue;
    }
    weightByDomain.set(hit.domainId, (weightByDomain.get(hit.domainId) ?? 0) + hit.weight);
  }
  return [...weightByDomain.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domainId]) => domainId);
}

function collectSessionText(intent: LexiconSessionIntent | undefined): string {
  if (!intent) {
    return '';
  }
  return [intent.summary, ...intent.topicKeywords].filter(Boolean).join('');
}

function resolveFromDomainAnchors(
  sessionText: string,
  enabledDomains: readonly string[],
  domainAnchors: Record<string, string[]>
): string[] {
  if (!sessionText.trim()) {
    return [];
  }
  const hits = new Map<string, number>();
  for (const domainId of enabledDomains) {
    const anchors = domainAnchors[domainId] ?? [];
    for (const anchor of anchors) {
      if (anchor && sessionText.includes(anchor)) {
        hits.set(domainId, (hits.get(domainId) ?? 0) + 1);
      }
    }
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domainId]) => domainId);
}

export function resolveRecallDomains(input: {
  sessionIntent?: LexiconSessionIntent;
  enabledDomains: readonly string[];
  runtimeV2: LexiconRuntimeV2;
}): RecallDomainResolution {
  recordIndustryRoutingLookup();
  const { sessionIntent, enabledDomains, runtimeV2 } = input;
  const enabled = enabledDomains.filter(isValidLLMDomain);

  if (
    sessionIntent &&
    sessionIntent.confidence >= LLM_DOMAIN_CONFIDENCE_THRESHOLD &&
    isValidLLMDomain(sessionIntent.primaryDomain) &&
    sessionIntent.primaryDomain !== 'general'
  ) {
    return {
      domainIds: filterEnabled(
        resolveDomainIdsFromSessionIntent(sessionIntent),
        enabled
      ),
      source: 'session_intent',
    };
  }

  const routingDomains = resolveFromIndustryRouting(
    runtimeV2,
    sessionIntent?.topicKeywordPinyinKeys ?? [],
    enabled
  );
  if (routingDomains.length) {
    return { domainIds: routingDomains, source: 'industry_routing' };
  }

  const anchorPath =
    loadNodeConfig()?.features?.fwDetector?.domainAnchorPath ?? 'data/lexicon/domain_anchor.json';
  const anchorDomains = resolveFromDomainAnchors(
    collectSessionText(sessionIntent),
    enabled,
    loadDomainAnchors(anchorPath)
  );
  if (anchorDomains.length) {
    return { domainIds: anchorDomains, source: 'fallback_anchor' };
  }

  return { domainIds: [...enabled], source: 'enabled_domains' };
}
