/**
 * LID 推理引擎：Sherpa-ONNX 语种识别，通过子进程调用 Python 脚本。
 * 输入：PCM16 16kHz 片段；输出：lang_pred 映射到 candidates 二选一。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import logger from '../logger';
import { getLidConfig } from '../node-config';
import { LidResult } from './lid-types';
import { LID_TIMEOUT_MS, LID_WINDOW_MS } from './lid-constants';

const SAMPLE_RATE = 16000;

function writeWavPcm16(filePath: string, pcm16: Buffer, sampleRate: number): void {
  const dataLen = pcm16.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcm16]));
}

export class LidEngine {
  private modelDir: string | null = null;
  private scriptPath: string | null = null;

  get isLoaded(): boolean {
    return this.modelDir !== null;
  }

  async loadModel(modelPath: string): Promise<void> {
    const lidConfig = getLidConfig();
    const resolved = path.isAbsolute(modelPath) ? modelPath : path.resolve(process.cwd(), modelPath);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`LID model path must be a directory: ${resolved}`);
    }
    const encoderPath = path.join(resolved, lidConfig.encoderFile);
    const decoderPath = path.join(resolved, lidConfig.decoderFile);
    if (!fs.existsSync(encoderPath)) throw new Error(`LID encoder not found: ${encoderPath}`);
    if (!fs.existsSync(decoderPath)) throw new Error(`LID decoder not found: ${decoderPath}`);

    const scriptPath = path.resolve(process.cwd(), 'scripts', 'lid_sherpa.py');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`LID script not found: ${scriptPath}`);
    }
    this.modelDir = resolved;
    this.scriptPath = scriptPath;
    logger.info({ path: resolved, encoder: lidConfig.encoderFile, decoder: lidConfig.decoderFile }, 'LID: Sherpa-ONNX model dir ready');
  }

  async infer(
    pcm16_16k: Buffer,
    window_ms: number,
    candidates: [string, string],
    prior: string
  ): Promise<LidResult> {
    const start = Date.now();
    if (!this.modelDir || !this.scriptPath) {
      throw new Error('LID model not loaded: 请设置 lid.modelPath 指向 Sherpa-ONNX 模型目录（含 tiny-encoder.int8.onnx / tiny-decoder.int8.onnx）');
    }
    const wantBytes = Math.floor((SAMPLE_RATE * 2 * window_ms) / 1000);
    const segment = pcm16_16k.length >= wantBytes ? pcm16_16k.subarray(0, wantBytes) : pcm16_16k;
    const wavPath = path.join(os.tmpdir(), `lid_${process.pid}_${Date.now()}.wav`);
    try {
      writeWavPcm16(wavPath, segment, SAMPLE_RATE);
      const python = process.env.PYTHON || 'python';
      const result = await runPythonLid(python, this.scriptPath, this.modelDir, wavPath, LID_TIMEOUT_MS);
      const elapsed = Date.now() - start;
      if (elapsed >= LID_TIMEOUT_MS) {
        throw new Error(`LID inference exceeded ${LID_TIMEOUT_MS}ms (took ${elapsed}ms)`);
      }
      const norm = (s: string) => s.split('-')[0].toLowerCase();
      const c0 = norm(candidates[0]);
      const c1 = norm(candidates[1]);
      const raw = norm(result.lang);
      let lang_pred: string;
      if (raw === c0) lang_pred = candidates[0];
      else if (raw === c1) lang_pred = candidates[1];
      else lang_pred = prior || candidates[0];
      logger.info({ lang_pred, raw, lid_ms: result.ms, candidates }, 'LID: infer result');
      return { lang_pred, p: 1, lid_ms: result.ms, strategy: 'model' };
    } finally {
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
    }
  }
}

function runPythonLid(
  python: string,
  scriptPath: string,
  modelDir: string,
  wavPath: string,
  timeoutMs: number
): Promise<{ lang: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [scriptPath, '--model-dir', modelDir, '--wav', wavPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`LID Python timeout (${timeoutMs}ms). stderr: ${stderr.slice(0, 200)}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(new Error(`LID Python exit ${code}. stderr: ${stderr.slice(0, 300)}`));
        return;
      }
      const line = stdout.trim().split('\n').pop() || '';
      try {
        const obj = JSON.parse(line);
        if (typeof obj.lang !== 'string' || typeof obj.ms !== 'number') throw new Error('invalid shape');
        resolve({ lang: obj.lang, ms: obj.ms });
      } catch (e) {
        reject(new Error(`LID Python invalid output: ${line.slice(0, 100)}`));
      }
    });
  });
}
