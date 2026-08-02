/**
 * Lexicon V2 shadow bundle — four-table SQLite + manifest_v2 (Phase 0 only).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { formatChecksum, sha256Hex } from './checksum.mjs';
import { parseSeedRow } from './parse-rows.mjs';
import { classifyLexiconV2Row } from './v2-classify-row.mjs';
import {
  buildCanonicalRecord,
  buildIndustryRouteFromDomainCanonical,
  materializeAliasRows,
} from './v2-materialize-aliases.mjs';
import {
  buildShadowStats,
  bumpRejectStats,
  initRejectStats,
  writeRejectedJsonl,
  writeStatsJson,
} from './v2-shadow-stats.mjs';
import { resolveSeedPriorScore } from './seed-domain-tags.mjs';
import {
  createDomainTermRegistry,
  materializeDomainSsotTables,
  upsertDomainTermEntry,
} from './term-ssot-build.mjs';

export const LEXICON_V2_SHADOW_SCHEMA_VERSION = 'lexicon-v2-shadow-v2';
export const LEXICON_V2_SHADOW_SCHEMA_V2_TERM = 'lexicon-v2-shadow-v2-term';

const SCHEMA_SQL = `
CREATE TABLE base_lexicon (
  id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pinyin_key, word)
);
CREATE INDEX idx_base_pinyin ON base_lexicon(pinyin_key);
CREATE INDEX idx_base_pinyin_tone ON base_lexicon(pinyin_key, tone_pinyin_key);

CREATE TABLE idiom_lexicon (
  id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pinyin_key, word)
);
CREATE INDEX idx_idiom_pinyin ON idiom_lexicon(pinyin_key);
CREATE INDEX idx_idiom_pinyin_tone ON idiom_lexicon(pinyin_key, tone_pinyin_key);

CREATE TABLE domain_lexicon (
  id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  aliases TEXT,
  source TEXT,
  canonical_word TEXT,
  is_alias INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_id, word)
);
CREATE INDEX idx_domain_pinyin ON domain_lexicon(domain_id, pinyin_key);
CREATE INDEX idx_domain_pinyin_tone ON domain_lexicon(domain_id, pinyin_key, tone_pinyin_key);

CREATE TABLE industry_routing_lexicon (
  pinyin_key TEXT NOT NULL,
  keyword TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (pinyin_key, keyword, domain_id)
);

CREATE TABLE term (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  pinyin_key TEXT NOT NULL,
  tone_pinyin_key TEXT,
  prior_score REAL NOT NULL,
  repair_target INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  source TEXT,
  tier TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_term_word_pinyin ON term(word, pinyin_key);
CREATE INDEX idx_term_pinyin ON term(pinyin_key, enabled);

CREATE TABLE term_domain_tags (
  term_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (term_id, domain_id),
  FOREIGN KEY (term_id) REFERENCES term(id)
);
CREATE INDEX idx_term_domain_tags_domain ON term_domain_tags(domain_id, term_id);

CREATE TABLE domain_hierarchy (
    parent_domain_id TEXT NOT NULL,
    child_domain_id  TEXT NOT NULL,
    PRIMARY KEY (parent_domain_id, child_domain_id)
);
CREATE INDEX idx_domain_hierarchy_child ON domain_hierarchy(child_domain_id);
`;

function buildHierarchyRowsFromRegistry(registry) {
  const rows = [];
  for (const entry of registry.entries) {
    const parent = entry.parent?.trim();
    if (parent && parent !== 'general' && entry.enabled) {
      rows.push({ parent_domain_id: parent, child_domain_id: entry.id });
    }
  }
  return rows;
}

function buildDomainAvailabilityFromTags(tagRows) {
  const counts = {};
  for (const tag of tagRows ?? []) {
    const id = tag.domain_id;
    if (!id) {
      continue;
    }
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function hashRegistryFile(registryPath) {
  if (!registryPath || !fs.existsSync(registryPath)) {
    return 'unknown';
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(registryPath)).digest('hex');
  return `sha256:${hash}`;
}

function routingKey(row) {
  return `${row.pinyin_key}\t${row.keyword}\t${row.domain_id}`;
}

function pushRouting(routingRows, routingSeen, route) {
  if (!route) {
    return;
  }
  const key = routingKey(route);
  if (routingSeen.has(key)) {
    return;
  }
  routingSeen.add(key);
  routingRows.push(route);
}

function pushTierRows(target, aliasTarget, canonical, materialized, tier) {
  target.push({ ...canonical, tier });
  for (const aliasRow of materialized) {
    aliasTarget.push(aliasRow);
    target.push(aliasRow);
  }
}

export function classifySeedRowsToV2Tables(rows, registry) {
  const baseRows = [];
  const idiomRows = [];
  const domainRows = [];
  const routingRows = [];
  const aliasRows = [];
  const rejected = [];
  const rejectStats = initRejectStats();
  const domainTermRegistry = createDomainTermRegistry();

  for (const entry of rows) {
    const parsed = parseSeedRow(entry);
    const classification = classifyLexiconV2Row(entry, registry);

    if (classification.tier === 'reject') {
      bumpRejectStats(rejectStats, classification.rejectCode);
      rejected.push({
        file: entry.file,
        line: entry.line,
        word: parsed.word ?? '',
        rejectCode: classification.rejectCode,
        reason: classification.rejectMessage,
      });
      continue;
    }

    const priorScore = resolveSeedPriorScore(parsed);
    if (!(priorScore > 0)) {
      bumpRejectStats(rejectStats, 'invalid_prior');
      rejected.push({
        file: entry.file,
        line: entry.line,
        word: parsed.word ?? '',
        rejectCode: 'invalid_prior',
        reason: 'priorScore must be > 0',
      });
      continue;
    }

    if (classification.tier === 'base') {
      const canonical = buildCanonicalRecord({ tier: 'base', parsed: { ...parsed, priorScore }, classification });
      const materialized = materializeAliasRows({ tier: 'base', row: parsed, canonical });
      pushTierRows(baseRows, aliasRows, canonical, materialized, 'base');
      continue;
    }

    if (classification.tier === 'idiom') {
      const canonical = buildCanonicalRecord({ tier: 'idiom', parsed: { ...parsed, priorScore }, classification });
      const materialized = materializeAliasRows({ tier: 'idiom', row: parsed, canonical });
      pushTierRows(idiomRows, aliasRows, canonical, materialized, 'idiom');
      continue;
    }

    if (classification.tier === 'domain') {
      upsertDomainTermEntry(domainTermRegistry, { parsed: { ...parsed, priorScore }, classification });
    }
  }

  const ssot = materializeDomainSsotTables(domainTermRegistry);
  domainRows.push(...ssot.domainRows);
  aliasRows.push(...ssot.aliasRows);
  routingRows.push(...ssot.routingRows);

  return {
    baseRows,
    idiomRows,
    domainRows,
    routingRows,
    aliasRows,
    termRows: ssot.termRows,
    tagRows: ssot.tagRows,
    rejected,
    rejectStats,
  };
}

function writeSqliteBundle({
  bundleDir,
  sqlitePath,
  baseRows,
  idiomRows,
  domainRows,
  routingRows,
  termRows = [],
  tagRows = [],
  hierarchyRows = [],
}) {
  fs.mkdirSync(bundleDir, { recursive: true });
  const tmpPath = `${sqlitePath}.build.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }

  const db = new Database(tmpPath);
  db.exec(SCHEMA_SQL);

  const insertBase = db.prepare(`
    INSERT INTO base_lexicon
      (id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertIdiom = db.prepare(`
    INSERT INTO idiom_lexicon
      (id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertDomain = db.prepare(`
    INSERT INTO domain_lexicon
      (id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @domain_id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertRouting = db.prepare(`
    INSERT INTO industry_routing_lexicon (pinyin_key, keyword, domain_id, weight)
    VALUES (@pinyin_key, @keyword, @domain_id, @weight)
  `);
  const insertTerm = db.prepare(`
    INSERT INTO term
      (id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier)
    VALUES
      (@id, @word, @pinyin_key, @tone_pinyin_key, @prior_score, @repair_target, @enabled, @source, @tier)
  `);
  const insertTag = db.prepare(`
    INSERT INTO term_domain_tags (term_id, domain_id, weight)
    VALUES (@term_id, @domain_id, @weight)
  `);
  const insertHierarchy = db.prepare(`
    INSERT INTO domain_hierarchy (parent_domain_id, child_domain_id)
    VALUES (@parent_domain_id, @child_domain_id)
  `);

  const insertAll = db.transaction(() => {
    for (const row of baseRows) {
      insertBase.run(row);
    }
    for (const row of idiomRows) {
      insertIdiom.run(row);
    }
    for (const row of domainRows) {
      insertDomain.run(row);
    }
    for (const row of routingRows) {
      insertRouting.run(row);
    }
    for (const row of termRows) {
      insertTerm.run(row);
    }
    for (const row of tagRows) {
      insertTag.run(row);
    }
    for (const row of hierarchyRows) {
      insertHierarchy.run(row);
    }
  });

  insertAll();
  db.close();

  if (fs.existsSync(sqlitePath)) {
    fs.unlinkSync(sqlitePath);
  }
  fs.renameSync(tmpPath, sqlitePath);
}

export function buildV2ShadowBundle({
  rows,
  registry,
  registryPath,
  bundleDir,
  seedRootRel,
  seedInputRels,
  /** @deprecated use seedRootRel + seedInputRels */
  seedPathRel,
  bundleTag = 'v2-shadow',
}) {
  const resolvedSeedRootRel = seedRootRel ?? seedPathRel ?? '';
  const resolvedSeedInputs = seedInputRels?.length
    ? seedInputRels
    : seedPathRel
      ? [seedPathRel]
      : [];
  const tables = classifySeedRowsToV2Tables(rows, registry);
  const sqlitePath = path.join(bundleDir, 'lexicon_v2.sqlite');
  const rejectedPath = path.join(bundleDir, 'rejected_v2.jsonl');
  const statsPath = path.join(bundleDir, 'stats_v2.json');

  const hierarchyRows = buildHierarchyRowsFromRegistry(registry);
  const domainAvailability = buildDomainAvailabilityFromTags(tables.tagRows ?? []);

  writeSqliteBundle({
    bundleDir,
    sqlitePath,
    baseRows: tables.baseRows,
    idiomRows: tables.idiomRows,
    domainRows: tables.domainRows,
    routingRows: tables.routingRows,
    termRows: tables.termRows ?? [],
    tagRows: tables.tagRows ?? [],
    hierarchyRows,
  });

  const checksum = formatChecksum(sha256Hex(sqlitePath));
  const stats = buildShadowStats({
    baseRows: tables.baseRows,
    idiomRows: tables.idiomRows,
    domainRows: tables.domainRows,
    routingRows: tables.routingRows,
    aliasRows: tables.aliasRows,
    termRows: tables.termRows ?? [],
    tagRows: tables.tagRows ?? [],
    rejected: tables.rejected,
    rejectStats: tables.rejectStats,
  });
  stats.domainAvailability = domainAvailability;
  stats.domainHierarchyVersion = hashRegistryFile(registryPath);

  writeRejectedJsonl(tables.rejected, rejectedPath);
  writeStatsJson(stats, statsPath);

  const useTermSsot = (tables.termRows ?? []).length > 0;
  const manifest = {
    schemaVersion: useTermSsot ? LEXICON_V2_SHADOW_SCHEMA_V2_TERM : LEXICON_V2_SHADOW_SCHEMA_VERSION,
    buildTime: Date.now(),
    bundle_tag: bundleTag,
    checksum,
    createdAt: new Date().toISOString(),
    backend: 'sqlite',
    seed_path: resolvedSeedRootRel,
    seed_inputs: resolvedSeedInputs,
    tables: {
      ...stats.tables,
      domain_hierarchy: { rowCount: hierarchyRows.length },
    },
    domainAvailability,
    domainHierarchyVersion: hashRegistryFile(registryPath),
    rejectedCount: stats.rejectedCount,
    rejectStats: stats.rejectStats,
  };

  fs.writeFileSync(path.join(bundleDir, 'manifest_v2.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(bundleDir, 'checksum.txt'), checksum);

  return { manifest, stats, sqlitePath, rejectedPath, statsPath, ...tables };
}
