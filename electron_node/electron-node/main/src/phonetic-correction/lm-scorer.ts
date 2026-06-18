/**
 * 字符级 LM 打分：通过 KenLM query 子进程对 token 序列打分。
 * 供 Recover Sentence Rerank 使用；与 CTC asrKenlmMeta 无关。
 * LM 文件或 query 不可用时返回 null（fail-open）。
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { tokenizeForLm } from './char-tokenize';

export interface LmScoreResult {
  score: number;
  oovCount: number;
}

export interface CharLmScorer {
  score(text: string): Promise<LmScoreResult>;
}

export type KenlmQueryBatchResult =
  | { ok: true; results: LmScoreResult[]; wallMs: number }
  | { ok: false; reason: string };

const DEFAULT_MODEL_NAME = 'zh_char_3gram.trie.bin';

/** 相对 PROJECT_ROOT 的 Sentence KenLM 产物路径（两套布局兼容） */
const SENTENCE_KENLM_TRIE_REL = path.join(
  'models',
  'kenlm',
  'zh_char_3gram',
  'zh_char_3gram.trie.bin'
);
const KENLM_DIR_TRIE_REL = path.join('kenLM', 'model', 'zh_char_3gram.trie.bin');
/** Sentence KenLM 与 asr_sherpa_lm 服务同仓布局 */
const ASR_SHERPA_SENTENCE_KENLM_REL = path.join(
  'electron_node',
  'services',
  'asr_sherpa_lm',
  'models',
  'kenLM',
  'zh_char_3gram.trie.bin'
);

export type SentenceKenlmRuntimeStatus = {
  enabled: boolean;
  modelPath: string | null;
  queryPath: string;
  reason?: string;
  failOpen: boolean;
};

type KenlmSpawnPlan = {
  cmd: string;
  args: string[];
};

let subprocessLock: Promise<void> = Promise.resolve();

function resolveProjectRoot(): string | null {
  const fromEnv = process.env.PROJECT_ROOT?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  return null;
}

