import * as fs from 'fs';
import Database = require('better-sqlite3');
import logger from '../logger';
import { getLexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2-holder';
import type { ApplyLexiconPatchV3Result, LexiconPatchV3 } from './patch-types';
import { resolveLexiconV3BundleFiles } from './bundle-io';
import { withLexiconPatchLock } from './patch-lock';
import { validateLexiconPatchV3 } from './patch-validator';
import { writeBundleManifestsAfterPatch } from './manifest-writer';
import { applyLexiconPatchToSqlite } from './sqlite-patch-applier';
import { isPatchAlreadyApplied, ensurePatchHistoryTable } from './sqlite-schema';
import { forceReloadLexiconRuntimeV3 } from './reload';
import type { ApplyLexiconPatchOptions } from './patch-apply-options';
import {
  readManifestBundleVersion,
  readTableCountsFromStats,
  verifyChecksumAligned,
} from './patch-bundle-verify';
import { loadLexiconPatchV3FromFile as loadFromFile } from './patch-io';

export function loadLexiconPatchV3FromFile(filePath: string): LexiconPatchV3 {
  return loadFromFile(filePath);
}

function failResult(
  patch: LexiconPatchV3,
  errorCode: string,
  message: string
): ApplyLexiconPatchV3Result {
  return {
    ok: false,
    patchId: patch.patchId,
    baseVersion: patch.baseVersion,
    nextVersion: patch.nextVersion,
    appliedAt: 0,
    errorCode,
    message,
    error: message,
  };
}

export async function applyLexiconPatchV3(
  patch: LexiconPatchV3,
  options: ApplyLexiconPatchOptions = {}
): Promise<ApplyLexiconPatchV3Result> {
  const reload = options.reload !== false;
  const files = resolveLexiconV3BundleFiles(options.bundleDir);

  return withLexiconPatchLock(async () => {
    const validationError = validateLexiconPatchV3(patch, files.manifestPath);
    if (validationError) {
      return failResult(patch, validationError.code, validationError.message);
    }

    if (reload) {
      getLexiconRuntimeV2().close();
    }

    const db = new Database(files.sqlitePath);
    try {
      ensurePatchHistoryTable(db);
      if (isPatchAlreadyApplied(db, patch.patchId)) {
        return failResult(patch, 'patch_already_applied', 'patch already applied');
      }

      applyLexiconPatchToSqlite(db, patch);
      writeBundleManifestsAfterPatch(db, files, patch);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failResult(patch, 'apply_transaction_failed', message);
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
        return failResult(
          patch,
          'reload_failed',
          reloadState.errorMessage ?? reloadState.status
        );
      }
    }

    logger.info({ patchId: patch.patchId, nextVersion: patch.nextVersion }, 'Lexicon V3 patch applied');

    return {
      ok: true,
      patchId: patch.patchId,
      baseVersion: patch.baseVersion,
      nextVersion: patch.nextVersion,
      bundleVersion,
      appliedAt: Date.now(),
      tables,
      checksum,
    };
  });
}
