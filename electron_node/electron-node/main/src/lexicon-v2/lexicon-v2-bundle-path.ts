import * as fs from 'fs';
import * as path from 'path';
import { loadNodeConfig } from '../node-config';
import { getLexiconRuntimeV2BundlePathConfig } from './lexicon-runtime-v2-config';

const DEFAULT_V2_BUNDLE_REL = path.join('node_runtime', 'lexicon', 'v2_shadow');

export function resolveLexiconV2BundleDir(): string | null {
  const fromEnv = process.env.LEXICON_V2_BUNDLE_PATH?.trim();
  if (fromEnv) {
    return fs.existsSync(fromEnv) ? fromEnv : null;
  }

  const configured = getLexiconRuntimeV2BundlePathConfig()?.trim();
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  if (!projectRoot && !configured) {
    return null;
  }

  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.join(projectRoot ?? process.cwd(), configured);
    if (fs.existsSync(path.join(resolved, 'manifest_v2.json'))) {
      return resolved;
    }
    return fs.existsSync(resolved) ? resolved : null;
  }

  if (!projectRoot) {
    return null;
  }

  const fromRoot = path.join(projectRoot, DEFAULT_V2_BUNDLE_REL);
  if (fs.existsSync(path.join(fromRoot, 'manifest_v2.json'))) {
    return fromRoot;
  }
  return null;
}

export function lexiconV2BundleFileNames(bundleDir: string) {
  return {
    manifestPath: path.join(bundleDir, 'manifest_v2.json'),
    sqlitePath: path.join(bundleDir, 'lexicon_v2.sqlite'),
    checksumPath: path.join(bundleDir, 'checksum.txt'),
  };
}
