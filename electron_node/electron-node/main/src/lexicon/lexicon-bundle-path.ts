import * as fs from 'fs';
import * as path from 'path';

const BUNDLE_REL = path.join('node_runtime', 'lexicon', 'current');

export const LEXICON_RUNTIME_PROJECT_ROOT_MSG = '[LEXICON_RUNTIME] PROJECT_ROOT missing';

/** Resolve lexicon bundle directory (manifest + sqlite + checksum). No silent __dirname walk. */
export function resolveLexiconBundleDir(): string | null {
  if (process.env.LEXICON_BUNDLE_PATH) {
    const envPath = process.env.LEXICON_BUNDLE_PATH;
    return fs.existsSync(envPath) ? envPath : null;
  }

  const projectRoot = process.env.PROJECT_ROOT?.trim();
  if (!projectRoot) {
    return null;
  }

  const fromRoot = path.join(projectRoot, BUNDLE_REL);
  if (fs.existsSync(path.join(fromRoot, 'manifest.json'))) {
    return fromRoot;
  }
  return null;
}

export function requireProjectRootForLexicon(): string {
  const projectRoot = process.env.PROJECT_ROOT?.trim();
  if (!projectRoot) {
    throw new Error(LEXICON_RUNTIME_PROJECT_ROOT_MSG);
  }
  return projectRoot;
}

export function lexiconBundleFileNames(bundleDir: string) {
  return {
    manifestPath: path.join(bundleDir, 'manifest.json'),
    sqlitePath: path.join(bundleDir, 'lexicon.sqlite'),
    checksumPath: path.join(bundleDir, 'checksum.txt'),
  };
}
