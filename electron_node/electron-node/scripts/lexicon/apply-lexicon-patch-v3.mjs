#!/usr/bin/env node
/**
 * Apply LexiconPatchV3 (V3.1 SQLite Patch Service).
 * Usage: npm run lexicon:patch:apply -- <patch.json> [--bundle-dir <path>]
 * Recommended on Windows: npm run lexicon:patch:apply:electron
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const ABI_MISMATCH_HINT = `Detected Electron / Node ABI mismatch.

Please run:
  npm run lexicon:rebuild-native

or:
  npm run lexicon:patch:apply:electron
`;

function isAbiMismatchError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('NODE_MODULE_VERSION') || msg.includes('ERR_DLOPEN');
}

function printAbiHelp() {
  console.error(ABI_MISMATCH_HINT);
}

const argv = process.argv.slice(2);
const bundleDirFlag = argv.indexOf('--bundle-dir');
const bundleDir =
  bundleDirFlag >= 0 && argv[bundleDirFlag + 1] ? path.resolve(argv[bundleDirFlag + 1]) : undefined;
const patchPath = argv.find((a, i) => {
  if (a.startsWith('--')) return false;
  if (bundleDirFlag >= 0 && i === bundleDirFlag + 1) return false;
  return true;
});

if (!patchPath) {
  console.error('Usage: npm run lexicon:patch:apply -- <patch.json> [--bundle-dir <path>]');
  process.exit(1);
}

async function main() {
  const distRoot = path.join(
    __dirname,
    '../../dist/main/electron-node/main/src/lexicon-patch-v3/patch-service.js'
  );
  let loadLexiconPatchV3FromFile;
  let applyLexiconPatchV3;
  try {
    ({ loadLexiconPatchV3FromFile, applyLexiconPatchV3 } = require(distRoot));
  } catch (err) {
    if (isAbiMismatchError(err)) {
      printAbiHelp();
      process.exit(1);
    }
    console.error('[lexicon:patch:apply] build main first: npm run build:main');
    process.exit(1);
  }

  let patch;
  try {
    patch = loadLexiconPatchV3FromFile(path.resolve(patchPath));
  } catch (err) {
    if (isAbiMismatchError(err)) {
      printAbiHelp();
      process.exit(1);
    }
    throw err;
  }

  let result;
  try {
    result = await applyLexiconPatchV3(patch, { bundleDir, reload: !bundleDir });
  } catch (err) {
    if (isAbiMismatchError(err)) {
      printAbiHelp();
      process.exit(1);
    }
    throw err;
  }

  if (result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          patchId: result.patchId,
          baseVersion: result.baseVersion,
          nextVersion: result.nextVersion,
          bundleVersion: result.bundleVersion,
          tables: result.tables,
          checksum: result.checksum,
          appliedAt: result.appliedAt,
        },
        null,
        2
      )
    );
  } else {
    console.error(
      JSON.stringify(
        {
          ok: false,
          errorCode: result.errorCode,
          message: result.message ?? result.error,
          patchId: result.patchId,
        },
        null,
        2
      )
    );
  }
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  if (isAbiMismatchError(err)) {
    printAbiHelp();
    process.exit(1);
  }
  console.error('[lexicon:patch:apply]', err);
  process.exit(1);
});
