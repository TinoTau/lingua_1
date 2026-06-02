import * as fs from 'fs';
import type { LexiconPatchV3 } from './patch-types';

export function loadLexiconPatchV3FromFile(filePath: string): LexiconPatchV3 {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as LexiconPatchV3;
}
