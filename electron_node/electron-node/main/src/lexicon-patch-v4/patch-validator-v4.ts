import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { LexiconPatchV4, PatchOperationV4, PatchValidationErrorV4 } from './patch-types-v4';
import {
  EXPANSION_DENY_LIST,
  MAX_EXPANSION_CJK_LEN,
  PATCH_SCHEMA_VERSION_V4,
} from './patch-types-v4';
import { assertRegistryDomain } from '../lexicon-v2/profile-registry';
import { readBundleVersion } from '../lexicon-patch-v3/bundle-io';
import { computePatchHashV4, verifyPatchHashV4 } from './patch-hash-v4';
import { resolvePinyinKeyForOp } from './term-ref-v4';
import {
  applyAtomicityMode,
  buildAtomicSurfaceSet,
  resolveAtomicityMode,
  validateAtomicity,
  type AtomicityMode,
} from '../lexicon-atomicity/atomicity-validator';

const nodeRequire = createRequire(__filename);

export type PatchAtomicityOptionsV4 = {
  atomicSurfaces?: Set<string>;
  atomicityMode?: AtomicityMode;
};

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

/** Ops that introduce a new formal surface — must pass Unified Atomicity Validator. */
function opIntroducesFormalSurface(op: PatchOperationV4): boolean {
  return op.op === 'addTerm';
}

const VALID_OPS = new Set<PatchOperationV4['op']>([
  'addTerm',
  'appendDomainTags',
  'addLegalAlias',
  'removeAlias',
  'removeDomainTag',
  'enableTerm',
  'disableTerm',
  'updateDomainWeights',
  'updateTermFields',
  'deleteTerm',
  'replaceDomainTagsDangerous',
]);

