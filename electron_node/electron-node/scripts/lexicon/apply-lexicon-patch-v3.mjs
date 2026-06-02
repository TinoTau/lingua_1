#!/usr/bin/env node
/**
 * Apply LexiconPatchV3 (V3.1 SQLite Patch Service).
 * Usage: npm run lexicon:patch:apply -- <patch.json> [--bundle-dir <path>]
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const bundleDirFlag = argv.indexOf('--bundle-dir');
const bundleDir =
  bundleDirFlag >= 0 && argv[bundleDirFlag + 1] ? path.resolve(argv[bundleDirFlag + 1]) : undefined;
const patchPath = argv.find((a, i) => !a.startsWith('--') && i !== bundleDirFlag + 1);

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
  } catch {
    console.error('[lexicon:patch:apply] build main first: npm run build:main');
    process.exit(1);
  }

  const patch = loadLexiconPatchV3FromFile(path.resolve(patchPath));
  const result = await applyLexiconPatchV3(patch, { bundleDir, reload: !bundleDir });
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
  console.error('[lexicon:patch:apply]', err);
  process.exit(1);
});
