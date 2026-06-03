import { loadNodeConfig } from '../../node-config';
import { DEFAULT_CONFIG } from '../../node-config-defaults';
import { defaultPinyinImeV2DictDir, resolvePinyinImeV2DictDir } from './pinyin-ime-v2-dict-load';
import type { PinyinImeV2RuntimeConfig } from './pinyin-ime-v2-types';

const DEFAULT_PINYIN_IME_V2: PinyinImeV2RuntimeConfig = {
  enabled: true,
  topK: 5,
  maxApprovedSpans: 4,
  minSupportCount: 2,
  minSpanChars: 2,
  maxSpanChars: 6,
  minSyllables: 2,
  maxSyllables: 5,
  directRepair: false,
  dictDir: defaultPinyinImeV2DictDir(),
  enabledDomains: DEFAULT_CONFIG.features?.fwDetector?.enabledDomains ?? [],
};

export function loadPinyinImeV2RuntimeConfig(): PinyinImeV2RuntimeConfig {
  const raw = loadNodeConfig().features?.pinyinImeV2;
  if (!raw) {
    return { ...DEFAULT_PINYIN_IME_V2 };
  }

  return {
    enabled: raw.enabled === true,
    topK: raw.topK ?? DEFAULT_PINYIN_IME_V2.topK,
    maxApprovedSpans: raw.maxApprovedSpans ?? DEFAULT_PINYIN_IME_V2.maxApprovedSpans,
    minSupportCount: raw.minSupportCount ?? DEFAULT_PINYIN_IME_V2.minSupportCount,
    minSpanChars: raw.minSpanChars ?? DEFAULT_PINYIN_IME_V2.minSpanChars,
    maxSpanChars: raw.maxSpanChars ?? DEFAULT_PINYIN_IME_V2.maxSpanChars,
    minSyllables: raw.minSyllables ?? DEFAULT_PINYIN_IME_V2.minSyllables,
    maxSyllables: raw.maxSyllables ?? DEFAULT_PINYIN_IME_V2.maxSyllables,
    directRepair: false,
    dictDir: raw.dictDir?.trim() ? resolvePinyinImeV2DictDir(raw.dictDir.trim()) : defaultPinyinImeV2DictDir(),
    enabledDomains:
      Array.isArray(raw.enabledDomains) && raw.enabledDomains.length > 0
        ? raw.enabledDomains
        : DEFAULT_PINYIN_IME_V2.enabledDomains,
  };
}

export { DEFAULT_PINYIN_IME_V2 };
