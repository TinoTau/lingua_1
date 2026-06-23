/**
 * RuntimeDomainRegistry — term_domain_tags + domain_hierarchy (Frozen Addendum v1.1).
 */

import type Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import type { LexiconManifestV2 } from './lexicon-types-v2';
import { getRegistryEntry, loadLexiconProfileRegistry } from './profile-registry';

export type RuntimeDomainRegistry = {
  availableFineDomains: readonly string[];
  availableCoarseDomains: readonly string[];
  llmAllowedDomains: readonly string[];
  fineToCoarseMap: Readonly<Record<string, string>>;
  coarseToFineMap: Readonly<Record<string, readonly string[]>>;
  domainHierarchyVersion: string;
};

type HierarchyRow = { parent_domain_id: string; child_domain_id: string };

let cachedRegistry: RuntimeDomainRegistry | null = null;

export function resetRuntimeDomainRegistryForTest(): void {
  cachedRegistry = null;
}

export function setRuntimeDomainRegistry(registry: RuntimeDomainRegistry | null): void {
  cachedRegistry = registry;
}

export function getRuntimeDomainRegistry(): RuntimeDomainRegistry {
  if (!cachedRegistry) {
    throw new Error('[RuntimeDomainRegistry] not loaded — lexicon runtime must load first');
  }
  return cachedRegistry;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { c: number };
  return (row.c ?? 0) > 0;
}

function loadHierarchyRows(db: Database.Database): HierarchyRow[] {
  if (!tableExists(db, 'domain_hierarchy')) {
    throw new Error(
      '[RuntimeDomainRegistry] domain_hierarchy table missing — run lexicon:build:v2-shadow → lexicon:prepare:v3-runtime'
    );
  }
  const rows = db
    .prepare('SELECT parent_domain_id, child_domain_id FROM domain_hierarchy')
    .all() as HierarchyRow[];
  if (rows.length === 0) {
    throw new Error('[RuntimeDomainRegistry] domain_hierarchy is empty — rebuild lexicon bundle');
  }
  return rows;
}

function resolveHierarchyVersion(manifest: LexiconManifestV2 | null): string {
  if (manifest?.domainHierarchyVersion?.trim()) {
    return manifest.domainHierarchyVersion.trim();
  }
  const registryPath = resolveRegistryFilePath();
  if (registryPath && fs.existsSync(registryPath)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(registryPath)).digest('hex');
    return `sha256:${hash}`;
  }
  return 'unknown';
}

