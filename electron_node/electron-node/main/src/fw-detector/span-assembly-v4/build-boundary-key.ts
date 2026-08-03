import { createHash } from 'crypto';
import type { LexicalEdge } from './build-lexical-edges';

export function buildBoundaryKey(edgeRefs: readonly LexicalEdge[]): string {
  if (!edgeRefs.length) {
    throw new Error('[buildBoundaryKey] empty edgeRefs is illegal for a complete Path');
  }

  let prevEnd: number | null = null;
  for (const e of edgeRefs) {
    if (e.syllableStart < 0) {
      throw new Error(`[buildBoundaryKey] illegal syllableStart=${e.syllableStart}`);
    }
    if (e.syllableEnd <= e.syllableStart) {
      throw new Error(`[buildBoundaryKey] illegal edge range ${e.syllableStart}:${e.syllableEnd}`);
    }
    const len = e.syllableEnd - e.syllableStart;
    if (len < 1 || len > 5) {
      throw new Error(`[buildBoundaryKey] illegal edge length=${len} for ${e.syllableStart}:${e.syllableEnd}`);
    }
    if (prevEnd == null) {
      prevEnd = e.syllableEnd;
    } else {
      if (e.syllableStart !== prevEnd) {
        throw new Error(
          `[buildBoundaryKey] non-contiguous path: prevEnd=${prevEnd}, nextStart=${e.syllableStart}`
        );
      }
      prevEnd = e.syllableEnd;
    }
  }

  return edgeRefs.map((e) => `${e.syllableStart}-${e.syllableEnd}`).join('|');
}

export function derivePathId(boundaryKey: string): string {
  // Full hex sha256 — fixed length, deterministic, no truncation ambiguity.
  return createHash('sha256').update(boundaryKey, 'utf8').digest('hex');
}

