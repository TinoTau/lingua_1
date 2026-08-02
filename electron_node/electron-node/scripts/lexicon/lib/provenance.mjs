const REVIEW_STATUSES = new Set(['approved', 'pending', 'rejected']);

/** Default provenance for Phase 3 1k pilot and dev seeds when fields are omitted. */
export const DEFAULT_PROVENANCE = {
  license: 'internal-pilot',
  importBatch: 'lexicon-1k-pilot-v1',
  normalizedBy: 'sanitize-1k-pilot-seed',
  reviewStatus: 'approved',
};

export function withDefaultProvenance(row, defaults = DEFAULT_PROVENANCE) {
  return {
    ...row,
    license: row.license?.trim() || defaults.license,
    importBatch: row.importBatch?.trim() || defaults.importBatch,
    normalizedBy: row.normalizedBy?.trim() || defaults.normalizedBy,
    reviewStatus: row.reviewStatus?.trim() || defaults.reviewStatus,
  };
}

export function normalizeProvenanceFields(row) {
  return {
    license: row.license?.trim() ?? '',
    importBatch: row.importBatch?.trim() ?? '',
    normalizedBy: row.normalizedBy?.trim() ?? '',
    reviewStatus: row.reviewStatus?.trim() ?? '',
  };
}

export function validateProvenanceFields(row, { strict = false } = {}) {
  const errors = [];
  const fields = normalizeProvenanceFields(row);

  if (strict) {
    if (!fields.license) {
      errors.push({ code: 'missing_license', message: 'license is required in strict provenance mode' });
    }
    if (!fields.importBatch) {
      errors.push({ code: 'missing_importBatch', message: 'importBatch is required in strict provenance mode' });
    }
    if (!fields.normalizedBy) {
      errors.push({ code: 'missing_normalizedBy', message: 'normalizedBy is required in strict provenance mode' });
    }
    if (!fields.reviewStatus) {
      errors.push({ code: 'missing_reviewStatus', message: 'reviewStatus is required in strict provenance mode' });
    }
  }

  if (fields.reviewStatus && !REVIEW_STATUSES.has(fields.reviewStatus)) {
    errors.push({
      code: 'invalid_reviewStatus',
      message: `reviewStatus must be one of: ${[...REVIEW_STATUSES].join(', ')}`,
    });
  }

  return { ok: errors.length === 0, errors, fields };
}

export function provenanceReport(rows) {
  const bySource = new Map();
  const byLicense = new Map();
  const byBatch = new Map();
  const byReview = new Map();

  for (const row of rows) {
    const source = row.source?.trim() || '(missing)';
    const fields = normalizeProvenanceFields(row);
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
    if (fields.license) {
      byLicense.set(fields.license, (byLicense.get(fields.license) ?? 0) + 1);
    }
    if (fields.importBatch) {
      byBatch.set(fields.importBatch, (byBatch.get(fields.importBatch) ?? 0) + 1);
    }
    if (fields.reviewStatus) {
      byReview.set(fields.reviewStatus, (byReview.get(fields.reviewStatus) ?? 0) + 1);
    }
  }

  return {
    totalRows: rows.length,
    bySource: Object.fromEntries(bySource),
    byLicense: Object.fromEntries(byLicense),
    byImportBatch: Object.fromEntries(byBatch),
    byReviewStatus: Object.fromEntries(byReview),
  };
}
