import * as crypto from 'crypto';
import type { LexiconPatchV4, PatchOperationV4 } from './patch-types-v4';

/** V1.2 §7 — order-independent hash sort key. */
export function operationSortKeyV4(op: PatchOperationV4): string {
  const domainId =
    op.domain_id ??
    (op.domain_tags?.length === 1 ? op.domain_tags[0] : op.domain_tags?.join(',') ?? '');
  return [
    op.op,
    op.word,
    op.term_id ?? '',
    op.pinyin_key ?? '',
    domainId,
    op.alias ?? '',
  ].join('\t');
}

export function canonicalPatchBodyV4(patch: LexiconPatchV4): Omit<LexiconPatchV4, 'hash'> {
  const operations = [...patch.operations].sort((a, b) =>
    operationSortKeyV4(a).localeCompare(operationSortKeyV4(b))
  );
  const { hash: _omit, ...body } = patch;
  return { ...body, operations };
}

export function computePatchHashV4(patch: LexiconPatchV4): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPatchBodyV4(patch)))
    .digest('hex');
  return `sha256:${digest}`;
}

export function verifyPatchHashV4(patch: LexiconPatchV4): boolean {
  if (!patch.hash?.trim()) {
    return false;
  }
  return patch.hash === computePatchHashV4(patch);
}
