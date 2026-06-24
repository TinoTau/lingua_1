import type { LexiconPatchV4 } from './patch-types-v4';

export type AppendSemanticsError = { code: string; message: string };

/** Static checks — no implicit domain replace via ambiguous ops. */
export function validateAppendSemanticsV4(patch: LexiconPatchV4): AppendSemanticsError | null {
  for (let i = 0; i < patch.operations.length; i++) {
    const op = patch.operations[i];
    if (op.op === 'replaceDomainTagsDangerous') {
      continue;
    }
    if ((op as { op: string }).op === 'update' || (op as { fields?: { domain_tags?: string[] } }).fields?.domain_tags) {
      return {
        code: 'v3_implicit_replace',
        message: `operations[${i}]: V3-style update+domain_tags forbidden; use appendDomainTags`,
      };
    }
  }
  return null;
}
