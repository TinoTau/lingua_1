import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import type { LexiconRuntimeV2State } from './lexicon-types-v2';

const REPO_ROOT = path.resolve(__dirname, '../../../../../');
const FW_V3_RUNTIME_DIR = path.join(REPO_ROOT, 'node_runtime', 'lexicon', 'v3');
const PROJECT_ROOT = REPO_ROOT;

/** Jest 使用系统 Node；better-sqlite3 为 Electron ABI 时需跳过。 */
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

describe('LexiconRuntimeV2', () => {
  let runtime: LexiconRuntimeV2 | null = null;
  const prevProjectRoot = process.env.PROJECT_ROOT;

  beforeEach(() => {
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    process.env.PROJECT_ROOT = PROJECT_ROOT;
    runtime = new LexiconRuntimeV2();
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

  it('loads v3 FW bundle (manifest_v2) and queries base tier', () => {
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }

    const state = loadRuntimeOrSkip(runtime!);
    if (!state) {
      return;
    }
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
    if (!fs.existsSync(path.join(FW_V3_RUNTIME_DIR, 'manifest.json'))) {
      return;
    }
    if (!loadRuntimeOrSkip(runtime!)) {
      return;
    }
    expect(runtime!.lookupDomainByPinyinKey('general', 'ka|fei', 2)).toEqual([]);
  });
});
