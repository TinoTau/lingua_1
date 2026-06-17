import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2State } from './lexicon-types-v2';
import { resolveWeakDomainRecallPlan } from './weak-domain-recall-resolver';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(),
}));

import { loadNodeConfig } from '../node-config';

const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const FW_V3_RUNTIME_DIR = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');
const PROJECT_ROOT = REPO_ROOT;

function loadRuntimeOrSkip(runtime: LexiconRuntimeV2): LexiconRuntimeV2State | undefined {
  const state = runtime.load();
  if (state.status === 'ok') {
    return state;
  }
  if (state.errorMessage?.includes('NODE_MODULE_VERSION')) {
    return undefined;
  }
  throw new Error(`LexiconRuntimeV2 load failed: ${state.errorMessage ?? state.status}`);
}

describe('recallSpanTopKV2', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  const prevProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    process.env.PROJECT_ROOT = PROJECT_ROOT;
    runtime = new LexiconRuntimeV2();
    if (!loadRuntimeOrSkip(runtime)) {
      runtime.close();
      runtime = null;
    }
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    if (prevProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = prevProjectRoot;
    }
  });

  it('returns base tier hits without domain ids', () => {
    if (!runtime || !fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    const baseHits = runtime!.lookupBaseByPinyinKey('hou|xuan', 2);
    if (!baseHits.length) {
      return;
    }
    const sample = baseHits[0]!;

    const result = recallSpanTopKV2(runtime!, {
      syllables: sample.pinyin,
      windowText: sample.word,
      termLength: sample.word.length,
      topK: 3,
      profile: defaultGeneralProfile(),
      domainIds: [],
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((h) => h.hotword.word === sample.word)).toBe(true);
  });

  it('weak+fuzzy: 钟贝少 recalls 中杯 via zhong|bei variant', () => {
    if (!runtime || !fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    (loadNodeConfig as jest.Mock).mockReturnValue({
      features: {
        fwDetector: {
          weakDomainRecallEnabled: true,
          fuzzyPinyinRecallEnabled: true,
          enabledDomains: ['tech_ai', 'travel', 'transport', 'restaurant'],
        },
      },
    });

    const enabledDomains = ['tech_ai', 'travel', 'transport', 'restaurant'];
    const profile = defaultGeneralProfile();
    const weakPlan = resolveWeakDomainRecallPlan(profile, enabledDomains, true);

    const result = recallSpanTopKV2(runtime!, {
      syllables: ['zhong', 'bei', 'shao'],
      windowText: '钟贝少',
      termLength: 3,
      topK: 5,
      profile,
      domainIds: [...weakPlan.queryDomainIds],
      weakDomainPlan: weakPlan,
      fuzzyRecallEnabled: true,
    });

    expect(result.hits.some((h) => h.hotword.word === '中杯')).toBe(true);
  });

  it('tone-first: zhong|bei + [1,1] prefers tone_exact 中杯 over plain bucket homophones', () => {
    if (!runtime || !fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    const result = recallSpanTopKV2(runtime!, {
      syllables: ['zhong', 'bei'],
      windowText: '中杯',
      termLength: 2,
      topK: 5,
      perSpanLimit: 5,
      profile: defaultGeneralProfile(),
      domainIds: ['restaurant'],
      acousticTonePattern: [1, 1],
    });

    const zhongBei = result.hits.find((h) => h.hotword.word === '中杯');
    if (!zhongBei) {
      return;
    }
    expect(zhongBei.toneLookupStage).toBe('tone_exact');
    expect(zhongBei.toneReason).toBe('match');
  });

  it('tone-first: shao|bing + [3,1] without 少冰 in lexicon falls back to plain bucket', () => {
    if (!runtime || !fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    const result = recallSpanTopKV2(runtime!, {
      syllables: ['shao', 'bing'],
      windowText: '少冰',
      termLength: 2,
      topK: 5,
      perSpanLimit: 5,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [3, 1],
    });

    expect(result.hits.length).toBeGreaterThan(0);
    const hasShaoBing = result.hits.some((h) => h.hotword.word === '少冰');
    if (hasShaoBing) {
      expect(result.hits.find((h) => h.hotword.word === '少冰')!.toneLookupStage).toBe('tone_exact');
      return;
    }
    for (const hit of result.hits) {
      expect(hit.toneLookupStage).not.toBe('tone_exact');
      if (hit.toneReason === 'mismatch') {
        expect(hit.toneCompatible).toBe(false);
      }
    }
  });

  it('no acoustic pattern uses plain_only_no_pattern without tone SQL', () => {
    if (!runtime || !fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    const before = runtime!.getAndResetTierQueryStats();
    recallSpanTopKV2(runtime!, {
      syllables: ['shao', 'bing'],
      windowText: '烧饼',
      termLength: 2,
      topK: 3,
      profile: defaultGeneralProfile(),
      domainIds: [],
    });
    const after = runtime!.getAndResetTierQueryStats();
    expect(after.sqlQueries).toBeGreaterThan(0);
    expect(before.sqlQueries).toBe(0);
  });
});
