#!/usr/bin/env node
/**
 * Recover V5 — 从 seed jsonl 构建 scored lexicon bundle
 *
 * 迁移规则：
 * - term === replacement → hotword（必填 pinyin + priorScore）
 * - term !== replacement → confusion
 * - priorScore：seed.priorScore ?? log1p(frequency)，写入 manifest.prior_score_migration
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const electronNodeRoot = path.resolve(__dirname, '..');

const DEFAULT_SEED = path.join(
  electronNodeRoot,
  'data',
  'lexicon',
  'zh_asr_confusions_seed_high_quality.jsonl'
);
const DATA_DIR = path.join(electronNodeRoot, 'data', 'lexicon');
const HOTWORDS_JSONL = path.join(DATA_DIR, 'hotwords.jsonl');
const CONFUSIONS_JSONL = path.join(DATA_DIR, 'confusions.jsonl');
const bundleDir = path.join(repoRoot, 'node_runtime', 'lexicon', 'current');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');

const MAX_WORD_LEN = 8;
const SCORED_LEXICON_VERSION = 'v5';
const BUNDLE_TAG = process.env.BUNDLE_TAG?.trim() || 'v5-from-seed';
const SEED_PATH = process.env.SEED_PATH?.trim() || DEFAULT_SEED;

function frequencyFromPriority(priority) {
  const p = Number(priority) || 5;
  if (p >= 10) return 100;
  if (p >= 5) return 50;
  return 10;
}

function initialPriorScoreFromFrequency(frequency) {
  return Math.log1p(Math.max(1, frequency));
}

function resolvePriorScore(row, frequency) {
  const raw = row.priorScore ?? row.prior_score;
  if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  return initialPriorScoreFromFrequency(frequency);
}

function slugId(prefix, word) {
  return `${prefix}-${Buffer.from(word, 'utf8').toString('hex').slice(0, 12)}`;
}

function normalizePinyin(raw) {
  if (!raw?.trim()) return '';
  return raw.trim().toLowerCase();
}

function normalizeTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((t) => typeof t === 'string' && t.trim());
  }
  return [];
}

function isValidHotwordWord(word) {
  if (!word || word.length < 1 || word.length > MAX_WORD_LEN) return false;
  return true;
}

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN_RE = /[A-Za-z0-9]/;

function isMixedLatinToken(word) {
  return LATIN_RE.test(word) && !CJK_RE.test(word);
}

function loadSeedLines(seedPath) {
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Seed not found: ${seedPath}`);
  }
  const lines = fs.readFileSync(seedPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      console.warn('Skip invalid jsonl line:', line.slice(0, 80));
    }
  }
  return rows;
}

function migrateSeed(rows) {
  const hotwordsByWord = new Map();
  const confusions = [];
  const warnings = [];
  let usedFrequencyMigration = false;

  for (const row of rows) {
    if (row.enabled === 0 || row.enabled === false) continue;

    const term = (row.term ?? '').trim();
    const replacement = (row.replacement ?? '').trim();
    const pinyin = normalizePinyin(row.pinyin);
    const source = row.source ?? 'seed';
    const freq = frequencyFromPriority(row.priority);
    const priorScore = resolvePriorScore(row, freq);
    if (row.priorScore === undefined && row.prior_score === undefined) {
      usedFrequencyMigration = true;
    }
    const tags = normalizeTags(row.tags);
    const domain = (row.domain ?? 'asr').trim() || 'asr';

    if (!replacement) {
      warnings.push(`skip empty replacement: ${row.id}`);
      continue;
    }

    if (term === replacement) {
      if (!isValidHotwordWord(term)) {
        warnings.push(`skip hotword len: ${term}`);
        continue;
      }
      if (!pinyin) {
        warnings.push(`skip hotword no pinyin: ${term}`);
        continue;
      }
      if (!Number.isFinite(priorScore) || priorScore <= 0) {
        warnings.push(`skip hotword no priorScore: ${term}`);
        continue;
      }
      const existing = hotwordsByWord.get(term);
      const id = existing?.id ?? row.id ?? slugId('hw', term);
      const mergedPrior = Math.max(existing?.prior_score ?? 0, priorScore);
      hotwordsByWord.set(term, {
        id,
        word: term,
        pinyin,
        prior_score: mergedPrior,
        frequency: Math.max(existing?.frequency ?? 0, freq),
        domain,
        tags: JSON.stringify(tags.length ? tags : existing?.tags ? JSON.parse(existing.tags) : []),
        enabled: 1,
      });
    } else {
      if (!term || !replacement) continue;
      confusions.push({
        id: row.id ?? slugId('cf', `${term}->${replacement}`),
        observed: term,
        replacement,
        pinyin: pinyin || null,
        source,
        enabled: 1,
      });
    }
  }

  for (const cf of confusions) {
    if (hotwordsByWord.has(cf.replacement)) continue;
    const pinyin = cf.pinyin;
    if (!pinyin) {
      warnings.push(`confusion without hotword/pinyin: ${cf.observed} -> ${cf.replacement}`);
      continue;
    }
    if (!isValidHotwordWord(cf.replacement)) continue;
    const priorScore = initialPriorScoreFromFrequency(50);
    usedFrequencyMigration = true;
    hotwordsByWord.set(cf.replacement, {
      id: slugId('hw', cf.replacement),
      word: cf.replacement,
      pinyin,
      prior_score: priorScore,
      frequency: 50,
      domain: 'asr',
      tags: '[]',
      enabled: 1,
    });
  }

  const hotwords = [...hotwordsByWord.values()];
  const enabled = hotwords.filter((h) => h.enabled === 1);
  const withoutPrior = enabled.filter((h) => !h.prior_score || h.prior_score <= 0);

  const hotwordIdByWord = new Map();
  for (const hw of hotwords) {
    hotwordIdByWord.set(hw.word, hw.id);
  }

  const resolvedConfusions = [];
  for (const cf of confusions) {
    const hotwordId = hotwordIdByWord.get(cf.replacement);
    if (!hotwordId) {
      warnings.push(`no hotword for confusion: ${cf.observed} -> ${cf.replacement}`);
      continue;
    }
    if (cf.observed === cf.replacement) continue;
    resolvedConfusions.push({
      id: cf.id,
      observed: cf.observed,
      hotword_id: hotwordId,
      pinyin: cf.pinyin,
      source: cf.source,
      enabled: cf.enabled,
    });
  }

  return {
    hotwords,
    confusions: resolvedConfusions,
    warnings,
    usedFrequencyMigration,
    termsWithoutPriorCount: withoutPrior.length,
    mixedTokenCount: enabled.filter((h) => isMixedLatinToken(h.word)).length,
  };
}

function writeJsonl(filePath, objects) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = objects.map((o) => JSON.stringify(o)).join('\n') + (objects.length ? '\n' : '');
  fs.writeFileSync(filePath, body, 'utf-8');
}

function buildSqlite(hotwords, confusions) {
  fs.mkdirSync(bundleDir, { recursive: true });
  const tmpPath = `${sqlitePath}.build.tmp`;
  if (fs.existsSync(tmpPath)) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }

  const db = new Database(tmpPath);
  db.exec(`
CREATE TABLE lexicon_terms (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  prior_score REAL NOT NULL,
  frequency INTEGER DEFAULT 1,
  domain TEXT,
  tags TEXT,
  enabled INTEGER DEFAULT 1
);
CREATE TABLE lexicon_confusions (
  id TEXT PRIMARY KEY,
  observed TEXT NOT NULL,
  hotword_id TEXT NOT NULL,
  pinyin TEXT,
  source TEXT,
  enabled INTEGER DEFAULT 1
);
CREATE INDEX idx_lexicon_terms_word ON lexicon_terms(word);
CREATE INDEX idx_lexicon_confusions_observed ON lexicon_confusions(observed);
`);

  const insertHw = db.prepare(
    `INSERT INTO lexicon_terms (id, word, pinyin, prior_score, frequency, domain, tags, enabled)
     VALUES (@id, @word, @pinyin, @prior_score, @frequency, @domain, @tags, @enabled)`
  );
  const insertCf = db.prepare(
    `INSERT INTO lexicon_confusions (id, observed, hotword_id, pinyin, source, enabled)
     VALUES (@id, @observed, @hotword_id, @pinyin, @source, @enabled)`
  );

  for (const hw of hotwords) {
    insertHw.run(hw);
  }
  for (const cf of confusions) {
    insertCf.run(cf);
  }
  db.close();

  try {
    if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
  } catch (e) {
    if (e?.code === 'EBUSY') {
      console.error(
        '\n[build-lexicon-bundle] lexicon.sqlite 被占用（请先关闭 Electron 节点），',
        '已生成临时库:',
        tmpPath
      );
      throw e;
    }
    throw e;
  }
  fs.renameSync(tmpPath, sqlitePath);
}

function main() {
  console.log('[build-lexicon-bundle] seed:', SEED_PATH);
  const rows = loadSeedLines(SEED_PATH);
  const {
    hotwords,
    confusions,
    warnings,
    usedFrequencyMigration,
    termsWithoutPriorCount,
    mixedTokenCount,
  } = migrateSeed(rows);

  if (!hotwords.length) {
    throw new Error('No hotwords after migration');
  }
  if (termsWithoutPriorCount > 0) {
    throw new Error(`terms_without_prior_count=${termsWithoutPriorCount}, must be 0`);
  }

  writeJsonl(
    HOTWORDS_JSONL,
    hotwords.map((h) => ({
      id: h.id,
      word: h.word,
      pinyin: h.pinyin,
      priorScore: h.prior_score,
      frequency: h.frequency,
      domain: h.domain,
      enabled: h.enabled,
      tags: JSON.parse(h.tags || '[]'),
    }))
  );
  writeJsonl(
    CONFUSIONS_JSONL,
    confusions.map((c) => ({
      id: c.id,
      observed: c.observed,
      hotword_id: c.hotword_id,
      pinyin: c.pinyin,
      source: c.source,
      enabled: c.enabled,
    }))
  );

  buildSqlite(hotwords, confusions);

  const checksum = crypto.createHash('sha256').update(fs.readFileSync(sqlitePath)).digest('hex');
  const enabledCount = hotwords.filter((h) => h.enabled === 1).length;
  const pinyinKeys = new Set();
  let indexedTermCount = 0;
  for (const hw of hotwords) {
    if (hw.enabled !== 1 || !(hw.prior_score > 0)) continue;
    const syllables = (hw.pinyin || '').trim().split(/\s+/).filter(Boolean);
    if (!syllables.length) continue;
    pinyinKeys.add(syllables.join('|'));
    indexedTermCount += 1;
  }
  const manifest = {
    version: 'recover-v5-scored-lexicon',
    checksum,
    createdAt: new Date().toISOString(),
    backend: 'sqlite',
    bundle_tag: BUNDLE_TAG,
    hotword_count: hotwords.length,
    confusion_count: confusions.length,
    seed_path: path.relative(repoRoot, SEED_PATH),
    scored_lexicon_version: SCORED_LEXICON_VERSION,
    term_count: hotwords.length,
    enabled_term_count: enabledCount,
    terms_with_prior_count: enabledCount,
    terms_without_prior_count: 0,
    pinyin_index_count: pinyinKeys.size,
    same_pinyin_key_count: pinyinKeys.size,
    indexed_term_count: indexedTermCount,
    mixed_token_count: mixedTokenCount,
    ...(usedFrequencyMigration ? { prior_score_migration: 'frequency_log1p_v1' } : {}),
  };
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(bundleDir, 'checksum.txt'), checksum);

  console.log('[build-lexicon-bundle] hotwords.jsonl →', HOTWORDS_JSONL);
  console.log('[build-lexicon-bundle] confusions.jsonl →', CONFUSIONS_JSONL);
  console.log('[build-lexicon-bundle] sqlite →', sqlitePath);
  console.log(`  hotwords=${hotwords.length} confusions=${confusions.length} mixed_token=${mixedTokenCount}`);
  if (warnings.length) {
    console.log(`  warnings=${warnings.length} (first 5):`);
    warnings.slice(0, 5).forEach((w) => console.log('   ', w));
  }
}

main();
