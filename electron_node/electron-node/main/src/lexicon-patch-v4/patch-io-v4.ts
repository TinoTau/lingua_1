import * as fs from 'fs';
import type { LexiconPatchV4 } from './patch-types-v4';

export function loadLexiconPatchV4FromFile(filePath: string): LexiconPatchV4 {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as LexiconPatchV4;
}
