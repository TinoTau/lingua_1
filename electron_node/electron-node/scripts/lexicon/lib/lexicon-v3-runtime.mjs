/**
 * Lexicon V3 FW runtime bundle — single manifest / stats / sqlite (SSOT).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { repoRoot, v2ShadowRuntimeDir, v3RuntimeDir } from './paths.mjs';

export { v2ShadowRuntimeDir, v3RuntimeDir };

export const V3_SCHEMA_VERSION_V3 = 'lexicon-v3-runtime-v3';
export const SHADOW_SCHEMA_V2_TERM = 'lexicon-v2-shadow-v2-term';
export const RUNTIME_MANIFEST = 'manifest.json';
export const RUNTIME_SQLITE = 'lexicon.sqlite';
export const RUNTIME_STATS = 'stats.json';
export const RUNTIME_CHECKSUM = 'checksum.txt';
export const BACKUP_DIR_NAME = '_backup_manifest_migration';

const LEGACY_FILES = {
  manifestV2: 'manifest_v2.json',
  manifestV3: 'manifest_v3.json',
  statsV2: 'stats_v2.json',
  statsV3: 'stats_v3.json',
  sqliteV2: 'lexicon_v2.sqlite',
};

/**
 * Fail-fast row counts — post Full Rebuild + Parent Fragment retirement.
 * base is term-SSOT rematerialized (≈term count), not the legacy 50k seed base.
 */
export const V3_TABLE_THRESHOLDS_V3 = {
  base: 10000,
  idiom: 21000,
  term: 10000,
  term_domain_tags: 900,
  domain_hierarchy: 12,
  domain: 900,
  routing: 900,
};
/** @deprecated alias — use V3_TABLE_THRESHOLDS_V3 */
export const V3_TABLE_THRESHOLDS_V2 = V3_TABLE_THRESHOLDS_V3;

const SQL_TABLE_TO_SHORT = {
  base_lexicon: 'base',
  idiom_lexicon: 'idiom',
  domain_lexicon: 'domain',
  industry_routing_lexicon: 'routing',
  term: 'term',
  term_domain_tags: 'term_domain_tags',
};

export function v3BundleFiles(bundleDir) {
  return {
    bundleDir,
    sqlitePath: path.join(bundleDir, RUNTIME_SQLITE),
    manifestPath: path.join(bundleDir, RUNTIME_MANIFEST),
    statsPath: path.join(bundleDir, RUNTIME_STATS),
    checksumPath: path.join(bundleDir, RUNTIME_CHECKSUM),
  };
}

