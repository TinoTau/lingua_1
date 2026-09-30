/**
 * Model3 process-level inference client.
 * Pattern: Model2 sidecar — singleton Python process, JSONL stdin/stdout.
 * Fail-fast on checkpoint / config / feature-contract mismatch.
 * NO silent KEEP-all / bypass / alternate checkpoint fallback.
 *
 * Active identity = MODEL3_CHECKPOINT_IDENTITY
 *   (default MODEL3_V2_S3_RANDOM_INIT_V1; explicit rollback MODEL3_SYNTHETIC_V1).
 * Exact expected SHA always required — never disables hash checks.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import {
  getModel3CheckpointIdentity,
  resolveModel3CheckpointIdentityId,
  type Model3CheckpointIdentity,
} from './model3-checkpoint-registry';
import { type Model3SpanDecision } from './model3-types';

/** @deprecated Prefer getActiveModel3Identity().modelId — aligned to production default. */
export const MODEL3_LABEL = 'MODEL3_V2_S3_RANDOM_INIT_V1';

function resolveRepoRoot(): string {
  const fromEnv = process.env.PROJECT_ROOT?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(
      dir,
      'electron_node',
      'services',
      'model3_runtime',
      'model3_inference_host.py'
    );
    if (fs.existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

function resolveHostScript(): string {
  return path.join(
    resolveRepoRoot(),
    'electron_node',
    'services',
    'model3_runtime',
    'model3_inference_host.py'
  );
}

export function getActiveModel3Identity(): Model3CheckpointIdentity {
  return getModel3CheckpointIdentity(resolveModel3CheckpointIdentityId());
}

export function resolveModel3CheckpointDir(): string {
  return resolveCheckpointDirForIdentity(getActiveModel3Identity());
}

export function resolveCheckpointDirForIdentity(identity: Model3CheckpointIdentity): string {
  const envPath = process.env.MODEL3_SYNTHETIC_V1_CHECKPOINT?.trim();
  if (envPath && identity.modelId === 'MODEL3_SYNTHETIC_V1') {
    return path.isAbsolute(envPath) ? envPath : path.join(resolveRepoRoot(), envPath);
  }
  const candidateOverride = process.env.MODEL3_CANDIDATE_CHECKPOINT?.trim();
  if (candidateOverride && identity.role === 'CANDIDATE') {
    return path.isAbsolute(candidateOverride)
      ? candidateOverride
      : path.join(resolveRepoRoot(), candidateOverride);
  }
  return path.join(resolveRepoRoot(), identity.checkpointDirRelative);
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolvePython(): string {
  return process.env.MODEL3_PYTHON || process.env.MODEL2_PYTHON || process.env.PYTHON || 'python';
}

type Pending = {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
};

export type Model3SpanInferInput = {
  spanId: string;
  surface: string;
  isAnchor: boolean;
  firstPassCandidateCount: number;
  pinyinChannelAvail: boolean;
  recallFirstPassAvail?: boolean;
};

export type Model3InferPathInput = {
  requestId?: string;
  spans: Model3SpanInferInput[];
};

export type Model3InferPathResult = {
  ok: boolean;
  decisions: Model3SpanDecision[];
  latencyMs: number;
  error?: string;
  sha256?: string;
  loadCount?: number;
};

class Model3InferenceHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private queue: Pending[] = [];
  private loadFailed = false;
  private loadError: string | null = null;
  private started = false;
  private starting: Promise<void> | null = null;
  private loadedSha256: string | null = null;
  private loadCount = 0;
  private inferenceCount = 0;

  isLoadFailed(): boolean {
    return this.loadFailed;
  }

  getLoadError(): string | null {
    return this.loadError;
  }

  getLoadedSha256(): string | null {
    return this.loadedSha256;
  }

  getLoadCount(): number {
    return this.loadCount;
  }

  getInferenceCount(): number {
    return this.inferenceCount;
  }

  /** Test hook only — not a business enable/disable flag. */
  forceLoadFailed(on: boolean, reason = 'forced_load_fail'): void {
    this.loadFailed = on;
    this.loadError = on ? reason : null;
  }

  async ensureStarted(): Promise<void> {
    if (this.loadFailed) {
      throw new Error(`model3_load_failed:${this.loadError || 'unknown'}`);
    }
    if (this.started && this.child) return;
    if (this.starting) {
      await this.starting;
      if (this.loadFailed) {
        throw new Error(`model3_load_failed:${this.loadError || 'unknown'}`);
      }
      return;
    }
    this.starting = this._start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
    if (this.loadFailed) {
      throw new Error(`model3_load_failed:${this.loadError || 'unknown'}`);
    }
  }

  /** Acceptance audit: hot-swap checkpoint on the singleton host (SHA-verified). */
  async reloadCheckpointIdentity(identity: Model3CheckpointIdentity): Promise<void> {
    await this.ensureStarted();
    const ckptDir = resolveCheckpointDirForIdentity(identity);
    const weights = path.join(ckptDir, 'weights.pt');
    if (!fs.existsSync(weights)) {
      throw new Error(`checkpoint_missing:${weights}`);
    }
    const digest = sha256File(weights);
    if (digest.toLowerCase() !== identity.expectedWeightsSha256.toLowerCase()) {
      throw new Error(
        `checkpoint_hash_mismatch:got=${digest}:expected=${identity.expectedWeightsSha256}:identity=${identity.modelId}`
      );
    }
    const loadResp = await this._request(
      {
        cmd: 'load',
        label: identity.modelId,
        checkpoint_dir: ckptDir,
        expected_weights_sha256: identity.expectedWeightsSha256,
        expected_config_hash: identity.expectedConfigHash,
        config_hash_mode: identity.configHashMode,
      },
      120000
    );
    if (!loadResp.ok) {
      throw new Error(`model3_reload_failed:${String(loadResp.error || 'load_failed')}`);
    }
    this.loadedSha256 =
      typeof loadResp.weights_sha256 === 'string' ? loadResp.weights_sha256 : digest;
    this.loadCount = Number(loadResp.load_count || this.loadCount + 1);
  }

  private async _start(): Promise<void> {
    const script = resolveHostScript();
    let identity: Model3CheckpointIdentity;
    try {
      identity = getActiveModel3Identity();
    } catch (e) {
      this.loadFailed = true;
      this.loadError = e instanceof Error ? e.message : String(e);
      return;
    }
    const ckptDir = resolveModel3CheckpointDir();
    const weights = path.join(ckptDir, 'weights.pt');
    if (!fs.existsSync(script)) {
      this.loadFailed = true;
      this.loadError = `host_script_missing:${script}`;
      return;
    }
    if (!fs.existsSync(weights)) {
      this.loadFailed = true;
      this.loadError = `checkpoint_missing:${weights}`;
      return;
    }
    let digest: string;
    try {
      digest = sha256File(weights);
    } catch (e) {
      this.loadFailed = true;
      this.loadError = `checkpoint_hash_read_failed:${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (digest.toLowerCase() !== identity.expectedWeightsSha256.toLowerCase()) {
      this.loadFailed = true;
      this.loadError = `checkpoint_hash_mismatch:got=${digest}:expected=${identity.expectedWeightsSha256}:identity=${identity.modelId}`;
      return;
    }
    try {
      this.child = spawn(resolvePython(), [script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: resolveRepoRoot(),
        env: { ...process.env, PYTHONPATH: resolveRepoRoot() },
      });
    } catch (e) {
      this.loadFailed = true;
      this.loadError = `spawn_failed:${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this._onData(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      logger.debug({ chunk: chunk.slice(0, 400) }, '[Model3] host stderr');
    });
    this.child.on('exit', (code) => {
      logger.warn({ code }, '[Model3] host exited');
      this.started = false;
      this.child = null;
      for (const p of this.queue.splice(0)) {
        p.reject(new Error(`model3_host_exited:${code}`));
      }
    });
    const loadResp = await this._request(
      {
        cmd: 'load',
        label: identity.modelId,
        checkpoint_dir: ckptDir,
        expected_weights_sha256: identity.expectedWeightsSha256,
        expected_config_hash: identity.expectedConfigHash,
        config_hash_mode: identity.configHashMode,
      },
      120000
    );
    if (!loadResp.ok) {
      this.loadFailed = true;
      this.loadError = String(loadResp.error || 'load_failed');
      logger.warn({ error: this.loadError }, '[Model3] checkpoint load failed — fail fast');
      return;
    }
    this.started = true;
    this.loadFailed = false;
    this.loadError = null;
    this.loadedSha256 =
      typeof loadResp.weights_sha256 === 'string' ? loadResp.weights_sha256 : digest;
    this.loadCount = Number(loadResp.load_count || 1);
    logger.info(
      {
        checkpoint: ckptDir,
        sha256: this.loadedSha256,
        label: identity.modelId,
        role: identity.role,
        load_count: this.loadCount,
      },
      '[Model3] inference host loaded (ONE singleton)'
    );
  }

  private _onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        const p = this.queue.shift();
        p?.reject(new Error(`model3_bad_json:${line.slice(0, 120)}`));
        continue;
      }
      const p = this.queue.shift();
      if (p) p.resolve(obj);
    }
  }

  private _request(
    msg: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin.writable) {
        reject(new Error('model3_host_not_running'));
        return;
      }
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((q) => q.resolve === resolve);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new Error('model3_host_timeout'));
      }, timeoutMs);
      this.queue.push({
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.stdin.write(`${JSON.stringify(msg)}\n`);
    });
  }

  /**
   * ONE inference for the whole pathFineSpans sequence.
   * Fail-fast: throws on load/infer failure (no KEEP-all fallback).
   */
  async inferPath(input: Model3InferPathInput): Promise<Model3InferPathResult> {
    const t0 = Date.now();
    await this.ensureStarted();
    const resp = await this._request({
      cmd: 'infer',
      request_id: input.requestId || `m3-${Date.now()}`,
      spans: input.spans.map((s) => ({
        span_id: s.spanId,
        surface: s.surface,
        isAnchor: s.isAnchor,
        first_pass_cand_count: s.firstPassCandidateCount,
        pinyin_channel_avail: s.pinyinChannelAvail,
        recall_first_pass_avail: s.recallFirstPassAvail !== false,
      })),
    });
    const latencyMs = Date.now() - t0;
    if (!resp.ok) {
      throw new Error(`model3_infer_failed:${String(resp.error || 'unknown')}`);
    }
    this.inferenceCount += 1;
    const rawDecisions = Array.isArray(resp.decisions) ? resp.decisions : [];
    const decisions: Model3SpanDecision[] = rawDecisions.map((d) => {
      const row = d as Record<string, unknown>;
      const decision = row.decision === 'RETRY' ? 'RETRY' : 'KEEP';
      const keepLogit = typeof row.keep_logit === 'number' ? row.keep_logit : undefined;
      const retryLogit = typeof row.retry_logit === 'number' ? row.retry_logit : undefined;
      const margin =
        typeof row.margin === 'number'
          ? row.margin
          : keepLogit !== undefined && retryLogit !== undefined
            ? retryLogit - keepLogit
            : undefined;
      const featRaw = row.features;
      let features: Model3SpanDecision['features'];
      if (featRaw && typeof featRaw === 'object') {
        const f = featRaw as Record<string, unknown>;
        features = {
          isAnchor: Number(f.isAnchor ?? 0),
          span_len_log1p: Number(f.span_len_log1p ?? 0),
          span_rel_position: Number(f.span_rel_position ?? 0),
          first_pass_cand_log1p: Number(f.first_pass_cand_log1p ?? 0),
          current_cjk_len_log1p: Number(f.current_cjk_len_log1p ?? 0),
          pinyin_channel_avail: Number(f.pinyin_channel_avail ?? 0),
        };
      }
      const asNumArr = (v: unknown): number[] | undefined =>
        Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : undefined;
      return {
        spanId: String(row.span_id || ''),
        decision,
        keepLogit,
        retryLogit,
        margin,
        eligible: row.eligible !== false,
        features,
        surfaceUsed: typeof row.surface_used === 'string' ? row.surface_used : undefined,
        surfaceCharLen: typeof row.surface_char_len === 'number' ? row.surface_char_len : undefined,
        featVector: asNumArr(row.feat_vector),
        availMask: asNumArr(row.avail_mask),
        tokenIds: asNumArr(row.token_ids),
        rawFirstPassCandidateCount:
          typeof row.raw_first_pass_cand_count === 'number'
            ? row.raw_first_pass_cand_count
            : undefined,
        rawPinyinChannelAvail:
          typeof row.raw_pinyin_channel_avail === 'boolean'
            ? row.raw_pinyin_channel_avail
            : undefined,
        seqIndex: typeof row.seq_index === 'number' ? row.seq_index : undefined,
        seqLen: typeof row.seq_len === 'number' ? row.seq_len : undefined,
      };
    });
    return {
      ok: true,
      decisions,
      latencyMs,
      sha256: this.loadedSha256 ?? undefined,
      loadCount: this.loadCount,
    };
  }
}

const g = globalThis as unknown as { __linguaModel3Host?: Model3InferenceHost };

export function getModel3InferenceHost(): Model3InferenceHost {
  if (!g.__linguaModel3Host) {
    g.__linguaModel3Host = new Model3InferenceHost();
  }
  return g.__linguaModel3Host;
}

/** Test reset — does not change business mainline. */
export function resetModel3InferenceHostForTests(): void {
  g.__linguaModel3Host = new Model3InferenceHost();
}
