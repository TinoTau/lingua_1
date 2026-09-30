/**
 * ACP MODEL3-RETRY-STAGE2-TONE-RELAXATION-V1 — focused Stage2 recovery + domain cases.
 * First-pass Mandatory Tone remains Fail Closed (Batch 1.1C).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import {
  RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
  RECALL_MODE_TONE_EXACT,
} from './recall-semantic-mode';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import {
  createLength1TempSqliteBundle,
  type Length1TempBundle,
} from '../fw-detector/span-assembly-v4/length1-real-sqlite.test.helpers';

jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({ features: { fwDetector: {} } })),
}));

const SYN_BASE = {
  id: 'acp_s2_base_alpha',
  pinyinKey: 'acp|base',
  tonePinyinKey: 'acp1|base1',
  word: '基测',
  priorScore: 0.95,
};

const SYN_DOMAIN_TRAVEL = {
  id: 'acp_s2_dom_travel',
  domainId: 'tourism_transport',
  pinyinKey: 'acp|trav',
  tonePinyinKey: 'acp1|trav2',
  word: '旅测',
  priorScore: 0.92,
  repairTarget: true,
};

const SYN_DOMAIN_MEDICAL = {
  id: 'acp_s2_dom_medical',
  domainId: 'medical',
  pinyinKey: 'acp|medi',
  tonePinyinKey: 'acp1|medi3',
  word: '医测',
  priorScore: 0.91,
  repairTarget: true,
};

const SYN_DOMAIN_MULTI = {
  id: 'acp_s2_dom_multi',
  domainId: 'tourism_transport',
  pinyinKey: 'acp|mult',
  tonePinyinKey: 'acp2|mult4',
  word: '多测',
  priorScore: 0.9,
  repairTarget: true,
};

const SYN_DOMAIN_MULTI_ALT = {
  id: 'acp_s2_dom_multi',
  domainId: 'medical',
  pinyinKey: 'acp|mult',
  tonePinyinKey: 'acp2|mult4',
  word: '多测',
  priorScore: 0.9,
  repairTarget: true,
};

function boot(): LexiconRuntimeV2 {
  const bundle = createLength1TempSqliteBundle({
    baseRows: [SYN_BASE],
    domainRows: [
      SYN_DOMAIN_TRAVEL,
      SYN_DOMAIN_MEDICAL,
      SYN_DOMAIN_MULTI,
      SYN_DOMAIN_MULTI_ALT,
    ],
    prefix: 'acp-s2-tone-relax-',
  });
  (globalThis as { __acpS2Bundle?: Length1TempBundle }).__acpS2Bundle = bundle;
  return bundle.loadRuntime();
}

describe('Stage2 Tone-relax + domain context (ACP V1)', () => {
  afterEach(() => {
    const b = (globalThis as { __acpS2Bundle?: Length1TempBundle }).__acpS2Bundle;
    b?.cleanup();
    delete (globalThis as { __acpS2Bundle?: Length1TempBundle }).__acpS2Bundle;
  });

  it('NORMAL wrong/missing Tone → Fail Closed; no pinyin-only fallback', () => {
    const rt = boot();
    const noTone = recallSpanTopKV2(rt, {
      syllables: ['acp', 'base'],
      windowText: '基测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: [],
      recallMode: RECALL_MODE_TONE_EXACT,
    });
    expect(noTone.hits).toHaveLength(0);
    expect(noTone.toneRecallReadiness?.state).toBe('no_pattern');

    const wrongTone = recallSpanTopKV2(rt, {
      syllables: ['acp', 'base'],
      windowText: '基测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: [],
      acousticTonePattern: [5, 5],
      recallMode: RECALL_MODE_TONE_EXACT,
    });
    expect(wrongTone.hits.some((h) => h.hotword.word === '基测')).toBe(false);
    rt.close();
  });

  it('CASE A BASE: recovery recalls base target without usable Tone', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['acp', 'base'],
      windowText: '基测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: [],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(result.hits.some((h) => h.hotword.word === '基测')).toBe(true);
    expect(result.hits.find((h) => h.hotword.word === '基测')!.toneLookupStage).toBe(
      'pinyin_domain_recovery'
    );
    rt.close();
  });

  it('CASE B DOMAIN-ONLY POSITIVE: retainedDomains contains domain', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['acp', 'trav'],
      windowText: '旅测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: ['tourism_transport'],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(result.hits.some((h) => h.hotword.word === '旅测')).toBe(true);
    rt.close();
  });

  it('CASE C DOMAIN-ONLY NEGATIVE: out-of-bucket domain not recalled', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['acp', 'medi'],
      windowText: '医测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: ['tourism_transport'],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(result.hits.some((h) => h.hotword.word === '医测')).toBe(false);
    rt.close();
  });

  it('CASE D MULTI-DOMAIN POSITIVE: intersects retainedDomains', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['acp', 'mult'],
      windowText: '多测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: ['medical'],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(result.hits.some((h) => h.hotword.word === '多测')).toBe(true);
    rt.close();
  });

  it('CASE E EMPTY retainedDomains: no all-domain fallback for domain-only', () => {
    const rt = boot();
    const result = recallSpanTopKV2(rt, {
      syllables: ['acp', 'trav'],
      windowText: '旅测',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: [],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(result.hits.some((h) => h.hotword.word === '旅测')).toBe(false);
    rt.close();
  });

  it('PATH ISOLATION: different retainedDomains do not cross-leak', () => {
    const rt = boot();
    const pathA = recallSpanTopKV2(rt, {
      syllables: ['acp', 'trav'],
      windowText: 'xx',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: ['tourism_transport'],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    const pathB = recallSpanTopKV2(rt, {
      syllables: ['acp', 'medi'],
      windowText: 'yy',
      termLength: 2,
      topK: 4,
      profile: defaultGeneralProfile(),
      domainIds: ['medical'],
      recallMode: RECALL_MODE_MODEL3_RETRY_PINYIN_DOMAIN_RECOVERY,
    });
    expect(pathA.hits.some((h) => h.hotword.word === '旅测')).toBe(true);
    expect(pathA.hits.some((h) => h.hotword.word === '医测')).toBe(false);
    expect(pathB.hits.some((h) => h.hotword.word === '医测')).toBe(true);
    expect(pathB.hits.some((h) => h.hotword.word === '旅测')).toBe(false);
    rt.close();
  });
});