export function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function normalizeChecksum(value) {
  const s = String(value ?? '').trim();
  return s.replace(/^sha256:/i, '').toLowerCase();
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function tableRowCount(raw, tableName) {
  const t = raw?.[tableName];
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  return Number(t.rowCount ?? 0);
}

/** @param {Record<string, unknown>} tables — 长键或短键 */
export function normalizeManifestTables(tables = {}) {
  const base =
    tableRowCount(tables, 'base') ||
    tableRowCount(tables, 'base_lexicon');
  const idiom =
    tableRowCount(tables, 'idiom') ||
    tableRowCount(tables, 'idiom_lexicon');
  const domain =
    tableRowCount(tables, 'domain') ||
    tableRowCount(tables, 'domain_lexicon');
  const routing =
    tableRowCount(tables, 'routing') ||
    tableRowCount(tables, 'industry_routing_lexicon');
  const term = tableRowCount(tables, 'term');
  const termDomainTags =
    tableRowCount(tables, 'term_domain_tags') || tableRowCount(tables, 'tags');
  const domainHierarchy = tableRowCount(tables, 'domain_hierarchy');
  return { base, idiom, domain, routing, term, term_domain_tags: termDomainTags, domain_hierarchy: domainHierarchy };
}

/**
 * @param {object} manifestV2
 * @param {{ bundleVersion?: number; manifestV3?: object }} opts
 */
export function buildUnifiedManifest(manifestV2, opts = {}) {
  const manifestV3 = opts.manifestV3 ?? null;
  const tables = normalizeManifestTables(manifestV3?.tables ?? manifestV2?.tables ?? {});
  if ((tables.term ?? 0) < 1) {
    throw new Error(
      'Schema V2 only: manifest missing term table counts (run lexicon:build:v2-shadow → prepare:v3-runtime)'
    );
  }
  const buildTime =
    manifestV3?.buildTime ??
    (typeof manifestV2?.buildTime === 'number'
      ? new Date(manifestV2.buildTime).toISOString()
      : manifestV2?.createdAt ?? new Date().toISOString());

  return {
    schemaVersion: V3_SCHEMA_VERSION_V3,
    bundleVersion: opts.bundleVersion ?? manifestV3?.bundleVersion ?? 1,
    bundleTag: manifestV3?.bundleTag ?? 'v3-runtime',
    buildTime,
    checksum: manifestV3?.checksum ?? manifestV2?.checksum,
    tables,
    seedInputs: manifestV3?.seedInputs ?? manifestV2?.seed_inputs ?? [],
    overlayInputs: manifestV3?.overlayInputs ?? [],
    lastPatchId: manifestV3?.lastPatchId ?? manifestV2?.lastPatchId ?? null,
    lastAppliedAt: manifestV3?.lastAppliedAt ?? manifestV2?.lastAppliedAt ?? null,
    domainAvailability: manifestV3?.domainAvailability ?? manifestV2?.domainAvailability ?? null,
    domainHierarchyVersion:
      manifestV3?.domainHierarchyVersion ?? manifestV2?.domainHierarchyVersion ?? null,
  };
}

export function buildUnifiedStats(manifest) {
  const t = manifest.tables ?? {};
  return {
    baseCount: t.base ?? 0,
    idiomCount: t.idiom ?? 0,
    domainCount: t.domain ?? 0,
    routingCount: t.routing ?? 0,
    termCount: t.term ?? 0,
    termDomainTagsCount: t.term_domain_tags ?? 0,
    domainAvailability: manifest.domainAvailability ?? {},
    domainHierarchyVersion: manifest.domainHierarchyVersion ?? null,
    generatedAt: new Date().toISOString(),
    bundleVersion: manifest.bundleVersion ?? 1,
    checksum: manifest.checksum,
  };
}

export function thresholdsForSchema(schemaVersion) {
  if (schemaVersion !== V3_SCHEMA_VERSION_V3) {
    throw new Error(`Schema V3 only: unsupported schemaVersion ${schemaVersion ?? 'unknown'}`);
  }
  return V3_TABLE_THRESHOLDS_V3;
}

export function assertTableThresholds(tables, onFail, schemaVersion = V3_SCHEMA_VERSION_V3) {
  const normalized = normalizeManifestTables(tables);
  const thresholds = thresholdsForSchema(schemaVersion);
  for (const [key, min] of Object.entries(thresholds)) {
    const count = normalized[key] ?? 0;
    if (count < min) {
      onFail(`${key}=${count} < minimum ${min}`);
    }
  }
}

export function isSingleManifestLayout(bundleDir) {
  const files = v3BundleFiles(bundleDir);
  return fs.existsSync(files.manifestPath) && fs.existsSync(files.sqlitePath);
}

/**
 * 将 v3 bundle 从双 manifest 布局迁移为单 manifest（幂等：已迁移则跳过写入）。
 * @returns {{ migrated: boolean; backupDir?: string }}
 */
export function migrateBundleToSingleManifest(bundleDir) {
  if (isSingleManifestLayout(bundleDir)) {
    return { migrated: false };
  }

  const legacySqlite = path.join(bundleDir, LEGACY_FILES.sqliteV2);
  const targetSqlite = path.join(bundleDir, RUNTIME_SQLITE);
  if (!fs.existsSync(legacySqlite)) {
    throw new Error(`missing ${LEGACY_FILES.sqliteV2} under ${bundleDir}`);
  }

  const backupDir = path.join(bundleDir, BACKUP_DIR_NAME);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const name of Object.values(LEGACY_FILES)) {
    const src = path.join(bundleDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, name));
    }
  }
  if (fs.existsSync(targetSqlite)) {
    fs.copyFileSync(targetSqlite, path.join(backupDir, RUNTIME_SQLITE));
  }

  const manifestV2 = readJsonIfExists(path.join(bundleDir, LEGACY_FILES.manifestV2));
  const manifestV3 = readJsonIfExists(path.join(bundleDir, LEGACY_FILES.manifestV3));
  if (!manifestV2 && !manifestV3) {
    throw new Error(`missing ${LEGACY_FILES.manifestV2} and ${LEGACY_FILES.manifestV3}`);
  }

  if (!fs.existsSync(targetSqlite)) {
    fs.renameSync(legacySqlite, targetSqlite);
  }

  const unifiedManifest = buildUnifiedManifest(manifestV2 ?? manifestV3, {
    bundleVersion: manifestV3?.bundleVersion,
    manifestV3,
  });
  const unifiedStats = buildUnifiedStats(unifiedManifest);

  fs.writeFileSync(
    path.join(bundleDir, RUNTIME_MANIFEST),
    `${JSON.stringify(unifiedManifest, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(bundleDir, RUNTIME_STATS),
    `${JSON.stringify(unifiedStats, null, 2)}\n`
  );

  const checksumHex = sha256File(targetSqlite);
  const expected = normalizeChecksum(unifiedManifest.checksum);
  if (expected && expected !== checksumHex) {
    throw new Error(`checksum mismatch before finalize: manifest=${expected} sqlite=${checksumHex}`);
  }
  unifiedManifest.checksum = `sha256:${checksumHex}`;
  unifiedStats.checksum = unifiedManifest.checksum;
  fs.writeFileSync(
    path.join(bundleDir, RUNTIME_MANIFEST),
    `${JSON.stringify(unifiedManifest, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(bundleDir, RUNTIME_STATS),
    `${JSON.stringify(unifiedStats, null, 2)}\n`
  );
  fs.writeFileSync(path.join(bundleDir, RUNTIME_CHECKSUM), `${checksumHex}\n`);

  for (const name of Object.values(LEGACY_FILES)) {
    const p = path.join(bundleDir, name);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }

  return { migrated: true, backupDir };
}

/** @deprecated use normalizeManifestTables */
export function tableCountsFromManifestV2(manifestV2) {
  const t = normalizeManifestTables(manifestV2?.tables ?? {});
  return {
    base_lexicon: t.base,
    idiom_lexicon: t.idiom,
    domain_lexicon: t.domain,
    industry_routing_lexicon: t.routing,
  };
}

/** @deprecated use buildUnifiedManifest */
export function buildManifestV3FromV2(manifestV2, opts = {}) {
  const m = buildUnifiedManifest(manifestV2, opts);
  return {
    ...m,
    tables: {
      base_lexicon: m.tables.base,
      idiom_lexicon: m.tables.idiom,
      domain_lexicon: m.tables.domain,
      industry_routing_lexicon: m.tables.routing,
    },
  };
}

/** @deprecated use buildUnifiedStats */
export function buildStatsV3FromManifestV3(manifestV3) {
  return buildUnifiedStats(
    manifestV3.tables?.base != null
      ? manifestV3
      : { ...manifestV3, tables: normalizeManifestTables(manifestV3.tables) }
  );
}

export { SQL_TABLE_TO_SHORT };
