import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createLmScorer,
  getSentenceKenlmRuntimeStatus,
  resetLmScorerForTests,
  resolveCharLmModelPath,
} from './lm-scorer';

describe('lm-scorer sentence KenLM', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
    resetLmScorerForTests();
  });

  it('无模型时 fail-open：createLmScorer 为 null', () => {
    delete process.env.CHAR_LM_PATH;
    delete process.env.PROJECT_ROOT;
    resetLmScorerForTests();
    expect(createLmScorer()).toBeNull();
    const status = getSentenceKenlmRuntimeStatus();
    expect(status.enabled).toBe(false);
    expect(status.failOpen).toBe(true);
  });

  it('CHAR_LM_PATH 指向不存在文件时 fail-open', () => {
    process.env.CHAR_LM_PATH = path.join(os.tmpdir(), 'missing-kenlm-' + Date.now() + '.bin');
    resetLmScorerForTests();
    expect(resolveCharLmModelPath()).toBeNull();
    expect(createLmScorer()).toBeNull();
  });

  it('PROJECT_ROOT 下默认 trie 路径可解析', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingua-kenlm-'));
    const trie = path.join(tmp, 'models', 'kenlm', 'zh_char_3gram', 'zh_char_3gram.trie.bin');
    fs.mkdirSync(path.dirname(trie), { recursive: true });
    fs.writeFileSync(trie, 'placeholder');
    process.env.PROJECT_ROOT = tmp;
    delete process.env.CHAR_LM_PATH;
    resetLmScorerForTests();
    expect(resolveCharLmModelPath()).toBe(trie);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
