#!/usr/bin/env node
/**
 * Recover V2 — 从 seed jsonl 构建 hotword bundle（hotwords.jsonl + confusions.jsonl + sqlite）
 *
 * 迁移规则（与 Recover_V2_Additional_Critical_Decisions）：
 * - term === replacement → hotword
 * - term !== replacement → confusion(observed=term → hotword_id)
 * - replacement 为空 → 跳过
 * - 同 word 去重，frequency 取 max
 *
 * 用法：
 *   node scripts/build-lexicon-bundle.mjs
 *   SEED_PATH=... BUNDLE_TAG=staging node scripts/build-lexicon-bundle.mjs
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
const BUNDLE_TAG = process.env.BUNDLE_TAG?.trim() || 'staging-from-seed-v1';
const SEED_PATH = process.env.SEED_PATH?.trim() || DEFAULT_SEED;

function frequencyFromPriority(priority) {
  const p = Number(priority) || 5;
  if (p >= 10) return 100;
  if (p >= 5) return 50;
  return 10;
}

function slugId(prefix, word) {
  return `${prefix}-${Buffer.from(word, 'utf8').toString('hex').slice(0, 12)}`;
}

function normalizePinyin(raw) {
  if (!raw?.trim()) return '';
  return raw.trim().toLowerCase();
}

function isValidHotwordWord(word) {
  if (!word || word.length < 1 || word.length > MAX_WORD_LEN) return false;
  return true;
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
    } catch (e) {
      console.warn('Skip invalid jsonl line:', line.slice(0, 80));
    }
  }
  return rows;
}

function migrateSeed(rows) {
  /** @type {Map<string, {id:string,word:string,pinyin:string,frequency:number,domain:string,enabled:number}>} */
  const hotwordsByWord = new Map();
  /** @type {Array<{id:string,observed:string,hotword_id:string,pinyin:string|null,source:string,enabled:number}>} */
  const confusions = [];
  const warnings = [];

  for (const row of rows) {
    if (row.enabled === 0 || row.enabled === false) continue;

    const term = (row.term ?? '').trim();
    const replacement = (row.replacement ?? '').trim();
    const pinyin = normalizePinyin(row.pinyin);
    const source = row.source ?? 'seed';
    const freq = frequencyFromPriority(row.priority);

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
      const existing = hotwordsByWord.get(term);
      const id = existing?.id ?? row.id ?? slugId('hw', term);
      hotwordsByWord.set(term, {
        id,
        word: term,
        pinyin,
        frequency: Math.max(existing?.frequency ?? 0, freq),
        domain: 'asr',
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

  // 确保 confusion 的 replacement 均有 hotword
  for (const cf of confusions) {
    if (hotwordsByWord.has(cf.replacement)) continue;
    const pinyin = cf.pinyin;
    if (!pinyin) {
      warnings.push(`confusion without hotword/pinyin: ${cf.observed} -> ${cf.replacement}`);
      continue;
    }
    if (!isValidHotwordWord(cf.replacement)) continue;
    hotwordsByWord.set(cf.replacement, {
      id: slugId('hw', cf.replacement),
      word: cf.replacement,
      pinyin,
      frequency: 50,
      domain: 'asr',
      enabled: 1,
    });
  }

  const hotwordIdByWord = new Map();
  for (const hw of hotwordsByWord.values()) {
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
    hotwords: [...hotwordsByWord.values()],
    confusions: resolvedConfusions,
    warnings,
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
    } catch (_) {
      /* ignore */
    }
  }

  const db = new Database(tmpPath);
  db.exec(`
CREATE TABLE lexicon_terms (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  domain TEXT,
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
    `INSERT INTO lexicon_terms (id, word, pinyin, frequency, domain, enabled)
     VALUES (@id, @word, @pinyin, @frequency, @domain, @enabled)`
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
  const { hotwords, confusions, warnings } = migrateSeed(rows);

  if (!hotwords.length) {
    throw new Error('No hotwords after migration');
  }

  writeJsonl(
    HOTWORDS_JSONL,
    hotwords.map((h) => ({
      id: h.id,
      word: h.word,
      pinyin: h.pinyin,
      frequency: h.frequency,
      domain: h.domain,
      enabled: h.enabled,
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
  const manifest = {
    version: 'recover-v2-hotword-seed-v1',
    checksum,
    createdAt: new Date().toISOString(),
    backend: 'sqlite',
    bundle_tag: BUNDLE_TAG,
    hotword_count: hotwords.length,
    confusion_count: confusions.length,
    seed_path: path.relative(repoRoot, SEED_PATH),
  };
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(bundleDir, 'checksum.txt'), checksum);

  console.log('[build-lexicon-bundle] hotwords.jsonl →', HOTWORDS_JSONL);
  console.log('[build-lexicon-bundle] confusions.jsonl →', CONFUSIONS_JSONL);
  console.log('[build-lexicon-bundle] sqlite →', sqlitePath);
  console.log(`  hotwords=${hotwords.length} confusions=${confusions.length}`);
  if (warnings.length) {
    console.log(`  warnings=${warnings.length} (first 5):`);
    warnings.slice(0, 5).forEach((w) => console.log('   ', w));
  }
}

main();
