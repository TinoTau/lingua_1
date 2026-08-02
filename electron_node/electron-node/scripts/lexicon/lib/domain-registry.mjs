import fs from 'fs';
import { LEGACY_DOMAIN_ASR, LEGACY_DOMAIN_MAP } from './constants.mjs';

export function loadDomainRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const entries = Array.isArray(parsed) ? parsed : parsed.domains;
  if (!Array.isArray(entries)) {
    throw new Error(`Invalid domain registry: ${registryPath}`);
  }
  const byId = new Map();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  return { entries, byId };
}

export function mapLegacyDomain(domain) {
  const trimmed = (domain ?? '').trim();
  if (!trimmed) {
    return 'general';
  }
  if (trimmed === LEGACY_DOMAIN_ASR) {
    return LEGACY_DOMAIN_MAP[LEGACY_DOMAIN_ASR];
  }
  return trimmed;
}

export function validateDomainId(domainId, registry) {
  const mapped = mapLegacyDomain(domainId);
  const entry = registry.byId.get(mapped);
  if (!entry) {
    return { ok: false, code: 'UNKNOWN_DOMAIN', domain: domainId, mapped };
  }
  if (!entry.enabled) {
    return { ok: false, code: 'DISABLED_DOMAIN', domain: mapped };
  }
  return { ok: true, domain: mapped };
}

export function normalizeDomains(rawDomains, rawDomain, registry) {
  const list = [];
  if (Array.isArray(rawDomains)) {
    for (const d of rawDomains) {
      if (typeof d === 'string' && d.trim()) {
        list.push(d.trim());
      }
    }
  } else if (typeof rawDomain === 'string' && rawDomain.trim()) {
    list.push(rawDomain.trim());
  }
  if (!list.length) {
    list.push('general');
  }

  const normalized = [];
  for (const d of list) {
    const result = validateDomainId(d, registry);
    if (!result.ok) {
      return result;
    }
    if (!normalized.includes(result.domain)) {
      normalized.push(result.domain);
    }
  }
  return { ok: true, domains: normalized };
}
