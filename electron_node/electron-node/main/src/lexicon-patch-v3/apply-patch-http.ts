import type { LexiconPatchV3 } from './patch-types';
import { applyLexiconPatchV3 } from './patch-service';
import type { ApplyLexiconPatchOptions } from './patch-apply-options';

export type ApplyPatchHttpResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleLexiconApplyPatchHttp(
  patch: LexiconPatchV3,
  options?: ApplyLexiconPatchOptions
): Promise<ApplyPatchHttpResponse> {
  const result = await applyLexiconPatchV3(patch, options);
  if (result.ok) {
    return {
      status: 200,
      body: {
        ok: true,
        patchId: result.patchId,
        bundleVersion: result.bundleVersion ?? result.nextVersion,
        baseVersion: result.baseVersion,
        nextVersion: result.nextVersion,
        tables: result.tables,
        checksum: result.checksum,
        appliedAt: result.appliedAt,
      },
    };
  }
  return {
    status: 400,
    body: {
      ok: false,
      errorCode: result.errorCode ?? 'apply_failed',
      message: result.message ?? result.error ?? 'apply failed',
      patchId: result.patchId,
    },
  };
}