function resolveRegistryFilePath(): string | null {
  const candidates: string[] = [];
  const root = process.env.PROJECT_ROOT?.trim();
  if (root) {
    candidates.push(`${root}/electron_node/electron-node/data/lexicon/profile-registry.json`);
  }
  candidates.push(path.resolve(__dirname, '../../../data/lexicon/profile-registry.json'));
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function buildMaps(
  availableFine: readonly string[],
  hierarchyRows: HierarchyRow[]
): Pick<
  RuntimeDomainRegistry,
  'fineToCoarseMap' | 'coarseToFineMap' | 'availableCoarseDomains' | 'llmAllowedDomains'
> {
  const availableSet = new Set(availableFine);
  const parentByChild = new Map<string, string>();
  for (const row of hierarchyRows) {
    parentByChild.set(row.child_domain_id, row.parent_domain_id);
  }

  const fineToCoarseMap: Record<string, string> = {};
  for (const fineId of availableFine) {
    const parent = parentByChild.get(fineId);
    fineToCoarseMap[fineId] = parent && parent !== 'general' ? parent : fineId;
  }

  const coarseToFineMap: Record<string, string[]> = {};
  for (const row of hierarchyRows) {
    if (!availableSet.has(row.child_domain_id)) {
      continue;
    }
    const list = coarseToFineMap[row.parent_domain_id] ?? [];
    if (!list.includes(row.child_domain_id)) {
      list.push(row.child_domain_id);
    }
    coarseToFineMap[row.parent_domain_id] = list;
  }
  for (const parent of Object.keys(coarseToFineMap)) {
    coarseToFineMap[parent].sort();
  }

  const availableCoarseDomains = Object.keys(coarseToFineMap)
    .filter((parent) => (coarseToFineMap[parent]?.length ?? 0) > 0)
    .sort();

  const llmSet = new Set<string>(availableCoarseDomains);
  for (const fineId of availableFine) {
    if (fineToCoarseMap[fineId] === fineId) {
      llmSet.add(fineId);
    }
  }

  return {
    fineToCoarseMap,
    coarseToFineMap,
    availableCoarseDomains,
    llmAllowedDomains: [...llmSet].sort(),
  };
}

export function buildRuntimeDomainRegistry(
  db: Database.Database,
  manifest: LexiconManifestV2 | null
): RuntimeDomainRegistry {
  if (!tableExists(db, 'term_domain_tags')) {
    throw new Error('[RuntimeDomainRegistry] term_domain_tags table missing');
  }

  const rows = db
    .prepare('SELECT DISTINCT domain_id FROM term_domain_tags ORDER BY domain_id')
    .all() as Array<{ domain_id: string }>;
  const availableFineDomains = rows.map((r) => r.domain_id.trim()).filter(Boolean);

  if (availableFineDomains.length === 0) {
    throw new Error('[RuntimeDomainRegistry] availableFineDomains is empty (REG-05)');
  }

  const hierarchyRows = loadHierarchyRows(db);

  const maps = buildMaps(availableFineDomains, hierarchyRows);

  return {
    availableFineDomains,
    ...maps,
    domainHierarchyVersion: resolveHierarchyVersion(manifest),
  };
}

export function installRuntimeDomainRegistry(
  db: Database.Database,
  manifest: LexiconManifestV2 | null
): RuntimeDomainRegistry {
  const registry = buildRuntimeDomainRegistry(db, manifest);
  cachedRegistry = registry;
  logger.info(
    {
      availableFineCount: registry.availableFineDomains.length,
      availableCoarseCount: registry.availableCoarseDomains.length,
      llmAllowedCount: registry.llmAllowedDomains.length,
      domainHierarchyVersion: registry.domainHierarchyVersion,
    },
    '[RuntimeDomainRegistry] ready'
  );
  return registry;
}

export function isCoarseDomainEligibleForLlm(domainId: string): boolean {
  const registry = getRuntimeDomainRegistry();
  return registry.llmAllowedDomains.includes(domainId);
}

export function isFineDomainEligibleForWinning(domainId: string): boolean {
  if (!domainId || domainId === 'general') {
    return false;
  }
  const registry = getRuntimeDomainRegistry();
  if (!registry.availableFineDomains.includes(domainId)) {
    return false;
  }
  const children = registry.coarseToFineMap[domainId];
  return !(children && children.length > 0);
}

export function getParentDomainId(domainId: string): string | null {
  if (!domainId || domainId === 'general') {
    return null;
  }
  const registry = getRuntimeDomainRegistry();
  const coarse = registry.fineToCoarseMap[domainId];
  if (!coarse || coarse === domainId) {
    return null;
  }
  return coarse;
}

export function expandCoarseToAvailableFine(coarseId: string): readonly string[] {
  const registry = getRuntimeDomainRegistry();
  return registry.coarseToFineMap[coarseId] ?? [];
}

export function isFinePrimaryDomainRejected(domainId: string): boolean {
  const registry = getRuntimeDomainRegistry();
  return (
    registry.availableFineDomains.includes(domainId) && !registry.llmAllowedDomains.includes(domainId)
  );
}

/** LLM prompt rows: id + displayName from profile-registry (display only). */
export function buildLlmAllowedDomainPayload(): Array<{
  id: string;
  displayName: string;
  enabled: boolean;
  allowLLMSelect: boolean;
}> {
  const registry = getRuntimeDomainRegistry();
  return registry.llmAllowedDomains.map((id) => {
    const entry = getRegistryEntry(id);
    return {
      id,
      displayName: entry?.displayName ?? id,
      enabled: true,
      allowLLMSelect: true,
    };
  });
}
