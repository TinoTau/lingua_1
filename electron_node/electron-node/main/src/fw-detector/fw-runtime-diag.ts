import {
  lexiconV2BundleFileNames,
  resolveLexiconV2BundleDir,
} from '../lexicon-v2/lexicon-v2-bundle-path';
import type { LexiconRuntimeV2State } from '../lexicon-v2/lexicon-types-v2';
import type { FwDetectorRuntimeDiag } from './types';

export function buildFwRuntimeDiag(
  v2State: LexiconRuntimeV2State,
  profilePrimary: string | null,
  enabledDomains: string[]
): FwDetectorRuntimeDiag {
  const bundleDir = resolveLexiconV2BundleDir();
  const bundleFiles = bundleDir ? lexiconV2BundleFileNames(bundleDir) : null;
  const counts = v2State.tableCounts;
  const lexiconRows = counts ? counts.base + counts.domain + counts.idiom : null;

  return {
    loaded: v2State.status === 'ok',
    status: v2State.status,
    bundleDir: bundleDir ?? v2State.bundleDir ?? null,
    sqlitePath: bundleFiles?.sqlitePath ?? null,
    manifestVersion: v2State.manifestVersion ?? null,
    lexiconRows,
    profilePrimary,
    enabledDomains,
  };
}
