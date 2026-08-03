/**
 * Residual Cleanup — fail-fast reader for SpanAssemblyV4 diagnostics.
 * No dual-field compat; no silent zero for missing logicalWindowRecallCount.
 */

/**
 * @param {object} diag spanAssemblyV4 diagnostics object
 * @param {string} context error context (case id / sample id)
 * @returns {number}
 */
export function requireLogicalWindowRecallCount(diag, context = 'unknown') {
  if (diag == null || typeof diag !== 'object') {
    throw new Error(
      `[residual-cleanup] spanAssemblyV4 diagnostics missing (${context})`
    );
  }
  if (Object.prototype.hasOwnProperty.call(diag, 'ngramQueryCount')) {
    throw new Error(
      `[residual-cleanup] obsolete field ngramQueryCount present (${context}); ` +
        `use logicalWindowRecallCount only (no dual-field compat)`
    );
  }
  const v = diag.logicalWindowRecallCount;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
    throw new Error(
      `[residual-cleanup] logicalWindowRecallCount must be a finite non-negative integer ` +
        `(${context}), got ${JSON.stringify(v)}`
    );
  }
  return v;
}
