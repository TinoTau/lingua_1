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

export type PatchValidationError = { code: string; message: string };

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

function validateOperation(op: PatchOperation, index: number): PatchValidationError | null {
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
  manifestPath: string
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

  for (let i = 0; i < patch.operations.length; i++) {
    const err = validateOperation(patch.operations[i], i);
    if (err) {
      return err;
    }
  }

  return null;
}
