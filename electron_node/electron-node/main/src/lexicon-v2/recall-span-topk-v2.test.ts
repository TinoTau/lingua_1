import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';

const V2_SHADOW_DIR = path.resolve(
  __dirname,
  '../../../../../node_runtime/lexicon/v2_shadow'
);

describe('recallSpanTopKV2', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  const prevBundlePath = process.env.LEXICON_V2_BUNDLE_PATH;

  beforeEach(() => {
    if (!fs.existsSync(path.join(V2_SHADOW_DIR, 'manifest_v2.json'))) {
      return;
    }
    process.env.LEXICON_V2_BUNDLE_PATH = V2_SHADOW_DIR;
    runtime = new LexiconRuntimeV2();
    runtime.load();
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    if (prevBundlePath === undefined) {
      delete process.env.LEXICON_V2_BUNDLE_PATH;
    } else {
      process.env.LEXICON_V2_BUNDLE_PATH = prevBundlePath;
    }
  });

  it('returns base tier hits without domain ids', () => {
    if (!fs.existsSync(path.join(V2_SHADOW_DIR, 'manifest_v2.json'))) {
      return;
    }
    const state = runtime!.load();
    if (state.status !== 'ok') {
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
});
