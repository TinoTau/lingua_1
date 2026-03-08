/**
 * LID 引擎单元测试（Sherpa-ONNX 子进程）
 */

import * as fs from 'fs';
import * as path from 'path';
import { LidEngine } from './lid-engine';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

describe('LidEngine', () => {
  let engine: LidEngine;
  let tmpDir: string;
  let scriptDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new LidEngine();
    tmpDir = path.join(process.cwd(), 'node_modules', '.cache', 'lid-engine-test');
    scriptDir = path.join(process.cwd(), 'scripts');
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  it('loadModel 要求目录且含 encoder 与 decoder', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    await expect(engine.loadModel(emptyDir)).rejects.toThrow('LID encoder not found');
  });

  it('loadModel 缺少 decoder 时抛错', async () => {
    const dir = path.join(tmpDir, 'no-decoder');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tiny-encoder.int8.onnx'), 'fake');
    await expect(engine.loadModel(dir)).rejects.toThrow('LID decoder not found');
  });

  it('loadModel 传入文件路径时抛错', async () => {
    const file = path.join(tmpDir, 'somefile');
    fs.writeFileSync(file, 'fake');
    await expect(engine.loadModel(file)).rejects.toThrow('must be a directory');
  });

  it('loadModel 成功时 isLoaded 为 true（需存在 scripts/lid_sherpa.py）', async () => {
    const dir = path.join(tmpDir, 'ok');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tiny-encoder.int8.onnx'), 'fake');
    fs.writeFileSync(path.join(dir, 'tiny-decoder.int8.onnx'), 'fake');
    const scriptPath = path.join(scriptDir, 'lid_sherpa.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('Skip loadModel success test: scripts/lid_sherpa.py not found');
      return;
    }
    await engine.loadModel(dir);
    expect(engine.isLoaded).toBe(true);
  });

  it('infer 在未加载时抛错', async () => {
    await expect(engine.infer(Buffer.alloc(32000), 1000, ['zh', 'en'], 'zh')).rejects.toThrow(
      'LID model not loaded'
    );
  });

  it('infer 在加载后通过子进程得到 lang 并映射到 candidates', async () => {
    const dir = path.join(tmpDir, 'infer-ok');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tiny-encoder.int8.onnx'), 'fake');
    fs.writeFileSync(path.join(dir, 'tiny-decoder.int8.onnx'), 'fake');
    const scriptPath = path.join(scriptDir, 'lid_sherpa.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('Skip infer test: scripts/lid_sherpa.py not found');
      return;
    }
    await engine.loadModel(dir);

    mockSpawn.mockImplementation(() => {
      const line = '{"lang":"zh","ms":12}\n';
      let dataCb: ((d: Buffer) => void) | null = null;
      let closeCb: ((code: number) => void) | null = null;
      const child = {
        stdout: { on: (_: string, fn: (d: Buffer) => void) => { dataCb = fn; } },
        stderr: { on: () => {} },
        on: (ev: string, fn: (code: number) => void) => { if (ev === 'close') closeCb = fn; },
        kill: () => {},
      };
      setImmediate(() => {
        if (dataCb) dataCb(Buffer.from(line));
        if (closeCb) closeCb(0);
      });
      return child;
    });

    const result = await engine.infer(Buffer.alloc(32000), 1000, ['zh', 'en'], 'zh');
    expect(result.strategy).toBe('model');
    expect(result.lang_pred).toBe('zh');
    expect(result.lid_ms).toBe(12);
    expect(result.p).toBe(1);
  });
});
