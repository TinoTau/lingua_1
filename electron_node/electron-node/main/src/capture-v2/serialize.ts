/**
 * Capture V2 canonical serialization — snapshot/copy only; never mutate Production.
 * Authority: LINGUA_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2.md §9 / serializer section.
 */
import { createHash } from 'crypto';

const STRIP_KEYS = new Set([
  'jobId',
  'job_id',
  'sessionId',
  'session_id',
  'absolutePath',
  'absolute_path',
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set);
}

/**
 * Deep-copy value for capture. Maps/Sets become arrays of entries/values (copied).
 * Does not mutate input.
 */
export function snapshotCopy(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const entries: unknown[] = [];
    for (const [k, v] of value.entries()) {
      entries.push([snapshotCopy(k), snapshotCopy(v)]);
    }
    return entries;
  }
  if (value instanceof Set) {
    const arr: unknown[] = [];
    for (const v of value.values()) arr.push(snapshotCopy(v));
    return arr;
  }
  if (Array.isArray(value)) {
    return value.map((x) => snapshotCopy(x));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = snapshotCopy(value[k]);
    }
    return out;
  }
  // runtime handles / buffers — stringify tag only
  if (typeof (value as { constructor?: { name?: string } }).constructor?.name === 'string') {
    const name = (value as { constructor: { name: string } }).constructor.name;
    if (name === 'Buffer' || name === 'Socket' || name === 'Database') {
      return `[${name}]`;
    }
  }
  return value;
}

/** Sort object keys recursively; arrays preserve order (ordered concepts). */
export function canonicalizeOrdered(value: unknown): unknown {
  const copied = snapshotCopy(value);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(copied);
}

/**
 * Sort a semantically unordered list of identity objects for hashing only.
 * Operates on a copy — never mutates Production.
 */
export function canonicalizeUnorderedIdentities(
  items: readonly unknown[],
  keyFn: (item: unknown) => string
): unknown[] {
  const copied = items.map((x) => snapshotCopy(x));
  return copied.sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeOrdered(value));
}

export function sha256Utf8(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Utf8(stableStringify(value));
}
