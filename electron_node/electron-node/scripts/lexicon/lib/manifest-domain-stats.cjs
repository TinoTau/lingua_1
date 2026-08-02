/**
 * SSOT: domainAvailability + domain_hierarchy counts from lexicon sqlite.
 * Used by gate, patch manifest-writer (via bridge), and patch E2E.
 */

const DOMAIN_AVAILABILITY_SQL =
  'SELECT domain_id, COUNT(*) AS c FROM term_domain_tags GROUP BY domain_id ORDER BY domain_id';

const DOMAIN_HIERARCHY_COUNT_SQL = 'SELECT COUNT(*) AS c FROM domain_hierarchy';

/** @param {import('better-sqlite3').Database} db */
function readDomainAvailabilityFromDb(db) {
  const rows = db.prepare(DOMAIN_AVAILABILITY_SQL).all();
  const out = {};
  for (const row of rows) {
    out[row.domain_id] = row.c;
  }
  return out;
}

/** @param {string} sqlitePath */
function readDomainAvailabilityFromSqlitePath(sqlitePath) {
  const Database = require('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  try {
    return readDomainAvailabilityFromDb(db);
  } finally {
    db.close();
  }
}

/** @param {import('better-sqlite3').Database} db */
function readDomainHierarchyCountFromDb(db) {
  const row = db.prepare(DOMAIN_HIERARCHY_COUNT_SQL).get();
  return row?.c ?? 0;
}

/** @param {Record<string, number>} a @param {Record<string, number>} b */
function domainAvailabilityEqual(a, b) {
  const keysA = Object.keys(a ?? {}).sort();
  const keysB = Object.keys(b ?? {}).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (let i = 0; i < keysA.length; i += 1) {
    if (keysA[i] !== keysB[i]) {
      return false;
    }
    if (a[keysA[i]] !== b[keysB[i]]) {
      return false;
    }
  }
  return true;
}

module.exports = {
  DOMAIN_AVAILABILITY_SQL,
  DOMAIN_HIERARCHY_COUNT_SQL,
  readDomainAvailabilityFromDb,
  readDomainAvailabilityFromSqlitePath,
  readDomainHierarchyCountFromDb,
  domainAvailabilityEqual,
};
