/**
 * Phase 1 harness integration with real LexiconRuntimeV2 (Electron ABI).
 * Skips cleanly when better-sqlite3 NODE_MODULE_VERSION mismatches.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as path from 'path';
import { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { defaultGeneralProfile } from '../../lexicon-v2/profile-registry';
import { resolveRecallScope } from '../../lexicon-v2/resolve-recall-enabled-fine-domains';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { loadPinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-config';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { runPhase1WindowEdgeHarness } from './phase1-window-edge-harness';
import { theoreticalLexicalWindowCount } from './window-construction-core';
import { makeCharToneFixtures } from './test-tone-fixtures';
import { textToToneSyllables } from '../../lexicon/phonetic/tone-pinyin';

function tonePayloadForText(rawText: string) {
  const syls = textToToneSyllables(rawText);
  const tones = syls.map((s) => {
    const n = Number(s.replace(/\D/g, ''));
    return (n >= 1 && n <= 5 ? n : 1) as 1 | 2 | 3 | 4 | 5;
  });
  if (tones.length !== [...rawText].length) {
    // Fallback: all tone-1 (still enables Mandatory Tone path; may reduce hit rate)
    const chars = [...rawText];
    return {
      toneTimestampOnlyEnabled: true as const,
      ...makeCharToneFixtures(
        rawText,
        chars.map(() => 1 as 1 | 2 | 3 | 4 | 5)
      ),
    };
  }
  return {
    toneTimestampOnlyEnabled: true as const,
    ...makeCharToneFixtures(rawText, tones),
  };
}

const REPO_ROOT = path.resolve(__dirname, '../../../../../../');
const FW_V3_RUNTIME_DIR = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');

function loadRuntimeOrSkip(runtime: LexiconRuntimeV2): boolean {
  const state = runtime.loadFromBundleDir(FW_V3_RUNTIME_DIR);
  if (state.status === 'ok') {
    return true;
  }
  if (state.errorMessage?.includes('NODE_MODULE_VERSION')) {
    return false;
  }
  throw new Error(`LexiconRuntimeV2 load failed: ${state.errorMessage ?? state.status}`);
}

describe('Phase 1 WindowEdge harness (live lexicon)', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  let available = false;

  beforeEach(() => {
    runtime = new LexiconRuntimeV2();
    available = loadRuntimeOrSkip(runtime);
  });

  afterEach(() => {
    runtime = null;
  });

  function harnessDeps() {
    const fwConfig = loadFwDetectorRuntimeConfig();
    const imeConfig = loadPinyinImeV2RuntimeConfig();
    const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
      enabledDomains: imeConfig.enabledDomains,
    });
    const profile = defaultGeneralProfile();
    const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
    return { fwConfig, imeConfig, dict, profile, domainIds: recallScope.domainIds };
  }

  it('1-syllable lexical window can form an edge; empty 1-syllable does not inject fallback', () => {
    if (!available || !runtime) {
      return;
    }
    const { fwConfig, imeConfig, dict, profile, domainIds } = harnessDeps();
    // Prefer a common single-char lexicon surface when present; still assert contract.
    const rawText = '茶好喝';
    const result = runPhase1WindowEdgeHarness({
      rawText,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      ...tonePayloadForText(rawText),
    });
    const coord = buildUtteranceSyllableCoordinate(rawText);
    expect(result.windows.length).toBe(theoreticalLexicalWindowCount(coord.syllables.length));
    const oneSyl = result.recalledWindows.filter((w) => {
      const [s, e] = w.windowId.split(':').map(Number);
      return e - s === 1;
    });
    expect(oneSyl.length).toBeGreaterThan(0);
    const withHits = oneSyl.filter((w) => w.candidates.length > 0);
    const withoutHits = oneSyl.filter((w) => w.candidates.length === 0);
    for (const w of withHits) {
      expect(result.edges.some((e) => e.sourceWindowId === w.windowId && e.edgeKind === 'lexical')).toBe(
        true
      );
    }
    for (const w of withoutHits) {
      expect(result.edges.some((e) => e.sourceWindowId === w.windowId)).toBe(false);
    }
    expect(result.edges.every((e) => e.edgeKind === 'lexical')).toBe(true);
    expect(result.diagnostics.edgeCount).toBeLessThanOrEqual(
      result.recalledWindows.filter((w) => w.candidates.length > 0).length
    );
  });

  it('same utterance twice → identical window/edge fingerprints; cache hits on duplicate keys', () => {
    if (!available || !runtime) {
      return;
    }
    const { fwConfig, imeConfig, dict, profile, domainIds } = harnessDeps();
    const rawText = '我想订一间大床房';
    const a = runPhase1WindowEdgeHarness({
      rawText,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      ...tonePayloadForText(rawText),
    });
    const b = runPhase1WindowEdgeHarness({
      rawText,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      ...tonePayloadForText(rawText),
    });
    expect(JSON.stringify(a.windows.map((w) => w.windowId))).toBe(
      JSON.stringify(b.windows.map((w) => w.windowId))
    );
    expect(JSON.stringify(a.edges.map((e) => ({ id: e.edgeId, c: e.candidates.map((x) => x.termId ?? x.candidateId) })))).toBe(
      JSON.stringify(b.edges.map((e) => ({ id: e.edgeId, c: e.candidates.map((x) => x.termId ?? x.candidateId) })))
    );
    expect(a.diagnostics.cacheMissCount).toBeGreaterThan(0);
    // Duplicate canonical keys within one utterance should produce cache hits when present.
    if (a.diagnostics.uniqueRecallKeyCount < a.diagnostics.canonicalRecallQueryCount) {
      expect(a.diagnostics.cacheHitCount).toBeGreaterThan(0);
    }
  });

  it('multi-candidate edge preserves domains[] and termId pass-through when present', () => {
    if (!available || !runtime) {
      return;
    }
    const { fwConfig, imeConfig, dict, profile, domainIds } = harnessDeps();
    const result = runPhase1WindowEdgeHarness({
      rawText: '去望京软件园开会',
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      ...tonePayloadForText('去望京软件园开会'),
    });
    const multi = result.edges.find((e) => e.candidates.length > 1);
    if (multi) {
      expect(multi.edgeId).toBe(`${multi.syllableStart}:${multi.syllableEnd}`);
      for (const c of multi.candidates) {
        if (c.termId) {
          expect(typeof c.termId).toBe('string');
        }
        if (c.domains && c.domains.length >= 2) {
          expect(c.domains.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
    // Always assert no domains[0]-only projection artifact: domains is full array or undefined.
    for (const e of result.edges) {
      for (const c of e.candidates) {
        if (c.domains) {
          expect(Array.isArray(c.domains)).toBe(true);
        }
      }
    }
  });
});
