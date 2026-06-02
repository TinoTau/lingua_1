import * as fs from 'fs';
import { lexiconV2BundleFileNames, resolveLexiconV2BundleDir } from '../lexicon-v2/lexicon-v2-bundle-path';

export type LexiconV3BundleFiles = {
  bundleDir: string;
  sqlitePath: string;
  manifestPath: string;
  statsPath: string;
  checksumPath: string;
};

export function resolveLexiconV3BundleFiles(bundleDirOverride?: string): LexiconV3BundleFiles {
  const bundleDir = bundleDirOverride?.trim() || resolveLexiconV2BundleDir();
  if (!bundleDir) {
    throw new Error('Lexicon V3 bundle directory not found (configure features.lexiconRuntimeV2.bundlePath)');
  }
  const { manifestPath, sqlitePath, checksumPath, statsPath } = lexiconV2BundleFileNames(bundleDir);
  return {
    bundleDir,
    sqlitePath,
    manifestPath,
    statsPath,
    checksumPath,
  };
}

export function readBundleVersion(manifestPath: string): number {
  if (!fs.existsSync(manifestPath)) {
    return 1;
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { bundleVersion?: number };
  const v = parsed.bundleVersion;
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}
