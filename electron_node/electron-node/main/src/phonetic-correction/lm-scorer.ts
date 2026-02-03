/**
 * 字符级 LM 打分：通过 KenLM query 子进程对 token 序列打分。
 * LM 文件缺失或 query 不可用时返回 null，调用方返回原文（fail-open）。
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { tokenizeForLm } from './char-tokenize';

export interface LmScoreResult {
  score: number;
  oovCount: number;
}

export interface CharLmScorer {
  score(text: string): Promise<LmScoreResult>;
}

const DEFAULT_MODEL_NAME = 'zh_char_3gram.trie.bin';

function getModelPath(): string | null {
  const fromEnv = process.env.CHAR_LM_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const cwd = process.cwd();
  const inAssets = path.join(cwd, 'assets', 'models', DEFAULT_MODEL_NAME);
  if (fs.existsSync(inAssets)) return inAssets;
  return null;
}

function getQueryPath(): string {
  const fromEnv = process.env.KENLM_QUERY_PATH;
  if (fromEnv) return fromEnv;
  return process.platform === 'win32' ? 'query.exe' : 'query';
}

/** 解析 KenLM query 输出行：Total: <score> OOV: <n> */
function parseQueryLine(line: string): LmScoreResult {
  let score = 0;
  let oovCount = 0;
  const totalMatch = line.match(/Total:\s*([-\d.e]+)/i);
  if (totalMatch) score = parseFloat(totalMatch[1]);
  const oovMatch = line.match(/OOV:\s*(\d+)/i);
  if (oovMatch) oovCount = parseInt(oovMatch[1], 10);
  return { score: Number.isNaN(score) ? 0 : score, oovCount };
}

/**
 * 创建 LM 打分器。模型文件缺失时返回 null（fail-open）。
 */
export function createLmScorer(): CharLmScorer | null {
  const modelPath = getModelPath();
  if (!modelPath) return null;
  const queryPath = getQueryPath();

  return {
    async score(text: string): Promise<LmScoreResult> {
      const tokenized = tokenizeForLm(text);
      if (!tokenized) return { score: 0, oovCount: 0 };
      return new Promise((resolve) => {
        const proc = spawn(queryPath, [modelPath], { stdio: ['pipe', 'pipe', 'ignore'] });
        let out = '';
        proc.stdout.setEncoding('utf-8');
        proc.stdout.on('data', (chunk: string) => { out += chunk; });
        proc.stdout.on('end', () => {
          const line = out.trim().split('\n')[0] ?? '';
          resolve(parseQueryLine(line));
        });
        proc.on('error', () => resolve({ score: 0, oovCount: 0 }));
        proc.stdin.write(tokenized + '\n', 'utf-8', () => proc.stdin.end());
      });
    },
  };
}

let scorerInstance: CharLmScorer | null | undefined = undefined;

/** 懒加载，只创建一次；不可用时为 null（fail-open）。 */
export function getLmScorer(): CharLmScorer | null {
  if (scorerInstance === undefined) scorerInstance = createLmScorer();
  return scorerInstance;
}
