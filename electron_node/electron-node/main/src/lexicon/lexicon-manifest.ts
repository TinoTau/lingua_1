import * as crypto from 'crypto';
import * as fs from 'fs';
import { LexiconManifest } from './lexicon-types';

export function readManifest(manifestPath: string): LexiconManifest {
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw) as LexiconManifest;
  if (!parsed.version || !parsed.checksum || !parsed.backend) {
    throw new Error(`Invalid lexicon manifest: ${manifestPath}`);
  }
  return parsed;
}

export function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** Verify sqlite checksum against manifest and optional checksum.txt. */
export function verifySqliteChecksum(
  sqlitePath: string,
  manifest: LexiconManifest,
  checksumPath?: string
): void {
  const actual = sha256File(sqlitePath);
  if (actual !== manifest.checksum) {
    throw new Error(
      `Lexicon sqlite checksum mismatch: manifest=${manifest.checksum} actual=${actual}`
    );
  }
  if (checksumPath && fs.existsSync(checksumPath)) {
    const fromFile = fs.readFileSync(checksumPath, 'utf-8').trim();
    if (fromFile && fromFile !== manifest.checksum) {
      throw new Error(`Lexicon checksum.txt does not match manifest`);
    }
  }
}
