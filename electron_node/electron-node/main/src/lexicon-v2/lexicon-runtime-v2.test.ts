import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from './lexicon-runtime-v2';

const V2_SHADOW_DIR = path.resolve(
  __dirname,
  '../../../../../node_runtime/lexicon/v2_shadow'
);

describe('LexiconRuntimeV2', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  const prevBundlePath = process.env.LEXICON_V2_BUNDLE_PATH;
  const prevProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    if (!fs.existsSync(path.join(V2_SHADOW_DIR, 'manifest_v2.json'))) {
      return;
    }
    process.env.LEXICON_V2_BUNDLE_PATH = V2_SHADOW_DIR;
    runtime = new LexiconRuntimeV2();
  });

  afterEach(() => {
    runtime?.close();
    runtime = null;
    if (prevBundlePath === undefined) {
      delete process.env.LEXICON_V2_BUNDLE_PATH;
    } else {
      process.env.LEXICON_V2_BUNDLE_PATH = prevBundlePath;
    }
    if (prevProjectRoot === undefined) {
      delete process.env.PROJECT_ROOT;
    } else {
      process.env.PROJECT_ROOT = prevProjectRoot;
    }
  });

  it('loads v2 shadow bundle and queries base tier', () => {
    if (!fs.existsSync(path.join(V2_SHADOW_DIR, 'manifest_v2.json'))) {
      return;
    }

    const state = runtime!.load();
    expect(state.status).toBe('ok');
    expect(state.tableCounts?.base).toBeGreaterThan(0);

    const hits = runtime!.lookupBaseByPinyinKey('hou|xuan', 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits.every((h) => h.word.length === 2)).toBe(true);

    const cached = runtime!.lookupBaseByPinyinKey('hou|xuan', 2);
    expect(cached).toEqual(hits);
    expect(runtime!.getCacheStats().hits).toBeGreaterThan(0);
  });

  it('returns empty for general domain lookup', () => {
    if (!fs.existsSync(path.join(V2_SHADOW_DIR, 'manifest_v2.json'))) {
      return;
    }
    runtime!.load();
    expect(runtime!.lookupDomainByPinyinKey('general', 'ka|fei', 2)).toEqual([]);
  });
});
