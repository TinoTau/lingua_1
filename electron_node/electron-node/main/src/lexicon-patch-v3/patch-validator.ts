import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type {
  LexiconPatchV3,
  LexiconTierTable,
  PatchOperation,
  TermPatchEntry,
  TierPatchEntry,
} from './patch-types';
import { isTermPatchEntry } from './patch-types';
import { assertRegistryDomain } from '../lexicon-v2/profile-registry';
import { readBundleVersion } from './bundle-io';
import { computePatchHash, verifyPatchHash } from './patch-hash';
import { resolvePinyinKey } from './pinyin-resolve';
import {
  applyAtomicityMode,
  buildAtomicSurfaceSet,
  resolveAtomicityMode,
  validateAtomicity,
  type AtomicityMode,
} from '../lexicon-atomicity/atomicity-validator';

export type PatchValidationError = { code: string; message: string };

export type PatchAtomicityOptionsV3 = {
  atomicSurfaces?: Set<string>;
  atomicityMode?: AtomicityMode;
};

const nodeRequire = createRequire(__filename);

function loadAtomicSurfacesNearManifest(manifestPath: string): Set<string> {
  try {
    const sqlitePath = path.join(path.dirname(manifestPath), 'lexicon.sqlite');
    if (!fs.existsSync(sqlitePath)) return new Set();
    const Database = nodeRequire('better-sqlite3');
    const db = new Database(sqlitePath, { readonly: true });
    const rows = db.prepare(`SELECT word FROM term WHERE enabled = 1`).all() as Array<{ word: string }>;
    db.close();
    return buildAtomicSurfaceSet(rows.map((r) => r.word));
  } catch {
    return new Set();
  }
}

