/**
 * Lexicon Full Rebuild from formal CSV/JSONL SSOT.
 * Does NOT read existing production SQLite for term/idiom/hierarchy content.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { V3_SCHEMA_VERSION_V3, buildUnifiedStats } from './lexicon-v3-runtime.mjs';
import { electronNodeRoot, repoRoot, defaultRegistryPath } from './paths.mjs';
import { slugTermId } from './term-materialize.mjs';
import { resolvePinyinKey, resolveTonePinyinKey } from './v2-pinyin-key.mjs';
import { loadRegistry, classifyLexiconV2Row } from './v2-classify-row.mjs';
import { buildCanonicalRecord } from './v2-materialize-aliases.mjs';
import { parseSeedRow } from './parse-rows.mjs';
import { writeAtomicityReports } from './atomicity-report.mjs';

const require = createRequire(import.meta.url);
const {
  validateAtomicity,
  applyAtomicityMode,
  buildAtomicSurfaceSet,
} = require('./atomicity-validator.cjs');

/**
 * Must match runtime Owner: main/src/lexicon/phonetic/pinyin.ts normalizeSyllable.
 * Strips non [a-z0-9] so Source `lüe` → runtime/SQL `le` (Exact Recall tone key aligned).
 */
function normalizeSyllableAscii(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizePinyinKeyForRuntime(key) {
  return String(key || '')
    .split('|')
    .map(normalizeSyllableAscii)
    .filter(Boolean)
    .join('|');
}

function normalizeTonePinyinKeyForRuntime(key) {
  if (!key) return null;
  const parts = String(key)
    .split('|')
    .map((part) => {
      const raw = String(part || '').trim().toLowerCase();
      const m = raw.match(/^(.+?)([1-5])$/);
      if (!m) return normalizeSyllableAscii(raw);
      const syl = normalizeSyllableAscii(m[1]);
      return syl ? `${syl}${m[2]}` : '';
    })
    .filter(Boolean);
  return parts.length ? parts.join('|') : null;
}

export const FULL_REBUILD_SOURCE_DIR = () =>
  path.join(electronNodeRoot(), '../docs/lexicon-assets/full_rebuild_v1');

export const DEFAULT_IDIOM_JSONL = () =>
  path.join(
    electronNodeRoot(),
    '../docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/idiom_zh_v2/entries.jsonl'
  );

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
CREATE INDEX idx_term_pinyin ON term(pinyin_key);
CREATE INDEX idx_term_pinyin_tone ON term(pinyin_key, tone_pinyin_key);
CREATE INDEX idx_term_word ON term(word);

CREATE TABLE term_domain_tags (
  term_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (term_id, domain_id)
);
CREATE INDEX idx_term_domain_tags_domain ON term_domain_tags(domain_id);

CREATE TABLE domain_hierarchy (
  parent_domain_id TEXT NOT NULL,
  child_domain_id TEXT NOT NULL,
  PRIMARY KEY (parent_domain_id, child_domain_id)
);
CREATE INDEX idx_domain_hierarchy_child ON domain_hierarchy(child_domain_id);
`;

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  function readRow() {
    const cells = [];
    let cell = '';
    let inQ = false;
    while (i < len) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i += 1;
          continue;
        }
        cell += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQ = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        cells.push(cell);
        cell = '';
        i += 1;
        continue;
      }
      if (ch === '\n') {
        i += 1;
        cells.push(cell);
        return cells;
      }
      if (ch === '\r') {
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
    }
    if (cell.length || cells.length) {
      cells.push(cell);
      return cells;
    }
    return null;
  }
  const header = readRow();
  if (!header) return [];
  let rowNum = 1; // header is row 1; data starts at 2
  while (true) {
    const cells = readRow();
    if (!cells) break;
    rowNum += 1;
    if (cells.length === 1 && cells[0] === '') continue;
    const obj = { __rowNum: rowNum };
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    rows.push(obj);
  }
  return rows;
}

function readCsv(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseCsv(text);
}

function assertNoOldDbRead(opts) {
  if (opts.allowOldDb === true) {
    throw new Error('Full Rebuild must not use old DB as content source');
  }
}

/**
 * Deterministic termId for supplemental rows.
 * Primary: term-{utf8(word|pinyin).hex[:16]}
 * On collision with an existing id: supp-{utf8(word|pinyin).hex[:24]}
 * (Matches production Full Rebuild supplemental disambiguation.)
 */
export function allocateSupplementalTermId(word, pinyinKey, existingIds) {
  const primary = slugTermId(word, pinyinKey);
  if (!existingIds.has(primary)) {
    return primary;
  }
  const fullHex = Buffer.from(`${word}|${pinyinKey}`, 'utf8').toString('hex');
  const alt = `supp-${fullHex.slice(0, 24)}`;
  if (existingIds.has(alt)) {
    throw new Error(`supplemental termId still collides after disambiguation: ${alt} word=${word}`);
  }
  return alt;
}

function buildHierarchyFromRegistry(registry) {
  const rows = [];
  for (const entry of registry.entries) {
    const parent = entry.parent?.trim();
    if (parent && parent !== 'general' && entry.enabled) {
      rows.push({ parent_domain_id: parent, child_domain_id: entry.id });
    }
  }
  rows.sort(
    (a, b) =>
      a.parent_domain_id.localeCompare(b.parent_domain_id) ||
      a.child_domain_id.localeCompare(b.child_domain_id)
  );
  return rows;
}

function loadIdiomRows(idiomJsonlPath, registry) {
  const lines = fs.readFileSync(idiomJsonlPath, 'utf8').split(/\r?\n/);
  const out = [];
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      throw new Error(`idiom JSONL parse error line ${lineNo}: ${e.message}`);
    }
    const entry = { row, file: idiomJsonlPath, line: lineNo };
    const classification = classifyLexiconV2Row(entry, registry);
    if (classification.tier !== 'idiom') {
      continue;
    }
    const parsed = parseSeedRow(entry);
    const canonical = buildCanonicalRecord({
      tier: 'idiom',
      parsed: { ...parsed, priorScore: parsed.priorScore ?? 0.9 },
      classification,
    });
    out.push(canonical);
  }
  out.sort((a, b) => a.word.localeCompare(b.word) || a.id.localeCompare(b.id));
  return out;
}

/**
 * @param {{
 *   sourceDir?: string,
 *   idiomJsonlPath?: string,
 *   registryPath?: string,
 *   outDir: string,
 *   bundleVersion?: number,
 *   Database?: typeof import('better-sqlite3'),
 * }} opts
 */
export function runFullRebuildFromSources(opts) {
  assertNoOldDbRead(opts);
  const Database = opts.Database || require('better-sqlite3');
  const sourceDir = path.resolve(opts.sourceDir || FULL_REBUILD_SOURCE_DIR());
  const idiomJsonlPath = path.resolve(opts.idiomJsonlPath || DEFAULT_IDIOM_JSONL());
  const registryPath = path.resolve(opts.registryPath || defaultRegistryPath());
  const outDir = path.resolve(opts.outDir);
  const sourcesManifestPath = path.join(sourceDir, 'sources.manifest.json');
  // Atomicity Closure: production Full Rebuild defaults to enforce.
  const atomicityModeRaw = String(
    opts.atomicityMode || process.env.LEXICON_ATOMICITY_MODE || 'enforce'
  )
    .trim()
    .toLowerCase();
  const atomicityMode = atomicityModeRaw === 'audit' ? 'audit' : 'enforce';

  const required = [
    'lexicon_full_corrected_review.csv',
    'term_domain_tags_corrected.csv',
    'supplemental_terms.csv',
    'terms_to_remove_or_rebuild.csv',
    'sources.manifest.json',
  ];
  for (const name of required) {
    const p = path.join(sourceDir, name);
    if (!fs.existsSync(p)) throw new Error(`missing source: ${p}`);
  }
  if (!fs.existsSync(idiomJsonlPath)) throw new Error(`missing idiom source: ${idiomJsonlPath}`);
  if (!fs.existsSync(registryPath)) throw new Error(`missing hierarchy source: ${registryPath}`);

  // Refuse tmp as sourceDir
  const norm = sourceDir.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/tmp/') || norm.endsWith('/tmp') || norm.includes('\\tmp\\')) {
    throw new Error(`formal build must not read tmp directory: ${sourceDir}`);
  }

  const sourcesManifest = JSON.parse(fs.readFileSync(sourcesManifestPath, 'utf8'));
  const bundleVersion = opts.bundleVersion ?? sourcesManifest.contentBundleVersion ?? 11;

  // Verify declared hashes
  for (const s of sourcesManifest.termSources || []) {
    const p = path.join(sourceDir, s.file);
    const hash = `sha256:${sha256File(p)}`;
    if (hash !== s.sha256) {
      throw new Error(`source hash mismatch ${s.file}: expected ${s.sha256} got ${hash}`);
    }
  }

  const reviewPath = path.join(sourceDir, 'lexicon_full_corrected_review.csv');
  const removePath = path.join(sourceDir, 'terms_to_remove_or_rebuild.csv');
  const suppPath = path.join(sourceDir, 'supplemental_terms.csv');
  const tagsPath = path.join(sourceDir, 'term_domain_tags_corrected.csv');

  const reviewRows = readCsv(reviewPath);
  const removeRows = readCsv(removePath);
  const suppRows = readCsv(suppPath);
  const tagRowsCsv = readCsv(tagsPath);

  const removeIds = new Set(
    removeRows.map((r) => (r.term_id || '').trim()).filter(Boolean)
  );
  const removeWords = new Set(removeRows.map((r) => (r.word || '').trim()).filter(Boolean));

  /** @type {Map<string, object>} */
  const termsById = new Map();
  /** @type {Map<string, string>} word -> termId */
  const wordToId = new Map();

  for (const r of reviewRows) {
    const termId = (r.term_id || '').trim();
    const word = (r.word || '').trim();
    const status = (r.term_status || '').trim();
    if (!termId || !word) continue;
    if (removeIds.has(termId) || removeWords.has(word) || status === 'REMOVE_TERM') continue;
    const pinyin_key = normalizePinyinKeyForRuntime(r.pinyin_key || '');
    const tone_pinyin_key = normalizeTonePinyinKeyForRuntime(r.tone_pinyin_key || '');
    if (!pinyin_key) throw new Error(`review row missing pinyin_key: ${termId}`);
    const prior = Number(r.prior_score);
    const term = {
      id: termId,
      word,
      pinyin_key,
      tone_pinyin_key: tone_pinyin_key || null,
      prior_score: Number.isFinite(prior) ? prior : 0.9,
      repair_target: 1,
      enabled: 1,
      source: (r.source || '').trim(),
      tier: 'domain',
      termType: (r.term_type || r.termType || '').trim() || undefined,
      exceptionReason: (r.exception_reason || r.exceptionReason || '').trim() || undefined,
      sourceFile: 'lexicon_full_corrected_review.csv',
      sourceRow: r.__rowNum,
      sourceLabel: (r.source || '').trim(),
    };
    if (termsById.has(termId)) throw new Error(`duplicate term_id in review: ${termId}`);
    if (wordToId.has(word)) throw new Error(`duplicate word in review: ${word}`);
    termsById.set(termId, term);
    wordToId.set(word, termId);
  }

  for (const r of suppRows) {
    const word = (r.word || '').trim();
    if (!word) continue;
    if (removeWords.has(word)) continue;
    if (wordToId.has(word)) {
      // Supplemental should not overwrite review; skip if already present
      continue;
    }
    const pinyin_key = normalizePinyinKeyForRuntime(resolvePinyinKey({ word, pinyinField: '' }));
    if (!pinyin_key) throw new Error(`supplemental missing pinyin for ${word}`);
    const tone_pinyin_key = normalizeTonePinyinKeyForRuntime(
      resolveTonePinyinKey({
        word,
        pinyinField: '',
        tonePinyinField: '',
        tonePinyinKeyField: '',
      }) || ''
    );
    const termId = allocateSupplementalTermId(word, pinyin_key, termsById);
    const term = {
      id: termId,
      word,
      pinyin_key,
      tone_pinyin_key: tone_pinyin_key || null,
      prior_score: 0.9,
      repair_target: 1,
      enabled: 1,
      source: (r.source || '').trim(),
      tier: 'domain',
      termType: (r.term_type || r.termType || '').trim() || undefined,
      exceptionReason: (r.exception_reason || r.exceptionReason || '').trim() || undefined,
      sourceFile: 'supplemental_terms.csv',
      sourceRow: r.__rowNum,
      sourceLabel: (r.source || '').trim(),
    };
    termsById.set(termId, term);
    wordToId.set(word, termId);
  }

  /** @type {Map<string, {term_id:string,domain_id:string,weight:number}>} */
  const tags = new Map();
  for (const r of tagRowsCsv) {
    const termId = (r.term_id || '').trim();
    const domainId = (r.domain_id || '').trim();
    if (!termId || !domainId) continue;
    if (!termsById.has(termId)) continue; // drop tags for removed terms
    const weight = Number(r.weight);
    const key = `${termId}\t${domainId}`;
    tags.set(key, {
      term_id: termId,
      domain_id: domainId,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    });
  }
  for (const r of suppRows) {
    const word = (r.word || '').trim();
    const domainId = (r.domain_id || '').trim();
    if (!word || !domainId) continue;
    const termId = wordToId.get(word);
    if (!termId) continue;
    const weight = Number(r.weight);
    const key = `${termId}\t${domainId}`;
    tags.set(key, {
      term_id: termId,
      domain_id: domainId,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    });
  }

  const registry = loadRegistry(registryPath);
  const hierarchyRows = buildHierarchyFromRegistry(registry);
  const idiomRows = loadIdiomRows(idiomJsonlPath, registry);

  const termList = [...termsById.values()].sort(
    (a, b) => a.id.localeCompare(b.id) || a.word.localeCompare(b.word)
  );
  const tagList = [...tags.values()].sort(
    (a, b) => a.term_id.localeCompare(b.term_id) || a.domain_id.localeCompare(b.domain_id)
  );

  // Domains map for audit rows
  /** @type {Map<string, string[]>} */
  const domainsByTerm = new Map();
  for (const tag of tagList) {
    const arr = domainsByTerm.get(tag.term_id) || [];
    arr.push(tag.domain_id);
    domainsByTerm.set(tag.term_id, arr);
  }

  // Unified Atomicity Gate — BEFORE any term SQLite write
  const atomicSurfaces = buildAtomicSurfaceSet(termList.map((t) => t.word));
  const atomicityEntries = [];
  const blocked = [];
  for (const t of termList) {
    const draft = {
      termId: t.id,
      surface: t.word,
      normalizedSurface: t.word,
      pinyin: t.pinyin_key,
      tones: t.tone_pinyin_key || undefined,
      source: t.source || '',
      domains: domainsByTerm.get(t.id) || [],
      termType: t.termType,
      exceptionReason: t.exceptionReason,
      sourceFile: t.sourceFile || '',
      sourceRow: t.sourceRow ?? '',
      sourceLabel: t.sourceLabel || t.source || '',
    };
    const result = validateAtomicity(draft, { atomicSurfaces, mode: atomicityMode });
    const gate = applyAtomicityMode(result, atomicityMode);
    atomicityEntries.push({ draft, result });
    if (gate.blocked) {
      blocked.push({ surface: t.word, termId: t.id, decision: result.decision, reasonCode: result.reasonCode });
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const atomicityArtifacts = writeAtomicityReports({
    outDir,
    mode: atomicityMode,
    entries: atomicityEntries,
    meta: {
      rebuildMode: 'FULL_REBUILD',
      sourceDir: path.relative(repoRoot(), sourceDir).replace(/\\/g, '/'),
      note: 'ATOMICITY CONTENT CLEANUP EXECUTED — enforce Gate REJECT_COMPOSITE=0 UNRESOLVED=0',
    },
  });

  if (atomicityMode === 'enforce' && blocked.length) {
    throw new Error(
      `[atomicity:enforce] blocked ${blocked.length} term(s); first=${JSON.stringify(blocked[0])}`
    );
  }

  const sqlitePath = path.join(outDir, 'lexicon.sqlite');
  const tmpPath = path.join(outDir, `lexicon.sqlite.tmp.${process.pid}`);
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

  const db = new Database(tmpPath);
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
  db.exec(SCHEMA_SQL);

  const insertTerm = db.prepare(`
    INSERT INTO term (id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier)
    VALUES (@id, @word, @pinyin_key, @tone_pinyin_key, @prior_score, @repair_target, @enabled, @source, @tier)
  `);
  const insertTag = db.prepare(`
    INSERT INTO term_domain_tags (term_id, domain_id, weight) VALUES (@term_id, @domain_id, @weight)
  `);
  const insertBase = db.prepare(`
    INSERT INTO base_lexicon
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
  const insertIdiom = db.prepare(`
    INSERT INTO idiom_lexicon
      (id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertHier = db.prepare(`
    INSERT INTO domain_hierarchy (parent_domain_id, child_domain_id)
    VALUES (@parent_domain_id, @child_domain_id)
  `);

  const tx = db.transaction(() => {
    for (const t of termList) {
      insertTerm.run({
        id: t.id,
        word: t.word,
        pinyin_key: t.pinyin_key,
        tone_pinyin_key: t.tone_pinyin_key,
        prior_score: t.prior_score,
        repair_target: t.repair_target,
        enabled: t.enabled,
        source: t.source,
        tier: t.tier,
      });
    }
    for (const tag of tagList) insertTag.run(tag);

    for (const t of termList) {
      insertBase.run({
        id: `base-rebuild-${t.id}`,
        pinyin_key: t.pinyin_key,
        tone_pinyin_key: t.tone_pinyin_key,
        word: t.word,
        normalized: t.word,
        prior_score: t.prior_score,
        repair_target: t.repair_target,
        enabled: 1,
        aliases: JSON.stringify([t.word]),
        source: t.source,
        canonical_word: null,
        is_alias: 0,
      });
    }

    for (const tag of tagList) {
      const t = termsById.get(tag.term_id);
      if (!t) continue;
      insertDomain.run({
        id: t.id,
        domain_id: tag.domain_id,
        pinyin_key: t.pinyin_key,
        tone_pinyin_key: t.tone_pinyin_key,
        word: t.word,
        normalized: t.word,
        prior_score: t.prior_score,
        repair_target: t.repair_target,
        enabled: 1,
        aliases: JSON.stringify([t.word]),
        source: t.source,
        canonical_word: null,
        is_alias: 0,
      });
      insertRouting.run({
        pinyin_key: t.pinyin_key,
        keyword: t.word,
        domain_id: tag.domain_id,
        weight: tag.weight,
      });
    }

    for (const row of idiomRows) {
      insertIdiom.run({
        id: row.id,
        pinyin_key: row.pinyin_key,
        tone_pinyin_key: row.tone_pinyin_key,
        word: row.word,
        normalized: row.normalized,
        prior_score: row.prior_score,
        repair_target: row.repair_target,
        enabled: row.enabled,
        aliases: row.aliases,
        source: row.source,
        canonical_word: row.canonical_word,
        is_alias: 0,
      });
    }
    for (const h of hierarchyRows) insertHier.run(h);
  });
  tx();
  db.close();

  if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
  fs.renameSync(tmpPath, sqlitePath);

  const checksumHex = sha256File(sqlitePath);
  const domainAvailability = {};
  for (const tag of tagList) {
    domainAvailability[tag.domain_id] = (domainAvailability[tag.domain_id] || 0) + 1;
  }

  const tables = {
    base: termList.length,
    idiom: idiomRows.length,
    domain: tagList.length,
    routing: tagList.length,
    term: termList.length,
    term_domain_tags: tagList.length,
    domain_hierarchy: hierarchyRows.length,
  };

  const buildTime = new Date().toISOString();
  const registryHash = `sha256:${sha256File(registryPath)}`;
  const idiomHash = `sha256:${sha256File(idiomJsonlPath)}`;

  const manifest = {
    schemaVersion: V3_SCHEMA_VERSION_V3,
    bundleVersion,
    bundleTag: 'v3-runtime',
    buildTime,
    checksum: `sha256:${checksumHex}`,
    tables,
    sourceInputs: {
      mode: 'FULL_REBUILD',
      sourceDir: path.relative(repoRoot(), sourceDir).replace(/\\/g, '/'),
      loadOrder: sourcesManifest.loadOrder,
      termSources: sourcesManifest.termSources,
      idiomSource: {
        path: path.relative(repoRoot(), idiomJsonlPath).replace(/\\/g, '/'),
        sha256: idiomHash,
        recordCount: idiomRows.length,
      },
      hierarchySource: {
        path: path.relative(repoRoot(), registryPath).replace(/\\/g, '/'),
        sha256: registryHash,
      },
      excludedTermCount: removeIds.size,
      supplementalRowCount: suppRows.length,
      reviewKeptCount: termList.length - suppRows.filter((r) => wordToId.has((r.word || '').trim())).length,
      domainTagCount: tagList.length,
    },
    // Explicitly NOT the production content source:
    historicalInputs: {
      note: 'p1_3 seed JSONL / seed-only shadow are NOT production Full Rebuild inputs',
      seedOnlyShadow: 'NOT PRODUCTION FULL REBUILD',
    },
    overlayInputs: [],
    lastPatchId: null,
    lastAppliedAt: null,
    domainAvailability,
    domainHierarchyVersion: registryHash,
    rebuild: {
      mode: 'FULL_REBUILD',
      patchId: 'lexicon-full-rebuild-v1',
      sources: [
        'lexicon_full_corrected_review.csv',
        'term_domain_tags_corrected.csv',
        'supplemental_terms.csv',
      ],
      excluded: ['terms_to_remove_or_rebuild.csv'],
      remove_term_excluded_count: removeIds.size,
      no_merge: true,
      idiomSource: path.relative(repoRoot(), idiomJsonlPath).replace(/\\/g, '/'),
      hierarchySource: path.relative(repoRoot(), registryPath).replace(/\\/g, '/'),
    },
    atomicityNote: 'ATOMICITY CONTENT CLEANUP EXECUTED — enforce Gate REJECT_COMPOSITE=0 UNRESOLVED=0',
    atomicity: {
      mode: atomicityMode,
      report: 'atomicity_report.json',
      csv: 'atomicity_report.csv',
      summary: atomicityArtifacts.summary,
      total: atomicityArtifacts.total,
      enforceReady: true,
      runtimeSchemaExtended: false,
    },
  };

  const stats = buildUnifiedStats(manifest);
  stats.generatedAt = buildTime;

  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'checksum.txt'), `${checksumHex}\n`);

  // Content hash (deterministic business tables)
  const contentHash = computeBundleContentHash(Database, sqlitePath);

  return {
    outDir,
    sqlitePath,
    manifest,
    stats,
    checksumHex,
    contentHash,
    counts: tables,
    atomicity: atomicityArtifacts,
    sampleTerms: {
      上线计划: termsById.get(wordToId.get('上线计划')),
      接口文档: termsById.get(wordToId.get('接口文档')),
    },
  };
}

export function computeBundleContentHash(Database, sqlitePath) {
  const db = new Database(sqlitePath, { readonly: true });
  const parts = [];
  const push = (label, rows) => {
    parts.push(label);
    parts.push(JSON.stringify(rows));
  };
  push(
    'term',
    db
      .prepare(
        `SELECT id, word, pinyin_key, COALESCE(tone_pinyin_key,''), prior_score, repair_target, enabled, COALESCE(source,''), tier
         FROM term ORDER BY id, word`
      )
      .all()
  );
  push(
    'tags',
    db
      .prepare(`SELECT term_id, domain_id, weight FROM term_domain_tags ORDER BY term_id, domain_id`)
      .all()
  );
  push(
    'base',
    db
      .prepare(
        `SELECT id, pinyin_key, COALESCE(tone_pinyin_key,''), word, prior_score, source, is_alias
         FROM base_lexicon ORDER BY word, id`
      )
      .all()
  );
  push(
    'domain',
    db
      .prepare(
        `SELECT id, domain_id, pinyin_key, word, prior_score, source, is_alias
         FROM domain_lexicon ORDER BY domain_id, word, id`
      )
      .all()
  );
  push(
    'routing',
    db
      .prepare(
        `SELECT pinyin_key, keyword, domain_id, weight FROM industry_routing_lexicon
         ORDER BY pinyin_key, keyword, domain_id`
      )
      .all()
  );
  push(
    'idiom',
    db
      .prepare(
        `SELECT id, pinyin_key, COALESCE(tone_pinyin_key,''), word, prior_score, source
         FROM idiom_lexicon ORDER BY id, word`
      )
      .all()
  );
  push(
    'hierarchy',
    db
      .prepare(
        `SELECT parent_domain_id, child_domain_id FROM domain_hierarchy
         ORDER BY parent_domain_id, child_domain_id`
      )
      .all()
  );
  db.close();
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}
