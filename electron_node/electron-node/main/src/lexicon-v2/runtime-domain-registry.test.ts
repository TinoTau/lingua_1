import { beforeEach, describe, expect, it } from '@jest/globals';
import type Database from 'better-sqlite3';
import {
  buildRuntimeDomainRegistry,
  expandCoarseToAvailableFine,
  isCoarseDomainEligibleForLlm,
  isFineDomainEligibleForWinning,
  isFinePrimaryDomainRejected,
  resetRuntimeDomainRegistryForTest,
  setRuntimeDomainRegistry,
} from './runtime-domain-registry';
import {
  expandPolicyToFineDomains,
  resolveRecallScope,
} from './resolve-recall-enabled-fine-domains';

const FINE = [
  'bakery',
  'coffee',
  'food_order',
  'milk_tea',
  'tourism_hotel',
  'tourism_pickup',
  'tourism_route',
  'tourism_transport',
] as const;

const HIERARCHY = [
  { parent: 'restaurant', child: 'coffee' },
  { parent: 'restaurant', child: 'milk_tea' },
  { parent: 'restaurant', child: 'bakery' },
  { parent: 'restaurant', child: 'food_order' },
  { parent: 'travel', child: 'tourism_hotel' },
  { parent: 'travel', child: 'tourism_pickup' },
  { parent: 'travel', child: 'tourism_route' },
  { parent: 'travel', child: 'tourism_transport' },
];

function makeMockDb(opts: {
  tags: readonly string[];
  hierarchy?: readonly { parent: string; child: string }[];
}): Database.Database {
  const hierarchy = opts.hierarchy ?? [];
  return {
    prepare(sql: string) {
      if (sql.includes('sqlite_master')) {
        return {
          get(tableName: string) {
            if (tableName === 'term_domain_tags') {
              return { c: 1 };
            }
            if (tableName === 'domain_hierarchy') {
              return { c: hierarchy.length > 0 ? 1 : 0 };
            }
            return { c: 0 };
          },
        };
      }
      if (sql.includes('DISTINCT domain_id')) {
        return {
          all: () => opts.tags.map((domain_id) => ({ domain_id })),
        };
      }
      if (sql.includes('domain_hierarchy')) {
        return {
          all: () =>
            hierarchy.map((row) => ({
              parent_domain_id: row.parent,
              child_domain_id: row.child,
            })),
        };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  } as unknown as Database.Database;
}

describe('runtime-domain-registry', () => {
  beforeEach(() => {
    resetRuntimeDomainRegistryForTest();
  });

  it('REG-01: restaurant expands only to available fine children', () => {
    const db = makeMockDb({ tags: FINE, hierarchy: HIERARCHY });
    const registry = buildRuntimeDomainRegistry(db, {
      domainHierarchyVersion: 'test-v1',
      checksum: 'x',
      schemaVersion: 'lexicon-v3-five-table-v2',
    });
    setRuntimeDomainRegistry(registry);
    expect(expandCoarseToAvailableFine('restaurant')).toEqual([
      'bakery',
      'coffee',
      'food_order',
      'milk_tea',
    ]);
    expect(isCoarseDomainEligibleForLlm('restaurant')).toBe(true);
    expect(isCoarseDomainEligibleForLlm('coffee')).toBe(false);
    expect(isFinePrimaryDomainRejected('coffee')).toBe(true);
    expect(isFineDomainEligibleForWinning('coffee')).toBe(true);
    expect(isFineDomainEligibleForWinning('restaurant')).toBe(false);
  });

  it('RS-03A: policy restaurant resolves to available fine set', () => {
    const db = makeMockDb({ tags: FINE, hierarchy: HIERARCHY });
    const registry = buildRuntimeDomainRegistry(db, {
      domainHierarchyVersion: 'test-v1',
      checksum: 'x',
      schemaVersion: 'lexicon-v3-five-table-v2',
    });
    setRuntimeDomainRegistry(registry);
    const expanded = expandPolicyToFineDomains(['restaurant'], registry);
    expect(expanded).toEqual(['bakery', 'coffee', 'food_order', 'milk_tea']);
    const scope = resolveRecallScope({ configEnabledDomains: ['restaurant'] });
    expect(scope.source).toBe('policy');
    expect(scope.domainIds).toEqual(['bakery', 'coffee', 'food_order', 'milk_tea']);
  });

  it('REG-05: empty term_domain_tags throws', () => {
    const db = makeMockDb({ tags: [] });
    expect(() => buildRuntimeDomainRegistry(db, null)).toThrow(/empty/i);
  });

  it('fail-fast when domain_hierarchy table missing', () => {
    const db = {
      prepare(sql: string) {
        if (sql.includes('sqlite_master')) {
          return {
            get: (tableName: string) => ({
              c: tableName === 'term_domain_tags' ? 1 : 0,
            }),
          };
        }
        if (sql.includes('DISTINCT domain_id')) {
          return { all: () => [{ domain_id: 'coffee' }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      },
    } as unknown as import('better-sqlite3').Database;
    expect(() => buildRuntimeDomainRegistry(db, null)).toThrow(/domain_hierarchy table missing/i);
  });
});
