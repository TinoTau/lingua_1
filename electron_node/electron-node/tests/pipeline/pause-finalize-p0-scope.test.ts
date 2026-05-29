/**
 * P0-Guard Gate 4：pause finalize 已移出 P0 验收（产品决策 B）。
 */
import * as fs from 'fs';
import * as path from 'path';

describe('P0-Guard Gate 4: pause finalize 移出 P0', () => {
  it('audio-aggregator 注释标明 pause finalize 已删除', () => {
    const file = path.join(
      __dirname,
      '../../main/src/pipeline-orchestrator/audio-aggregator.ts'
    );
    const src = fs.readFileSync(file, 'utf-8');
    expect(src).toMatch(/pause finalize 已删除/);
    expect(src).not.toMatch(/is_pause_triggered\s*=\s*true/);
  });
});
