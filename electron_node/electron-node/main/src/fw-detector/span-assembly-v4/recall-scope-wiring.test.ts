/**
 * Domain Recall Scope Wiring — CFG-01 restoration tests.
 * Verifies resolveRecallScope → recallDomainScope → Domain Lookup (no dual enabledDomains SSOT).
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import {
  resetRuntimeDomainRegistryForTest,
  setRuntimeDomainRegistry,
  type RuntimeDomainRegistry,
} from '../../lexicon-v2/runtime-domain-registry';
import { resolveRecallScope } from '../../lexicon-v2/resolve-recall-enabled-fine-domains';
import { defaultGeneralProfile } from '../../lexicon-v2/profile-registry';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { loadPinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-config';
import { runSpanAssemblyV4Orchestrator } from './span-assembly-v4-orchestrator';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../');
const FW_V3_RUNTIME_DIR = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');

function loadRuntimeOrSkip(runtime: LexiconRuntimeV2) {
  const state = runtime.load();
  if (state.status === 'ok') {
    return state;
  }
  if (state.errorMessage?.includes('NODE_MODULE_VERSION')) {
    return undefined;
  }
  throw new Error(`LexiconRuntimeV2 load failed: ${state.errorMessage ?? state.status}`);
}

const mockRegistry: RuntimeDomainRegistry = {
  availableFineDomains: ['coffee', 'hotel', 'medical'],
  availableCoarseDomains: ['restaurant', 'travel'],
  llmAllowedDomains: ['restaurant', 'travel'],
  fineToCoarseMap: {
    coffee: 'restaurant',
    hotel: 'travel',
    medical: 'medical',
  },
  coarseToFineMap: {
    restaurant: ['coffee'],
    travel: ['hotel'],
  },
  domainHierarchyVersion: 'test-wiring',
};

describe('Domain Recall Scope Wiring (CFG-01)', () => {
  beforeEach(() => {
    resetRuntimeDomainRegistryForTest();
    setRuntimeDomainRegistry(mockRegistry);
  });

  afterEach(() => {
    resetRuntimeDomainRegistryForTest();
  });

  it('Case A: empty config resolves to all availableFineDomains', () => {
    const scope = resolveRecallScope({ configEnabledDomains: [] });
    expect(scope.source).toBe('available');
    expect(scope.domainIds).toEqual(['coffee', 'hotel', 'medical']);
  });

  it('Case B: explicit scope stays explicit fine domains', () => {
    const scope = resolveRecallScope({ configEnabledDomains: ['coffee'] });
    expect(scope.source).toBe('policy');
    expect(scope.domainIds).toEqual(['coffee']);
  });

  it('Case C: invalid domain is dropped (not silently added)', () => {
    const scope = resolveRecallScope({ configEnabledDomains: ['not_a_real_domain', 'coffee'] });
    expect(scope.domainIds).toEqual(['coffee']);
    expect(scope.domainIds).not.toContain('not_a_real_domain');
  });

  it('Case D: no available fine domains → empty scope (caller must fail-fast)', () => {
    setRuntimeDomainRegistry({
      ...mockRegistry,
      availableFineDomains: [],
      availableCoarseDomains: [],
      fineToCoarseMap: {},
      coarseToFineMap: {},
    });
    const scope = resolveRecallScope({ configEnabledDomains: [] });
    expect(scope.domainIds).toEqual([]);
  });
});

describe('SpanAssemblyV4Orchestrator recallDomainScope contract', () => {
  it('rejects empty recallDomainScope (no Base-only silent fallback)', async () => {
    const runtime = new LexiconRuntimeV2();
    await expect(
      runSpanAssemblyV4Orchestrator({
        rawText: '我想要中杯拿铁',
        runtime,
        profile: defaultGeneralProfile(),
        recallDomainScope: [],
        minPrior: 0.5,
        imeConfig: loadPinyinImeV2RuntimeConfig(),
        dict: { tokens: [], byPinyin: new Map() } as never,
      })
    ).rejects.toThrow(/recallDomainScope is empty/);
  });
});

describe('Domain Lookup with resolved scope (integration)', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  const prevProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    process.env.PROJECT_ROOT = REPO_ROOT;
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    runtime = new LexiconRuntimeV2();
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    resetRuntimeDomainRegistryForTest();
    if (prevProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = prevProjectRoot;
    }
  });

  it('Case E/F/G/H: domain lookup runs; domain-only terms reach Vote; sameDomain can form; base preserved', async () => {
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    const state = loadRuntimeOrSkip(runtime!);
    if (!state) {
      return;
    }
    // load() installs RuntimeDomainRegistry from sqlite

    const scope = resolveRecallScope({ configEnabledDomains: [] });
    expect(scope.domainIds.length).toBeGreaterThan(0);
    expect(scope.domainIds).toContain('coffee');

    // Case E: domain multi lookup executes for coffee pinyin
    const domainHits = runtime!.lookupDomainsByPinyinKeyMulti(scope.domainIds, 'zhong|bei', 2);
    expect(domainHits.length).toBeGreaterThan(0);
    expect(domainHits.some((h) => h.word === '中杯')).toBe(true);
    expect(domainHits.some((h) => (h.domains?.length ?? 0) > 0)).toBe(true);

    const imeConfig = loadPinyinImeV2RuntimeConfig();
    let dict;
    try {
      dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
        enabledDomains: imeConfig.enabledDomains,
      });
    } catch {
      return;
    }

    const rawText = '你好我想点一杯热拿铁中杯少糖';
    const result = await runSpanAssemblyV4Orchestrator({
      rawText,
      runtime: runtime!,
      profile: defaultGeneralProfile(),
      recallDomainScope: scope.domainIds,
      minPrior: 0.5,
      imeConfig,
      dict,
      model3KeepAll: true,
    });

    expect(result.metrics.domainLookupExecuted).toBe(true);
    expect(result.metrics.domainLookupDomainCount).toBe(scope.domainIds.length);
    expect(result.metrics.resolvedRecallDomainScope?.length).toBe(scope.domainIds.length);
    expect(result.metrics.baseCandidateCount).toBeGreaterThan(0);

    // Domain candidates present in active path
    expect(
      (result.metrics.domainRecallHitCount ?? 0) + (result.metrics.voteEligibleDomainCandidateCount ?? 0)
    ).toBeGreaterThan(0);
    expect(result.metrics.voteEligibleDomainCandidateCount ?? 0).toBeGreaterThan(0);

    // Case F/G: with coffee evidence, winner should not be forced-general-from-wiring
    // (may still be general if scores insufficient — but domainScores should be non-empty)
    const scores = result.metrics.domainScores ?? {};
    expect(Object.keys(scores).length).toBeGreaterThan(0);
    expect(result.metrics.insufficientEvidence).toBe(false);
    expect(result.metrics.utteranceDomain).not.toBe('general');

    if (result.metrics.utteranceDomain !== 'general') {
      expect(result.metrics.sameDomainCandidateCount).toBeGreaterThan(0);
    }

    // Case H: base still present
    expect(result.metrics.baseCandidateCount).toBeGreaterThan(0);
  });

  it('does not treat empty domainIds as all-domains inside recallTopKForWindows', () => {
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    if (!loadRuntimeOrSkip(runtime!)) {
      return;
    }
    // Empty domainIds must skip domain lookup (legacy ambiguity forbidden at call site)
    const emptyHits = runtime!.lookupDomainsByPinyinKeyMulti([], 'zhong|bei', 2);
    expect(emptyHits).toEqual([]);
  });
});
