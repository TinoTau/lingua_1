/**
 * Parse + validate CPU LLM JSON output → LexiconProfileDecision (Final Freeze Spec §4).
 */

import type { LexiconProfileDecision } from '../session-runtime/types';
import { getLexiconV2CpuWorkerConfig } from './lexicon-v2-config';
import { normalizeTopicKeywords } from './lexicon-session-intent';
import {
  isCoarseDomainEligibleForLlm,
  isFinePrimaryDomainRejected,
} from './runtime-domain-registry';

export type ParseContext = {
  currentPrimary: string;
  finalizedTurnCount: number;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => asString(v)).filter(Boolean);
}

function isAllowedLlmPrimary(primary: string): boolean {
  if (!primary || primary === 'general') {
    return false;
  }
  if (isFinePrimaryDomainRejected(primary)) {
    return false;
  }
  return isCoarseDomainEligibleForLlm(primary);
}

function filterAllowedLlmSecondaries(domainIds: string[]): string[] {
  return domainIds.filter(isCoarseDomainEligibleForLlm);
}

export function parseLexiconProfileDecision(
  raw: unknown,
  ctx: ParseContext
): LexiconProfileDecision | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const primaryRaw = asString(obj.primaryDomain);
  if (!isAllowedLlmPrimary(primaryRaw)) {
    return null;
  }
  const primary = primaryRaw;

  const secondary = filterAllowedLlmSecondaries(asStringArray(obj.secondaryDomains)).filter(
    (d) => d !== primary
  );

  const confidence = asNumber(obj.confidence);
  if (confidence === null || confidence < 0 || confidence > 1) {
    return null;
  }

  const summaryRaw = asString(obj.summary);
  const maxSummary = getLexiconV2CpuWorkerConfig().maxSummaryChars ?? 300;
  const summary = summaryRaw ? summaryRaw.slice(0, maxSummary) : '';

  const shouldSwitch =
    typeof obj.shouldSwitch === 'boolean'
      ? obj.shouldSwitch
      : primary !== ctx.currentPrimary;

  const reason = asStringArray(obj.reason);
  const effectiveFromTurn =
    asNumber(obj.effectiveFromTurn) ?? ctx.finalizedTurnCount + 1;
  const topicKeywords = normalizeTopicKeywords(asStringArray(obj.topicKeywords));

  return {
    summary,
    primaryDomain: primary,
    secondaryDomains: secondary.slice(0, 2),
    confidence,
    shouldSwitch,
    reason,
    effectiveFromTurn,
    topicKeywords,
  };
}

/** Classify why LLM JSON failed to parse into a valid decision. */
export function classifyLexiconIntentParseFailure(
  body: unknown,
  _ctx: ParseContext
): 'unknown_domain' | 'schema_invalid' {
  let raw: Record<string, unknown> | null = null;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    raw =
      record.decision && typeof record.decision === 'object'
        ? (record.decision as Record<string, unknown>)
        : record;
  }
  if (raw) {
    const primary = typeof raw.primaryDomain === 'string' ? raw.primaryDomain.trim() : '';
    if (primary && isFinePrimaryDomainRejected(primary)) {
      return 'schema_invalid';
    }
    if (primary && !isCoarseDomainEligibleForLlm(primary)) {
      return 'unknown_domain';
    }
  }
  return 'schema_invalid';
}

/** Extract decision object from service response or raw LLM JSON string. */
export function parseLexiconIntentResponse(
  body: unknown,
  ctx: ParseContext
): LexiconProfileDecision | null {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as unknown;
      return parseLexiconProfileDecision(parsed, ctx);
    } catch {
      return null;
    }
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.decision && typeof record.decision === 'object') {
      return parseLexiconProfileDecision(record.decision, ctx);
    }
    return parseLexiconProfileDecision(body, ctx);
  }

  return null;
}
