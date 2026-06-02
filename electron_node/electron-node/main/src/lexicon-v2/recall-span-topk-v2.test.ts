import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2State } from './lexicon-types-v2';

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
});
