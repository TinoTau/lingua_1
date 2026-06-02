import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LEXICON_RUNTIME_CHECKSUM,
  LEXICON_RUNTIME_MANIFEST,
  LEXICON_RUNTIME_SQLITE,
  LEXICON_RUNTIME_STATS,
} from '../lexicon-v2/lexicon-v2-bundle-path';

const COPY_FILES = [
  LEXICON_RUNTIME_SQLITE,
  LEXICON_RUNTIME_MANIFEST,
  LEXICON_RUNTIME_STATS,
  LEXICON_RUNTIME_CHECKSUM,
];

export function copyV3BundleToTemp(sourceDir: string, prefix = 'lexicon-v3-patch-e2e-'): string {
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const name of COPY_FILES) {
    const src = path.join(sourceDir, name);
    if (!fs.existsSync(src)) {
      throw new Error(`missing bundle file: ${src}`);
    }
    fs.copyFileSync(src, path.join(destDir, name));
  }
  return destDir;
}

export function readBundleSnapshot(bundleDir: string): {
  manifest: Record<string, unknown>;
  stats: Record<string, unknown>;
  checksum: string;
  sqliteMtime: number;
} {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(bundleDir, LEXICON_RUNTIME_MANIFEST), 'utf-8')
  ) as Record<string, unknown>;
  const stats = JSON.parse(
    fs.readFileSync(path.join(bundleDir, LEXICON_RUNTIME_STATS), 'utf-8')
  ) as Record<string, unknown>;
  const checksum = fs.readFileSync(path.join(bundleDir, LEXICON_RUNTIME_CHECKSUM), 'utf-8').trim();
  const sqliteMtime = fs.statSync(path.join(bundleDir, LEXICON_RUNTIME_SQLITE)).mtimeMs;
  return { manifest, stats, checksum, sqliteMtime };
}