function cjkCount(text: string): number {
  return [...text].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

function validateDomainTags(tags: string[] | undefined, index: number): PatchValidationErrorV4 | null {
  if (!tags?.length) {
    return { code: 'missing_domain_tags', message: `operations[${index}]: domain_tags required` };
  }
  for (const tag of tags) {
    if (!assertRegistryDomain(tag.trim())) {
      return { code: 'invalid_domain', message: `operations[${index}]: invalid domain_id ${tag}` };
    }
  }
  return null;
}

function validateWeightKeys(
  tags: string[],
  weights: Record<string, number> | undefined,
  index: number
): PatchValidationErrorV4 | null {
  if (!weights) {
    return null;
  }
  for (const key of Object.keys(weights)) {
    if (!tags.includes(key)) {
      return {
        code: 'weight_key_not_in_tags',
        message: `operations[${index}]: domain_weights key not in domain_tags: ${key}`,
      };
    }
  }
  return null;
}

function validateLengthAndDeny(op: PatchOperationV4, index: number): PatchValidationErrorV4 | null {
  const word = op.word?.trim();
  if (!word) {
    return { code: 'missing_word', message: `operations[${index}]: word required` };
  }
  if (EXPANSION_DENY_LIST.includes(word as (typeof EXPANSION_DENY_LIST)[number])) {
    return { code: 'denylist_word', message: `operations[${index}]: denylist word ${word}` };
  }
  if (cjkCount(word) > MAX_EXPANSION_CJK_LEN) {
    return { code: 'word_too_long', message: `operations[${index}]: word length > ${MAX_EXPANSION_CJK_LEN}` };
  }
  return null;
}

function validateAtomicityForOp(
  op: PatchOperationV4,
  index: number,
  atomicSurfaces: Set<string>,
  mode: AtomicityMode
): PatchValidationErrorV4 | null {
  if (!opIntroducesFormalSurface(op)) return null;
  const word = op.word?.trim();
  if (!word) return null;
  const draft = {
    termId: op.term_id,
    surface: word,
    normalizedSurface: word,
    pinyin: resolvePinyinKeyForOp(op) || undefined,
    source: 'patch-v4',
    domains: op.domain_tags || [],
    termType: (op as { term_type?: string; termType?: string }).term_type ||
      (op as { termType?: string }).termType,
    exceptionReason:
      (op as { exception_reason?: string; exceptionReason?: string }).exception_reason ||
      (op as { exceptionReason?: string }).exceptionReason,
    sourceLabel: 'patch-v4',
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
  op: PatchOperationV4,
  index: number,
  atomicSurfaces: Set<string>,
  mode: AtomicityMode
): PatchValidationErrorV4 | null {
  if (!VALID_OPS.has(op.op)) {
    return { code: 'invalid_op', message: `operations[${index}]: unknown op ${op.op}` };
  }

  const gran = validateLengthAndDeny(op, index);
  if (gran) {
    return gran;
  }

  switch (op.op) {
    case 'addTerm': {
      const tagErr = validateDomainTags(op.domain_tags, index);
      if (tagErr) {
        return tagErr;
      }
      const weightErr = validateWeightKeys(op.domain_tags!, op.domain_weights, index);
      if (weightErr) {
        return weightErr;
      }
      if (!resolvePinyinKeyForOp(op)) {
        return { code: 'missing_pinyin_key', message: `operations[${index}]: pinyin_key or pinyin required` };
      }
      if (op.prior_score !== undefined && !(op.prior_score > 0)) {
        return { code: 'invalid_prior', message: `operations[${index}]: prior_score must be > 0` };
      }
      return validateAtomicityForOp(op, index, atomicSurfaces, mode);
    }
    case 'appendDomainTags': {
      const tagErr = validateDomainTags(op.domain_tags, index);
      if (tagErr) {
        return tagErr;
      }
      return validateWeightKeys(op.domain_tags!, op.domain_weights, index);
    }
    case 'addLegalAlias': {
      if (!op.alias?.trim() || !op.alias_type?.trim()) {
        return {
          code: 'missing_alias_fields',
          message: `operations[${index}]: addLegalAlias requires alias and alias_type`,
        };
      }
      return null;
    }
    case 'removeAlias': {
      if (!op.alias?.trim()) {
        return { code: 'missing_alias', message: `operations[${index}]: removeAlias requires alias` };
      }
      return null;
    }
    case 'removeDomainTag': {
      if (!op.domain_id?.trim()) {
        return { code: 'missing_domain_id', message: `operations[${index}]: removeDomainTag requires domain_id` };
      }
      if (!op.term_id?.trim()) {
        return { code: 'missing_term_id', message: `operations[${index}]: removeDomainTag requires term_id` };
      }
      return null;
    }
    case 'disableTerm': {
      if (!op.reason?.trim()) {
        return { code: 'missing_reason', message: `operations[${index}]: disableTerm requires reason` };
      }
      return null;
    }
    case 'replaceDomainTagsDangerous': {
      if (op.dangerous !== true) {
        return {
          code: 'dangerous_flag_required',
          message: `operations[${index}]: replaceDomainTagsDangerous requires dangerous: true`,
        };
      }
      if (!op.reason?.trim()) {
        return { code: 'missing_reason', message: `operations[${index}]: replaceDomainTagsDangerous requires reason` };
      }
      const tagErr = validateDomainTags(op.domain_tags, index);
      if (tagErr) {
        return tagErr;
      }
      return validateWeightKeys(op.domain_tags!, op.domain_weights, index);
    }
    case 'updateDomainWeights': {
      if (!op.domain_weights || !Object.keys(op.domain_weights).length) {
        return {
          code: 'missing_domain_weights',
          message: `operations[${index}]: updateDomainWeights requires domain_weights`,
        };
      }
      return null;
    }
    case 'updateTermFields': {
      if (op.domain_tags?.length) {
        return {
          code: 'forbidden_domain_tags',
          message: `operations[${index}]: updateTermFields must not include domain_tags`,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateLexiconPatchV4(
  patch: LexiconPatchV4,
  manifestPath: string,
  options?: PatchAtomicityOptionsV4
): PatchValidationErrorV4 | null {
  if (patch.patchSchemaVersion !== PATCH_SCHEMA_VERSION_V4) {
    return {
      code: 'invalid_schema_version',
      message: `patchSchemaVersion must be ${PATCH_SCHEMA_VERSION_V4}`,
    };
  }
  if (!patch.patchId?.trim()) {
    return { code: 'missing_patch_id', message: 'patchId required' };
  }
  if (!Array.isArray(patch.operations) || patch.operations.length === 0) {
    return { code: 'empty_operations', message: 'operations must be non-empty' };
  }

  if (patch.operations.length > 100 && !patch.tableThresholds) {
    return {
      code: 'missing_table_thresholds',
      message: 'tableThresholds required when operations.length > 100',
    };
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
  if (!verifyPatchHashV4(patch)) {
    return {
      code: 'hash_mismatch',
      message: `hash mismatch: expected ${computePatchHashV4(patch)}`,
    };
  }

  // Domain-tag-only patches skip atomicity; addTerm cannot bypass Unified Validator.
  const mode = resolveAtomicityMode(options?.atomicityMode, 'enforce');
  const atomicSurfaces =
    options?.atomicSurfaces ?? loadAtomicSurfacesNearManifest(manifestPath);
  for (const op of patch.operations) {
    if (op.op === 'addTerm' && op.word?.trim() && cjkCount(op.word) <= 3) {
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
