/**
 * Unicode scalar-value hygiene for Model2 host IPC payloads.
 * Unpaired UTF-16 surrogates → U+FFFD. Valid BMP / supplementary pairs unchanged.
 * Transport-boundary only — does not alter Model2 decision logic.
 */

export const UNICODE_REPLACEMENT = '\uFFFD';
export const UNICODE_SANITIZATION_OWNER = 'model2_host_ipc_boundary';

export type UnicodeSanitizeStats = {
  sanitized: boolean;
  sanitized_string_count: number;
  sanitized_code_unit_count: number;
  sanitization_owner: typeof UNICODE_SANITIZATION_OWNER;
};

export function sanitizeUnicodeScalarString(input: string): {
  value: string;
  replacedCodeUnits: number;
} {
  let replaced = 0;
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!;
        i += 1;
        continue;
      }
      out += UNICODE_REPLACEMENT;
      replaced += 1;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) {
      out += UNICODE_REPLACEMENT;
      replaced += 1;
      continue;
    }
    out += input[i]!;
  }
  return { value: out, replacedCodeUnits: replaced };
}

/** Deep-sanitize all strings in a JSON-like value. Objects/arrays cloned only when needed. */
export function sanitizeJsonValueForUtf8Transport(value: unknown): {
  value: unknown;
  stats: UnicodeSanitizeStats;
} {
  let sanitizedStringCount = 0;
  let sanitizedCodeUnitCount = 0;

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = sanitizeUnicodeScalarString(v);
      if (r.replacedCodeUnits > 0) {
        sanitizedStringCount += 1;
        sanitizedCodeUnitCount += r.replacedCodeUnits;
        return r.value;
      }
      return v;
    }
    if (Array.isArray(v)) {
      let changed = false;
      const next = v.map((item) => {
        const w = walk(item);
        if (w !== item) changed = true;
        return w;
      });
      return changed ? next : v;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(obj)) {
        const nk = sanitizeUnicodeScalarString(k);
        const nv = walk(val);
        if (nk.replacedCodeUnits > 0) {
          sanitizedStringCount += 1;
          sanitizedCodeUnitCount += nk.replacedCodeUnits;
          changed = true;
        }
        if (nv !== val) changed = true;
        next[nk.value] = nv;
      }
      return changed ? next : v;
    }
    return v;
  };

  const sanitizedValue = walk(value);
  return {
    value: sanitizedValue,
    stats: {
      sanitized: sanitizedCodeUnitCount > 0,
      sanitized_string_count: sanitizedStringCount,
      sanitized_code_unit_count: sanitizedCodeUnitCount,
      sanitization_owner: UNICODE_SANITIZATION_OWNER,
    },
  };
}

export function emptyUnicodeSanitizeStats(): UnicodeSanitizeStats {
  return {
    sanitized: false,
    sanitized_string_count: 0,
    sanitized_code_unit_count: 0,
    sanitization_owner: UNICODE_SANITIZATION_OWNER,
  };
}