/** 解析模型 trie 路径：CHAR_LM_PATH → PROJECT_ROOT/models/kenlm/... → cwd/assets/models */
export function resolveCharLmModelPath(): string | null {
  const fromEnv = process.env.CHAR_LM_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const projectRoot = resolveProjectRoot();
  if (projectRoot) {
    for (const rel of [ASR_SHERPA_SENTENCE_KENLM_REL, KENLM_DIR_TRIE_REL, SENTENCE_KENLM_TRIE_REL]) {
      const p = path.join(projectRoot, rel);
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }
  const fromElectronNode = path.join(
    process.cwd(),
    '..',
    'services',
    'asr_sherpa_lm',
    'models',
    'kenLM',
    'zh_char_3gram.trie.bin'
  );
  if (fs.existsSync(fromElectronNode)) {
    return path.normalize(fromElectronNode);
  }
  const cwd = process.cwd();
  const inAssets = path.join(cwd, 'assets', 'models', DEFAULT_MODEL_NAME);
  if (fs.existsSync(inAssets)) {
    return inAssets;
  }
  return null;
}

/** KenLM query 可执行文件 */
export function resolveKenlmQueryPath(): string {
  const fromEnv = process.env.KENLM_QUERY_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const projectRoot = resolveProjectRoot();
  if (projectRoot) {
    const binName = process.platform === 'win32' ? 'query.exe' : 'query';
    for (const relDir of [
      path.join('kenLM', 'kenlm', 'build', 'bin'),
      path.join('addons', 'char-lm', 'kenlm', 'build', 'bin'),
    ]) {
      const candidate = path.join(projectRoot, relDir, binName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return process.platform === 'win32' ? 'query.exe' : 'query';
}

export function getSentenceKenlmRuntimeStatus(): SentenceKenlmRuntimeStatus {
  const modelPath = resolveCharLmModelPath();
  const queryPath = resolveKenlmQueryPath();
  if (!modelPath) {
    return {
      enabled: false,
      modelPath: null,
      queryPath,
      reason: 'CHAR_LM_PATH missing or trie not found',
      failOpen: true,
    };
  }
  return {
    enabled: true,
    modelPath,
    queryPath,
    failOpen: true,
  };
}

function windowsPathToWsl(winPath: string): string {
  const normalized = winPath.replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!m) {
    return normalized;
  }
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}

function resolveWslKenlmQueryBin(projectRoot: string | null): string | null {
  if (!projectRoot) {
    return null;
  }
  const q = path.join(projectRoot, 'kenLM', 'kenlm', 'build', 'bin', 'query');
  return fs.existsSync(q) ? q : null;
}

function shouldRunKenlmQueryViaWsl(queryPath: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  if (queryPath === 'wsl' || queryPath === 'wsl.exe') {
    return true;
  }
  return !fs.existsSync(queryPath);
}

function planKenlmSpawn(modelPath: string, queryPath: string): KenlmSpawnPlan | null {
  const projectRoot = resolveProjectRoot();
  const useWsl = shouldRunKenlmQueryViaWsl(queryPath);
  const wslQuery = useWsl ? resolveWslKenlmQueryBin(projectRoot) : null;

  if (useWsl && !wslQuery) {
    return null;
  }

  const args = useWsl
    ? ['--', windowsPathToWsl(wslQuery!), windowsPathToWsl(modelPath)]
    : [modelPath];
  const cmd = useWsl ? 'wsl.exe' : queryPath;
  return { cmd, args };
}

/** WSL / native query 子进程是否可启动。 */
export function isKenlmSubprocessRunnable(modelPath: string, queryPath: string): boolean {
  return planKenlmSpawn(modelPath, queryPath) !== null;
}

function withKenlmSubprocessMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = subprocessLock;
  let release!: () => void;
  subprocessLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

/** 仅测试：重置 subprocess 互斥队列 */
export function resetKenlmSubprocessMutexForTests(): void {
  subprocessLock = Promise.resolve();
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

/** 从 stdout 按序提取全部 Total: 行（忽略 Perplexity footer）。 */
export function parseQueryLines(stdout: string): LmScoreResult[] {
  const lines = stdout.trim().split('\n');
  return lines.filter((l) => /Total:\s*[-\d.e]+/i.test(l)).map((l) => parseQueryLine(l));
}

export function parseQueryLinesStrict(
  stdout: string,
  expectedCount: number
): { ok: true; results: LmScoreResult[] } | { ok: false; actual: number } {
  const results = parseQueryLines(stdout);
  if (results.length !== expectedCount) {
    return { ok: false, actual: results.length };
  }
  return { ok: true, results };
}

function killKenlmProcess(proc: ChildProcess): void {
  proc.kill();
}

function spawnKenlmWithStdin(
  plan: KenlmSpawnPlan,
  stdinLines: string[],
  timeoutMs: number
): Promise<{ ok: true; stdout: string; wallMs: number } | { ok: false; reason: string }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: { ok: true; stdout: string; wallMs: number } | { ok: false; reason: string }
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const proc = spawn(plan.cmd, plan.args, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.setEncoding('utf-8');
    proc.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    proc.on('error', () => finish({ ok: false, reason: 'spawn_error' }));
    proc.stdout.on('end', () => {
      finish({ ok: true, stdout: out, wallMs: Date.now() - t0 });
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            killKenlmProcess(proc);
            finish({ ok: false, reason: 'timeout' });
          }, timeoutMs)
        : (undefined as unknown as NodeJS.Timeout);

    for (const line of stdinLines) {
      proc.stdin.write(line + '\n', 'utf-8');
    }
    proc.stdin.end();
  });
}

export function runKenlmQuery(
  modelPath: string,
  queryPath: string,
  tokenized: string,
  timeoutMs = 0
): Promise<LmScoreResult> {
  const plan = planKenlmSpawn(modelPath, queryPath);
  if (!plan) {
    return Promise.resolve({ score: 0, oovCount: 0 });
  }

  return withKenlmSubprocessMutex(async () => {
    const spawnResult = await spawnKenlmWithStdin(plan, [tokenized], timeoutMs);
    if (!spawnResult.ok) {
      return { score: 0, oovCount: 0 };
    }
    const lines = spawnResult.stdout.trim().split('\n');
    const totalLine = lines.find((l) => /Total:/i.test(l)) ?? lines[0] ?? '';
    return parseQueryLine(totalLine);
  });
}

/** 一次 subprocess 对多行 tokenized 输入打分。 */
export async function runKenlmQueryBatch(
  modelPath: string,
  queryPath: string,
  tokenizedLines: string[],
  timeoutMs: number
): Promise<KenlmQueryBatchResult> {
  if (tokenizedLines.length === 0) {
    return { ok: true, results: [], wallMs: 0 };
  }

  const plan = planKenlmSpawn(modelPath, queryPath);
  if (!plan) {
    return { ok: false, reason: 'wsl_query_missing' };
  }

  return withKenlmSubprocessMutex(async () => {
    const spawnResult = await spawnKenlmWithStdin(plan, tokenizedLines, timeoutMs);
    if (!spawnResult.ok) {
      return { ok: false, reason: spawnResult.reason };
    }
    const parsed = parseQueryLinesStrict(spawnResult.stdout, tokenizedLines.length);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: `parse_mismatch: expected ${tokenizedLines.length} got ${parsed.actual}`,
      };
    }
    return { ok: true, results: parsed.results, wallMs: spawnResult.wallMs };
  });
}

/**
 * 创建 LM 打分器。模型文件缺失时返回 null（fail-open）。
 */
export function createLmScorer(): CharLmScorer | null {
  const modelPath = resolveCharLmModelPath();
  if (!modelPath) {
    return null;
  }
  const queryPath = resolveKenlmQueryPath();

  return {
    async score(text: string): Promise<LmScoreResult> {
      const tokenized = tokenizeForLm(text);
      if (!tokenized) {
        return { score: 0, oovCount: 0 };
      }
      return runKenlmQuery(modelPath, queryPath, tokenized);
    },
  };
}

let scorerInstance: CharLmScorer | null | undefined;

/** 懒加载，只创建一次；不可用时为 null（fail-open）。 */
export function getLmScorer(): CharLmScorer | null {
  if (scorerInstance === undefined) {
    scorerInstance = createLmScorer();
  }
  return scorerInstance;
}

/** 仅测试：重置懒加载单例 */
export function resetLmScorerForTests(): void {
  scorerInstance = undefined;
}
