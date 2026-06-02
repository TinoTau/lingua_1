import { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';

export type RecallSmokeCase = {
  label: string;
  tier: 'base' | 'domain';
  domainId?: string;
  pinyinKey: string;
  termLength: number;
  expectWord?: string;
  expectHit: boolean;
};

export type RecallSmokeRow = {
  label: string;
  tier: string;
  pinyinKey: string;
  termLength: number;
  expectHit: boolean;
  passed: boolean;
  hits: Array<{ word: string; priorScore: number; isAlias: boolean; domain?: string }>;
};

export function runRecallSmoke(bundleDir: string, cases: RecallSmokeCase[]): RecallSmokeRow[] {
  const runtime = new LexiconRuntimeV2();
  const state = runtime.loadFromBundleDir(bundleDir);
  if (state.status !== 'ok') {
    throw new Error(`recall smoke: runtime load failed: ${state.errorMessage ?? state.status}`);
  }

  const rows: RecallSmokeRow[] = [];
  for (const c of cases) {
    let hits;
    if (c.tier === 'base') {
      hits = runtime.lookupBaseByPinyinKey(c.pinyinKey, c.termLength, 5);
    } else {
      hits = runtime.lookupDomainByPinyinKey(c.domainId ?? 'travel', c.pinyinKey, c.termLength, 5);
    }
    const mapped = hits.map((h) => ({
      word: h.word,
      priorScore: h.priorScore,
      isAlias: h.isAlias === true,
      domain: h.domain,
    }));
    let passed: boolean;
    if (c.expectHit) {
      passed =
        c.expectWord != null
          ? mapped.some((h) => h.word === c.expectWord)
          : mapped.length > 0;
    } else {
      passed =
        c.expectWord != null
          ? !mapped.some((h) => h.word === c.expectWord)
          : mapped.length === 0;
    }
    rows.push({
      label: c.label,
      tier: c.tier,
      pinyinKey: c.pinyinKey,
      termLength: c.termLength,
      expectHit: c.expectHit,
      passed,
      hits: mapped,
    });
  }
  runtime.close();
  return rows;
}
