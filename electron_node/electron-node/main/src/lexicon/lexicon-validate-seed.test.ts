import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('lexicon validate-seed CLI', () => {
  it('rejects unknown domain via CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lexicon-val-'));
    const file = path.join(dir, 'bad.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: 'canonical_term',
        word: '测试',
        pinyin: 'ce shi',
        domains: ['travle'],
        priorScore: 0.5,
        source: 'test',
        enabled: true,
      })}\n`,
      'utf-8'
    );
    const script = path.resolve(__dirname, '../../../scripts/lexicon/validate-lexicon-seed.mjs');
    const result = spawnSync(process.execPath, [script, '--input', file], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/UNKNOWN_DOMAIN/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