function cjkCount(text: string): number {
  return [...text].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

const VALID_OPS = new Set(['add', 'update', 'enable', 'disable', 'delete']);
const VALID_TABLES = new Set<LexiconTierTable>(['base', 'idiom', 'term']);

function validateDomainTags(tags: string[], index: number): PatchValidationError | null {
  for (const tag of tags) {
    const err = validateDomainAllowed(tag);
    if (err) {
      return { code: 'invalid_domain', message: `operations[${index}]: ${err}` };
    }
  }
  return null;
}

function validateWeightKeys(
  tags: string[],
  weights: Record<string, number> | undefined,
  index: number
): PatchValidationError | null {
  if (!weights) {
    return null;
  }
  for (const key of Object.keys(weights)) {
    if (!tags.includes(key)) {
      return {
        code: 'weight_key_not_in_tags',
        message: `operations[${index}]: domainWeights key not in domainTags: ${key}`,
      };
    }
  }
  return null;
}

function validateAtomicityForTermAdd(
  op: PatchOperation,
  index: number,
  atomicSurfaces: Set<string>,
  mode: AtomicityMode
): PatchValidationError | null {
  if (!(op.table === 'term' && op.op === 'add')) return null;
  const word = op.word?.trim();
  if (!word) return null;
  const entry = op.entry as TermPatchEntry | undefined;
  const draft = {
    termId: op.termId,
    surface: word,
    normalizedSurface: word,
    pinyin: entry ? resolvePinyinKey(entry.word, entry.pinyinKey) || undefined : undefined,
    source: 'patch-v3',
    domains: entry?.domainTags || [],
    termType: (entry as { termType?: string; term_type?: string } | undefined)?.termType ||
      (entry as { term_type?: string } | undefined)?.term_type,
    exceptionReason:
      (entry as { exceptionReason?: string; exception_reason?: string } | undefined)?.exceptionReason ||
      (entry as { exception_reason?: string } | undefined)?.exception_reason,
    sourceLabel: 'patch-v3',
  };
  const result = validateAtomicity(draft, { atomicSurfaces, mode });
  const gate = applyAtomicityMode(result, mode);
  if (gate.blocked) {
    return {
      code: 'atomicity_rejected',
      message: `operations[${index}]: atomicity ${result.decision}/${result.reasonCode} for ${word}${
        result.segments?.length ? ` segments=[${result.segments.join('+')}]` : ''
      }`,
    };
  }
  return null;
}

function validateOperation(
  op: PatchOperation,
  index: number,
  atomicSurfaces: Set<string>,
  mode: AtomicityMode
): PatchValidationError | null {
  if (!VALID_OPS.has(op.op)) {
    return { code: 'invalid_op', message: `operations[${index}]: unknown op ${op.op}` };
  }
  if (!VALID_TABLES.has(op.table)) {
    return { code: 'invalid_table', message: `operations[${index}]: unknown table ${op.table}` };
  }
  if (!op.word?.trim()) {
    return { code: 'missing_word', message: `operations[${index}]: word required` };
  }

  if (op.table === 'term') {
    if (op.op === 'add') {
      const entry = op.entry;
      if (!entry || !isTermPatchEntry(entry)) {
        return { code: 'invalid_entry', message: `operations[${index}]: term add requires domainTags[]` };
      }
      if (!entry.domainTags?.length) {
        return { code: 'missing_domain_tags', message: `operations[${index}]: domainTags required` };
      }
      const tagErr = validateDomainTags(entry.domainTags, index);
      if (tagErr) {
        return tagErr;
      }
      const weightErr = validateWeightKeys(entry.domainTags, entry.domainWeights, index);
      if (weightErr) {
        return weightErr;
      }
      const atomErr = validateAtomicityForTermAdd(op, index, atomicSurfaces, mode);
      if (atomErr) {
        return atomErr;
      }
    }
    if (['update', 'delete', 'enable', 'disable'].includes(op.op) && !op.termId?.trim()) {
      return { code: 'missing_term_id', message: `operations[${index}]: termId required` };
    }
    if (op.op === 'update' && op.fields) {
      const fields = op.fields as Partial<TermPatchEntry>;
      if (fields.domainTags?.length) {
        const tagErr = validateDomainTags(fields.domainTags, index);
        if (tagErr) {
          return tagErr;
        }
        const weightErr = validateWeightKeys(fields.domainTags, fields.domainWeights, index);
        if (weightErr) {
          return weightErr;
        }
      }
    }
  } else if (!op.pinyinKey?.trim() && op.op !== 'add') {
    return { code: 'missing_pinyin_key', message: `operations[${index}]: pinyinKey required for ${op.table}` };
  }

  if (op.op === 'add' && op.table !== 'term') {
    const entry = op.entry as TierPatchEntry | undefined;
    if (!entry) {
      return { code: 'missing_entry', message: `operations[${index}]: entry required for add` };
    }
    if (!entry.id?.trim()) {
      return { code: 'missing_id', message: `operations[${index}]: entry.id required` };
    }
    if (!entry.word?.trim()) {
      return { code: 'missing_word', message: `operations[${index}]: entry.word required` };
    }
    const pinyinKey = resolvePinyinKey(entry.word, entry.pinyinKey);
    if (!pinyinKey) {
      return { code: 'missing_pinyin_key', message: `operations[${index}]: entry.pinyinKey required` };
    }
    if (!(entry.priorScore > 0)) {
      return { code: 'invalid_prior', message: `operations[${index}]: priorScore must be > 0` };
    }
  }

  if (op.op === 'add' && op.table === 'term') {
    const entry = op.entry as TermPatchEntry;
    const pinyinKey = resolvePinyinKey(entry.word, entry.pinyinKey);
    if (!pinyinKey) {
      return { code: 'missing_pinyin_key', message: `operations[${index}]: entry.pinyinKey required` };
    }
    if (!(entry.priorScore > 0)) {
      return { code: 'invalid_prior', message: `operations[${index}]: priorScore must be > 0` };
    }
  }

  if (op.op === 'update') {
    const prior = (op.fields as { priorScore?: number } | undefined)?.priorScore;
    if (prior !== undefined && !(prior > 0)) {
      return { code: 'invalid_prior', message: `operations[${index}]: priorScore must be > 0` };
    }
  }

  return null;
}

function validateDomainAllowed(domainId: string): string | null {
  const id = domainId.trim();
  if (!id) {
    return 'domainId empty';
  }
  if (!assertRegistryDomain(id)) {
    return `domain not in profile-registry or disabled: ${id}`;
  }
  return null;
}

export function validateLexiconPatchV3(
  patch: LexiconPatchV3,
  manifestPath: string,
  options?: PatchAtomicityOptionsV3
): PatchValidationError | null {
  if (!patch.patchId?.trim()) {
    return { code: 'missing_patch_id', message: 'patchId required' };
  }
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    return { code: 'empty_operations', message: 'operations must be non-empty' };
  }

  const bundleVersion = readBundleVersion(manifestPath);
  if (patch.baseVersion !== bundleVersion) {
    return {
      code: 'version_mismatch',
      message: `baseVersion ${patch.baseVersion} != manifest bundleVersion ${bundleVersion}`,
    };
  }
  if (patch.nextVersion !== patch.baseVersion + 1) {
    return {
      code: 'invalid_next_version',
      message: `nextVersion must be baseVersion + 1 (${patch.baseVersion + 1})`,
    };
  }
  if (!verifyPatchHash(patch)) {
    const expected = computePatchHash(patch);
    return {
      code: 'hash_mismatch',
      message: `hash mismatch: expected ${expected}`,
    };
  }

  const mode = resolveAtomicityMode(options?.atomicityMode, 'enforce');
  const atomicSurfaces =
    options?.atomicSurfaces ?? loadAtomicSurfacesNearManifest(manifestPath);
  for (const op of patch.operations) {
    if (op.table === 'term' && op.op === 'add' && op.word?.trim() && cjkCount(op.word) <= 3) {
      atomicSurfaces.add(op.word.trim());
    }
  }

  for (let i = 0; i < patch.operations.length; i++) {
    const err = validateOperation(patch.operations[i], i, atomicSurfaces, mode);
    if (err) {
      return err;
    }
  }

  return null;
}
