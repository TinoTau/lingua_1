/**
 * MODEL2_FEATURE_HASH_V1 — must match training/model2_v3/policy/feature_hash_v1.py
 */

export const MODEL2_FEATURE_HASH_VERSION = 'MODEL2_FEATURE_HASH_V1';
/** Must match CHAR_HASH_SEED / Python int exactly — use BigInt (exceeds Number.MAX_SAFE_INTEGER). */
export const MODEL2_FEATURE_HASH_SEED = BigInt('0x4D324841534831');
export const SPAN_DIM_V1 = 64;

const FNV_OFFSET = BigInt('0xCBF29CE484222325');
const FNV_PRIME = BigInt('0x100000001B3');
const MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');

export function fnv1a64(data: Uint8Array, seed: bigint = MODEL2_FEATURE_HASH_SEED): bigint {
  let h = (FNV_OFFSET ^ (seed & MASK64)) & MASK64;
  for (const b of data) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

export function normalizeToken(token: string): string {
  // NFC + lower — matches Python unicodedata.normalize('NFC', ...).lower()
  return (token || '').normalize('NFC').toLowerCase();
}

export function stableBucket(token: string, dim: number): number {
  if (dim <= 0) throw new Error('dim must be > 0');
  const t = normalizeToken(token);
  const enc = new TextEncoder().encode(t);
  const raw = fnv1a64(enc, MODEL2_FEATURE_HASH_SEED);
  return Number(raw % BigInt(dim));
}

export function hashSpanV1(syllables: readonly string[], dim: number = SPAN_DIM_V1): number[] {
  const v = new Array(dim).fill(0);
  let n = 0;
  for (const s of syllables) {
    const t = normalizeToken(s);
    if (!t) continue;
    n += 1;
    v[stableBucket(t, dim)] += 1.0;
    if (t.length >= 2) {
      v[stableBucket(t.slice(0, 2), dim)] += 0.5;
    }
  }
  const denom = n || 1;
  return v.map((x) => x / denom);
}

export function featureHashContractMeta() {
  return {
    contract_id: MODEL2_FEATURE_HASH_VERSION,
    algorithm: 'fnv1a64',
    seed: MODEL2_FEATURE_HASH_SEED.toString(),
    encoding: 'utf-8',
    normalization: 'NFC+lower',
    span_dim: SPAN_DIM_V1,
    stage_p_uses_v1: false,
    checkpoint_compatibility_blocker:
      'Stage P checkpoint incompatible with MODEL2_FEATURE_HASH_V1 without retrain',
  };
}
