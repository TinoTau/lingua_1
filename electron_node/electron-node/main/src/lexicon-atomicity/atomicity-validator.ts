/**
 * TypeScript bridge to Unified Atomicity Validator SSOT (scripts/lexicon/lib/atomicity-validator.cjs).
 * Patch V3 / V4 MUST call through this module — no second atomicity owner.
 */
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

const nodeRequire = createRequire(__filename);

function resolveValidatorPath(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'scripts/lexicon/lib/atomicity-validator.cjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const cwdCandidate = path.resolve(process.cwd(), 'scripts/lexicon/lib/atomicity-validator.cjs');
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  throw new Error('[lexicon-atomicity] atomicity-validator.cjs not found');
}

const core = nodeRequire(resolveValidatorPath()) as {
  validateAtomicity: (
    draft: AtomicityTermDraft,
    opts?: { atomicSurfaces?: Iterable<string> | Set<string>; mode?: AtomicityMode }
  ) => AtomicityValidationResult;
  applyAtomicityMode: (result: AtomicityValidationResult, mode: AtomicityMode) => AtomicityGateApply;
  buildAtomicSurfaceSet: (surfaces: Iterable<string>) => Set<string>;
  toAuditRow: (result: AtomicityValidationResult, draft: AtomicityTermDraft) => Record<string, unknown>;
};

export type AtomicTermType =
  | 'idiom'
  | 'proper_noun'
  | 'brand'
  | 'organization'
  | 'fixed_product'
  | 'fixed_technical_term'
  | 'fixed_expression'
  | 'domain_atomic';

export type AtomicityMode = 'audit' | 'enforce';

export type AtomicityTermDraft = {
  termId?: string;
  surface: string;
  normalizedSurface?: string;
  pinyin?: string;
  tones?: string;
  source: string;
  domains?: string[];
  termType?: AtomicTermType | string;
  exceptionReason?: string;
  sourceFile?: string;
  sourceRow?: number | string;
  sourceLabel?: string;
};

export type AtomicityValidationResult = {
  decision: 'ACCEPT' | 'ACCEPT_EXCEPTION' | 'REJECT_COMPOSITE' | 'UNRESOLVED';
  reasonCode: string;
  exceptionReason?: string;
  segments?: string[];
  detail?: string;
};

export type AtomicityGateApply = {
  allowWrite: boolean;
  blocked: boolean;
  mode: string;
  result: AtomicityValidationResult;
};

export function validateAtomicity(
  draft: AtomicityTermDraft,
  opts?: { atomicSurfaces?: Iterable<string> | Set<string>; mode?: AtomicityMode }
): AtomicityValidationResult {
  return core.validateAtomicity(draft, opts);
}

export function applyAtomicityMode(
  result: AtomicityValidationResult,
  mode: AtomicityMode
): AtomicityGateApply {
  return core.applyAtomicityMode(result, mode);
}

export function buildAtomicSurfaceSet(surfaces: Iterable<string>): Set<string> {
  return core.buildAtomicSurfaceSet(surfaces);
}

export function toAuditRow(result: AtomicityValidationResult, draft: AtomicityTermDraft) {
  return core.toAuditRow(result, draft);
}

export function resolveAtomicityMode(
  explicit?: string | null,
  fallback: AtomicityMode = 'enforce'
): AtomicityMode {
  const v = String(explicit || process.env.LEXICON_ATOMICITY_MODE || fallback)
    .trim()
    .toLowerCase();
  return v === 'audit' ? 'audit' : 'enforce';
}

/** Load CJK length 1–3 surfaces from an open better-sqlite3 db (term table). */
export function loadAtomicSurfacesFromDb(db: {
  prepare: (sql: string) => { all: (...args: unknown[]) => Array<{ word: string }> };
}): Set<string> {
  const rows = db.prepare(`SELECT word FROM term WHERE enabled = 1`).all() as Array<{ word: string }>;
  return buildAtomicSurfaceSet(rows.map((r) => r.word));
}
