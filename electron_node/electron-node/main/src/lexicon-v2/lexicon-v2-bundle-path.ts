import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';
import { getLexiconRuntimeV2BundlePathConfig } from './lexicon-runtime-v2-config';

/** FW runtime bundle 目录（默认 v3）；单配置源：manifest.json + lexicon.sqlite。 */
const DEFAULT_V2_BUNDLE_REL = path.join('node_runtime', 'lexicon', 'v3');

export const LEXICON_RUNTIME_MANIFEST = 'manifest.json';
export const LEXICON_RUNTIME_SQLITE = 'lexicon.sqlite';
export const LEXICON_RUNTIME_STATS = 'stats.json';
export const LEXICON_RUNTIME_CHECKSUM = 'checksum.txt';

/** @deprecated v3 runtime 已废止；仅 v2_shadow 构建产物仍可能保留 */
export const LEGACY_MANIFEST_V2 = 'manifest_v2.json';
export const LEGACY_SQLITE_V2 = 'lexicon_v2.sqlite';

function bundleHasRuntimeLayout(bundleDir: string): boolean {
  return (
    fs.existsSync(path.join(bundleDir, LEXICON_RUNTIME_MANIFEST)) &&
    fs.existsSync(path.join(bundleDir, LEXICON_RUNTIME_SQLITE))
  );
}

export function resolveLexiconV2BundleDir(): string | null {
  const configured = getLexiconRuntimeV2BundlePathConfig()?.trim();
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  if (!projectRoot && !configured) {
    return null;
  }

  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.join(projectRoot ?? process.cwd(), configured);
    if (bundleHasRuntimeLayout(resolved)) {
      return resolved;
    }
    return fs.existsSync(resolved) ? resolved : null;
  }

  if (!projectRoot) {
    return null;
  }

  const fromRoot = path.join(projectRoot, DEFAULT_V2_BUNDLE_REL);
  if (bundleHasRuntimeLayout(fromRoot)) {
    return fromRoot;
  }
  return null;
}

export function lexiconV2BundleFileNames(bundleDir: string) {
  return {
    manifestPath: path.join(bundleDir, LEXICON_RUNTIME_MANIFEST),
    sqlitePath: path.join(bundleDir, LEXICON_RUNTIME_SQLITE),
    checksumPath: path.join(bundleDir, LEXICON_RUNTIME_CHECKSUM),
    statsPath: path.join(bundleDir, LEXICON_RUNTIME_STATS),
  };
}
