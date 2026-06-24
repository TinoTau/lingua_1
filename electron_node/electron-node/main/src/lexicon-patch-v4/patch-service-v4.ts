import * as fs from 'fs';
import Database = require('better-sqlite3');
import logger from '../logger';
import { getLexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2-holder';
import type { ApplyLexiconPatchV4Result, LexiconPatchV4 } from './patch-types-v4';
import { resolveLexiconV3BundleFiles } from '../lexicon-patch-v3/bundle-io';
import { withLexiconPatchLock } from '../lexicon-patch-v3/patch-lock';
import { assertBundleSchemaV2 } from '../lexicon-patch-v3/patch-schema-guard';
import { writeBundleManifestsAfterPatch } from '../lexicon-patch-v3/manifest-writer';
import { isPatchAlreadyApplied, ensurePatchHistoryTable } from '../lexicon-patch-v3/sqlite-schema';
import { forceReloadLexiconRuntimeV3 } from '../lexicon-patch-v3/reload';
import type { ApplyLexiconPatchOptions } from '../lexicon-patch-v3/patch-apply-options';
import {
  readManifestBundleVersion,
  readTableCountsFromStats,
  verifyChecksumAligned,
} from '../lexicon-patch-v3/patch-bundle-verify';
import { validateLexiconPatchV4 } from './patch-validator-v4';
import { applyLexiconPatchToSqliteV4, PatchApplyErrorV4, type ApplyStatsV4 } from './sqlite-applier-v4';
import { loadLexiconPatchV4FromFile } from './patch-io-v4';

export { loadLexiconPatchV4FromFile };

export type ApplyLexiconPatchV4Outcome = ApplyLexiconPatchV4Result & {
  applyStats?: ApplyStatsV4;
};

function failResult(
  patch: LexiconPatchV4,
  errorCode: string,
  message: string
): ApplyLexiconPatchV4Outcome {
  return {
    ok: false,
    patchId: patch.patchId,
    baseVersion: patch.baseVersion,
    nextVersion: patch.nextVersion,
    appliedAt: 0,
    errorCode,
    message,
  };
}

/** Apply V4 patch to sqlite + manifest (no pre/runtime gate — use importer pipeline). */
export async function applyLexiconPatchV4(
  patch: LexiconPatchV4,
  options: ApplyLexiconPatchOptions = {}
): Promise<ApplyLexiconPatchV4Outcome> {
  const reload = options.reload !== false;
  const files = resolveLexiconV3BundleFiles(options.bundleDir);

  return withLexiconPatchLock(async () => {
    const validationError = validateLexiconPatchV4(patch, files.manifestPath);
    if (validationError) {
      return failResult(patch, validationError.code, validationError.message);
    }

    if (reload) {
      getLexiconRuntimeV2().close();
    }

    const db = new Database(files.sqlitePath);
    let applyStats: ApplyStatsV4 | undefined;
    try {
      ensurePatchHistoryTable(db);
      if (isPatchAlreadyApplied(db, patch.patchId)) {
        return failResult(patch, 'patch_already_applied', 'patch already applied');
      }

      assertBundleSchemaV2(db, files.manifestPath);
      applyStats = await applyLexiconPatchToSqliteV4(db, patch);
      writeBundleManifestsAfterPatch(db, files, patch as unknown as import('../lexicon-patch-v3/patch-types').LexiconPatchV3);
    } catch (err) {
      if (err instanceof PatchApplyErrorV4) {
        return { ...failResult(patch, err.code, err.message), applyStats };
      }
      const message = err instanceof Error ? err.message : String(err);
      const code = message.startsWith('schema_not_v2') ? 'schema_not_v2' : 'apply_transaction_failed';
      return failResult(patch, code, message);
    } finally {
      db.close();
    }

    if (!verifyChecksumAligned(files)) {
      return failResult(patch, 'checksum_mismatch', 'checksum alignment failed after apply');
    }

    const tables = readTableCountsFromStats(files.statsPath);
    const bundleVersion = readManifestBundleVersion(files.manifestPath);
    const checksum = fs.readFileSync(files.checksumPath, 'utf-8').trim();

    if (reload) {
      const reloadState = forceReloadLexiconRuntimeV3();
      if (reloadState.status !== 'ok') {
        return failResult(patch, 'reload_failed', reloadState.errorMessage ?? reloadState.status);
      }
    }

    logger.info(
      { patchId: patch.patchId, nextVersion: patch.nextVersion, schema: 'v4' },
      'Lexicon V4 patch applied'
    );

    return {
      ok: true,
      patchId: patch.patchId,
      baseVersion: patch.baseVersion,
      nextVersion: patch.nextVersion,
      bundleVersion,
      appliedAt: Date.now(),
      tables,
      checksum,
      applyStats,
    };
  });
}
