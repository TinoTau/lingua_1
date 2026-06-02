import * as crypto from 'crypto';
import type { LexiconPatchV3, PatchOperation } from './patch-types';

function operationSortKey(op: PatchOperation): string {
  return [
    op.op,
    op.table,
    op.domainId ?? '',
    op.word,
    op.pinyinKey ?? '',
    op.id ?? '',
    op.entry?.id ?? '',
  ].join('\t');
}

export function canonicalPatchBody(patch: LexiconPatchV3): Omit<LexiconPatchV3, 'hash'> {
  const operations = [...patch.operations].sort((a, b) =>
    operationSortKey(a).localeCompare(operationSortKey(b))
  );
  const { hash: _omit, ...body } = patch;
  return { ...body, operations };
}

export function computePatchHash(patch: LexiconPatchV3): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPatchBody(patch)))
    .digest('hex');
  return `sha256:${digest}`;
}

export function verifyPatchHash(patch: LexiconPatchV3): boolean {
  if (!patch.hash?.trim()) {
    return false;
  }
  return patch.hash === computePatchHash(patch);
}
