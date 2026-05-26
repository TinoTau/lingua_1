/**
 * LexiconProfileRegistry — domain whitelist (Final Freeze Spec §2.4).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

export type LexiconProfileRegistryEntry = {
  id: string;
  displayName: string;
  enabled: boolean;
  allowLLMSelect: boolean;
  priority: number;
  parent?: string | null;
};

const REGISTRY_REL = path.join(
  'electron_node',
  'electron-node',
  'data',
  'lexicon',
  'profile-registry.json'
);

let cached: LexiconProfileRegistryEntry[] | null = null;

function resolveRegistryPath(): string {
  const candidates: string[] = [];
  const root = process.env.PROJECT_ROOT?.trim();
  if (root) {
    candidates.push(path.join(root, REGISTRY_REL));
  }
  candidates.push(path.resolve(__dirname, '../../../data/lexicon/profile-registry.json'));
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return candidates[candidates.length - 1];
}

export function loadLexiconProfileRegistry(): LexiconProfileRegistryEntry[] {
  if (cached) {
    return cached;
  }
  const filePath = resolveRegistryPath();
  const raw = fs.readFileSync(filePath, 'utf-8');
  cached = JSON.parse(raw) as LexiconProfileRegistryEntry[];
  return cached;
}

export function resetLexiconProfileRegistryCache(): void {
  cached = null;
}

export function getRegistryEntry(domainId: string): LexiconProfileRegistryEntry | undefined {
  return loadLexiconProfileRegistry().find((e) => e.id === domainId);
}

export function isValidLLMDomain(domainId: string): boolean {
  const entry = getRegistryEntry(domainId);
  return Boolean(entry?.enabled && entry.allowLLMSelect);
}

export function filterValidLLMDomains(domainIds: string[]): string[] {
  return domainIds.filter(isValidLLMDomain);
}

export function assertRegistryDomain(domainId: string): string | null {
  const entry = getRegistryEntry(domainId);
  if (!entry || !entry.enabled) {
    return null;
  }
  return entry.id;
}

export function defaultGeneralProfile(): ActiveLexiconProfileSnapshot {
  return {
    primaryDomain: 'general',
    secondaryDomains: [],
    boosts: { general: 1.0 },
    profileVersion: 'general-v1',
    confidence: 1.0,
    effectiveFromTurn: 0,
  };
}
