/**
 * Process-level Model2 Stage-J inference host client.
 * APPROVED_EXISTING_SIDECAR — JSONL stdin/stdout, not HTTP.
 * ONE singleton. ONE frozen Stage-J checkpoint. No Stage-P fallback.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';
import type { Model2InferResult } from './types';

export const LABEL = 'STAGE_J_RUNTIME_CHECKPOINT_SWAP';
export const STAGE_J_EXPECTED_SHA256 =
  'd66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda';

function resolveRepoRoot(): string {
  const fromEnv = process.env.PROJECT_ROOT?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  // Compiled layout: dist/main/electron-node/main/src/model2-runtime
  // Source layout:   main/src/model2-runtime
  // Walk upward until electron_node/services/model2_runtime is found.
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, 'electron_node', 'services', 'model2_runtime', 'model2_inference_host.py');
    if (fs.existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last resort: previous relative depth (source-tree only).
  return path.resolve(__dirname, '..', '..', '..', '..', '..');
}

function resolveHostScript(): string {
  return path.join(
    resolveRepoRoot(),
    'electron_node',
    'services',
    'model2_runtime',
    'model2_inference_host.py'
  );
}

export function resolveStageJCheckpoint(): string {
  const envPath = process.env.MODEL2_STAGE_J_CHECKPOINT?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(resolveRepoRoot(), envPath);
  }
  return path.join(
    resolveRepoRoot(),
    'training',
    'model2_v3',
    'experiments',
    'v3_stage_j_p_preservation',
    'training',
    'expA_frozen_trunk.pt'
  );
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolvePython(): string {
  return process.env.MODEL2_PYTHON || process.env.PYTHON || 'python';
}

type Pending = {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
};

export type Model2InferInput = {
  spanSyllables: string[];
  phoneticBias: Record<string, number>;
  basePool: number;
  requestId?: string;
  personalTerms?: string[];
  longTermDomainEvidence?: Record<string, number>;
  personalTermEvidence?: Record<string, number>;
  windowText?: string;
  windowPinyinKey?: string;
  spanId?: string;
  syllableStart?: number;
  syllableEnd?: number;
  rawStart?: number;
  rawEnd?: number;
  baseHits?: Array<{ surface?: string; replacement?: string; pinyin_key?: string; term_id?: string }>;
};

class Model2InferenceHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private queue: Pending[] = [];
  private loadFailed = false;
  private loadError: string | null = null;
  private started = false;
  private starting: Promise<void> | null = null;
  private lexiconSqlite: string | null = null;
  private loadedSha256: string | null = null;
  private loadCount = 0;

  forceLoadFailed(on: boolean, reason = 'checkpoint_unavailable'): void {
    this.loadFailed = on;
    this.loadError = on ? reason : null;
  }

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

  async ensureStarted(opts?: { lexiconSqlite?: string }): Promise<void> {
    if (process.env.MODEL2_RUNTIME_DISABLED === '1') {
      this.loadFailed = true;
      this.loadError = 'model2_runtime_disabled';
      return;
    }
    // Infrastructure recovery: allow start after a prior DISABLED boot if env is cleared.
    if (this.loadFailed && this.loadError === 'model2_runtime_disabled') {
      this.loadFailed = false;
      this.loadError = null;
    }
    if (this.loadFailed) return;
    if (this.started && this.child) {
      if (opts?.lexiconSqlite && opts.lexiconSqlite !== this.lexiconSqlite) {
        await this._loadIndex(opts.lexiconSqlite);
      }
      return;
    }
    if (this.starting) {
      await this.starting;
      if (opts?.lexiconSqlite && opts.lexiconSqlite !== this.lexiconSqlite) {
        await this._loadIndex(opts.lexiconSqlite);
      }
      return;
    }
    this.starting = this._start(opts?.lexiconSqlite);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async _loadIndex(sqlitePath: string): Promise<void> {
    if (!this.child) return;
    const resp = await this._request({ cmd: 'load_index', lexicon_sqlite: sqlitePath });
    const idx = (resp.index as Record<string, unknown> | undefined) ?? resp;
    if (idx && idx.ok === false) {
      logger.warn({ error: idx.error, sqlitePath }, '[Model2] domain index load failed — D expansion no-op');
      return;
    }
    this.lexiconSqlite = sqlitePath;
  }

  private async _start(lexiconSqlite?: string): Promise<void> {
    const script = resolveHostScript();
    const ckpt = resolveStageJCheckpoint();
    if (!fs.existsSync(script)) {
      this.loadFailed = true;
      this.loadError = `host_script_missing:${script}`;
      logger.warn({ script }, '[Model2] inference host script missing');
      return;
    }
    if (!fs.existsSync(ckpt)) {
      this.loadFailed = true;
      this.loadError = `checkpoint_missing:${ckpt}`;
      logger.warn({ ckpt }, '[Model2] Stage J checkpoint missing');
      return;
    }
    let digest: string;
    try {
      digest = sha256File(ckpt);
    } catch (e) {
      this.loadFailed = true;
      this.loadError = `checkpoint_hash_read_failed:${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (digest !== STAGE_J_EXPECTED_SHA256) {
      this.loadFailed = true;
      this.loadError = `checkpoint_hash_mismatch:got=${digest}:expected=${STAGE_J_EXPECTED_SHA256}`;
      logger.warn({ digest, expected: STAGE_J_EXPECTED_SHA256, ckpt }, '[Model2] Stage J hash mismatch — fail fast');
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
      logger.debug({ chunk: chunk.slice(0, 400) }, '[Model2] host stderr');
    });
    this.child.on('exit', (code) => {
      logger.warn({ code }, '[Model2] host exited');
      this.started = false;
      this.child = null;
      for (const p of this.queue.splice(0)) {
        p.reject(new Error(`model2_host_exited:${code}`));
      }
    });
    const loadMsg: Record<string, unknown> = {
      cmd: 'load',
      checkpoint: ckpt,
      expected_sha256: STAGE_J_EXPECTED_SHA256,
    };
    if (lexiconSqlite) loadMsg.lexicon_sqlite = lexiconSqlite;
    const loadResp = await this._request(loadMsg, 120000);
    if (!loadResp.ok) {
      this.loadFailed = true;
      this.loadError = String(loadResp.error || 'load_failed');
      logger.warn({ error: this.loadError }, '[Model2] Stage J checkpoint load failed');
      return;
    }
    this.started = true;
    this.loadFailed = false;
    this.loadError = null;
    this.loadedSha256 = typeof loadResp.sha256 === 'string' ? loadResp.sha256 : digest;
    this.loadCount = Number(loadResp.load_count || 1);
    this.lexiconSqlite = lexiconSqlite ?? null;
    logger.info(
      { checkpoint: ckpt, sha256: this.loadedSha256, label: LABEL },
      '[Model2] Stage J inference host loaded (ONE singleton)'
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
        p?.reject(new Error(`model2_bad_json:${line.slice(0, 120)}`));
        continue;
      }
      const p = this.queue.shift();
      if (p) p.resolve(obj);
    }
  }

  private _request(msg: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin.writable) {
        reject(new Error('model2_host_not_running'));
        return;
      }
      const timer = setTimeout(() => {
        const i = this.queue.findIndex((q) => q.resolve === resolve);
        if (i >= 0) this.queue.splice(i, 1);
        reject(new Error('model2_host_timeout'));
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

  async infer(input: Model2InferInput): Promise<Model2InferResult> {
    await this.ensureStarted();
    if (this.loadFailed) {
      return {
        ok: false,
        model2Invoked: false,
        selectedActions: [],
        queryBudget: 0,
        domainAction: null,
        domainNone: true,
        domainHits: [],
        error: this.loadError || 'load_failed',
      };
    }
    try {
      const resp = await this._request({
        cmd: 'infer',
        request_id: input.requestId || `r-${Date.now()}`,
        span_syllables: input.spanSyllables,
        phonetic_bias: input.phoneticBias,
        personal_terms: input.personalTerms || [],
        long_term_domain_evidence: input.longTermDomainEvidence || {},
        personal_term_evidence: input.personalTermEvidence || {},
        window_text: input.windowText || '',
        window_pinyin_key: input.windowPinyinKey || input.spanSyllables.join('|'),
        span_id: input.spanId,
        syllable_start: input.syllableStart,
        syllable_end: input.syllableEnd,
        raw_start: input.rawStart,
        raw_end: input.rawEnd,
        base_hits: input.baseHits || [],
        state: { base_pool: input.basePool, query_budget: 8, cand_budget: 8 },
      });
      if (!resp.ok) {
        return {
          ok: false,
          model2Invoked: false,
          selectedActions: [],
          queryBudget: 0,
          domainAction: null,
          domainNone: true,
          domainHits: [],
          error: String(resp.error || 'inference_failed'),
        };
      }
      const exec = (resp.domain_executor as Record<string, unknown> | undefined) || {};
      const hits = Array.isArray(exec.domain_hits) ? (exec.domain_hits as Model2InferResult['domainHits']) : [];
      return {
        ok: true,
        model2Invoked: Boolean(resp.model2_invoked),
        selectedActions: Array.isArray(resp.selected_actions)
          ? (resp.selected_actions as string[])
          : [],
        queryBudget: Number(resp.query_budget || 0),
        latencyMs: typeof resp.latency_ms === 'number' ? resp.latency_ms : undefined,
        domainRetrievalMs: typeof exec.latency_ms === 'number' ? exec.latency_ms : undefined,
        reason: typeof resp.reason === 'string' ? resp.reason : undefined,
        featurePack: typeof resp.feature_pack === 'string' ? resp.feature_pack : undefined,
        actionProbsTop: Array.isArray(resp.action_probs_top)
          ? (resp.action_probs_top as Array<{ action_id: string; prob: number }>)
          : undefined,
        domainAction: typeof resp.domain_action === 'string' ? resp.domain_action : null,
        domainNone: resp.domain_none !== false,
        domainHits: hits || [],
        domainRawN: typeof exec.domain_raw_n === 'number' ? exec.domain_raw_n : 0,
        domainExecutorError: typeof exec.error === 'string' ? exec.error : undefined,
        sha256: typeof resp.sha256 === 'string' ? resp.sha256 : this.loadedSha256 || undefined,
        inferenceCount: typeof resp.inference_count === 'number' ? resp.inference_count : undefined,
        loadCount: typeof resp.load_count === 'number' ? resp.load_count : undefined,
        domainProbsTop: Array.isArray(resp.domain_probs_top)
          ? (resp.domain_probs_top as Array<{ action_id: string; prob: number }>)
          : undefined,
        nApplicable: typeof resp.n_applicable === 'number' ? resp.n_applicable : undefined,
        packedFeatureHash:
          typeof resp.packed_feature_hash === 'string' ? resp.packed_feature_hash : undefined,
        featureHash: typeof resp.feature_pack === 'string' ? resp.feature_pack : undefined,
        domainExecutor: exec,
        pFeaturePresence:
          typeof resp.p_feature_presence === 'boolean' ? resp.p_feature_presence : undefined,
        dFeaturePresence:
          typeof resp.d_feature_presence === 'boolean' ? resp.d_feature_presence : undefined,
      };
    } catch (e) {
      return {
        ok: false,
        model2Invoked: false,
        selectedActions: [],
        queryBudget: 0,
        domainAction: null,
        domainNone: true,
        domainHits: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async disambiguate(req: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureStarted();
    if (this.loadFailed) {
      return {
        ok: true,
        decision: 'ABSTAIN',
        selected_candidate_index: null,
        abstain_reason: 'HEAD_NOT_AVAILABLE',
        model_head_available: false,
        ambiguity_invoked: true,
        contract: 'SingleCharDisambiguationContractV1',
      };
    }
    try {
      const resp = await this._request({ cmd: 'disambiguate', ...req }, 10000);
      return resp;
    } catch (e) {
      return {
        ok: true,
        decision: 'ABSTAIN',
        selected_candidate_index: null,
        abstain_reason: 'INFERENCE_ERROR',
        model_head_available: false,
        ambiguity_invoked: true,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async stats(): Promise<Record<string, unknown> | null> {
    if (!this.started || this.loadFailed) return null;
    try {
      return await this._request({ cmd: 'stats' }, 5000);
    } catch {
      return null;
    }
  }

  async dispose(): Promise<void> {
    if (!this.child) return;
    try {
      await this._request({ cmd: 'shutdown' }, 3000);
    } catch {
      /* ignore */
    }
    this.child.kill();
    this.child = null;
    this.started = false;
  }
}

let singleton: Model2InferenceHost | null = null;

export function getModel2InferenceHost(): Model2InferenceHost {
  if (!singleton) singleton = new Model2InferenceHost();
  return singleton;
}

/** Test-only: reset singleton. */
export function resetModel2InferenceHostForTests(): void {
  if (singleton) {
    void singleton.dispose();
  }
  singleton = null;
}
