#!/usr/bin/env node
/**
 * Read-only alias/homophone legality audit — no mutations.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../../../..');

const SQLITE = path.join(REPO, 'node_runtime/lexicon/v3/lexicon.sqlite');
const EXP_PATCH = path.join(__dirname, 'expansion-v1_1/patches/exp-v1_1-p1_5-alias.patch.json');
const DOMAIN_PATCH = path.join(
  REPO,
  'electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/domain_patch_multidomain_v1/entries.jsonl'
);
const CONFUSION_SEED = path.join(REPO, 'electron_node/electron-node/data/lexicon/zh_asr_confusions_seed_high_quality.jsonl');
const OUT = path.join(__dirname, 'alias-homophone-legality-audit-results.json');

const { P1_5_ALIAS_TERMS, P1_TERMS } = require('./expansion-v1_1/terms-manifest.cjs');

const P0_ILLEGAL_EXAMPLES = new Set([
  '少病|少冰', '烧饼|少冰', '大悲|大杯', '小背|小杯', '小悲|小杯', '钟贝|中杯',
  '像蔡|香菜', '生城|生成', '声城|生成', '后选|候选', '计化|计划', '告诉|高速',
  '借口|接口', '截口|接口', '文当|文档', '文當|文档', '蓝美马分|蓝莓马芬',
  '深便|顺便', '身边|顺便', '高诉|高速', '高路|高速', '机厂|机场', '机常|机场',
  '上限|上线', '商线|上线', '少病|少冰',
]);

function classify(alias, canonical) {
  const key = `${alias}|${canonical}`;
  if (P0_ILLEGAL_EXAMPLES.has(key)) {
    return { legality: 'ILLEGAL_ASR_CONFUSION', reason: 'P0 denylist ASR surface' };
  }
  // Trad/simp pairs
  const tradSimp = [
    ['計劃', '计划'], ['計畫', '计划'], ['預訂', '预订'], ['上線', '上线'], ['機場', '机场'],
    ['候選', '候选'], ['鐘貝', '中杯'], ['文當', '文档'],
  ];
  for (const [a, c] of tradSimp) {
    if ((alias === a && canonical === c) || (alias === c && canonical === a)) {
      return { legality: 'LEGAL_TRAD_SIMPLIFIED', reason: '简繁映射' };
    }
  }
  if (alias === '预定' && canonical === '预订') {
    return { legality: 'LEGAL_ENTITY_ALIAS', reason: '同一实体简繁/异体字' };
  }
  if (/^[A-Za-z0-9\s\-]+$/.test(alias) || /^[A-Za-z0-9\s\-]+$/.test(canonical)) {
    return { legality: 'LEGAL_EN_ZH_MAPPING', reason: '中英文' };
  }
  if (alias.length <= 3 && canonical.length <= 3 && /^[\u4e00-\u9fff]+$/.test(alias)) {
    // Same pinyin different tone — check if near homophone
    const asrPatterns = ['病', '悲', '贝', '背', '蔡', '城', '诉', '化', '口', '当', '便', '帖', '铁'];
    if (asrPatterns.some((ch) => alias.includes(ch))) {
      return { legality: 'ILLEGAL_ASR_CONFUSION', reason: 'ASR 近音错字 surface' };
    }
  }
  if (alias === '連調' && canonical === '联调') {
    return { legality: 'LEGAL_TRAD_SIMPLIFIED', reason: '简繁' };
  }
  if (['连调', '联掉'].includes(alias) && canonical === '联调') {
    return { legality: 'ILLEGAL_NEAR_PHONE', reason: '近音 ASR 错词' };
  }
  if (['巧可力', '巧克莉'].includes(alias) && canonical === '巧克力') {
    return { legality: 'ILLEGAL_NEAR_PHONE', reason: '近音 ASR 错词' };
  }
  if (alias === '生陈' && canonical === '生成') {
    return { legality: 'ILLEGAL_ASR_CONFUSION', reason: 'ASR 错字' };
  }
  return { legality: 'AMBIGUOUS_NEEDS_REVIEW', reason: '需人工裁定' };
}

function parseToneKey(s) {
  return (s || '').split('|').map((x) => x.trim()).filter(Boolean);
}

function toneMatch(aliasTone, canonTone) {
  const a = parseToneKey(aliasTone);
  const c = parseToneKey(canonTone);
  if (!a.length || !c.length) return null;
  if (a.length !== c.length) return false;
  return a.every((t, i) => t === c[i]);
}

function collectExpansionAliases() {
  const rows = [];
  for (const t of P1_5_ALIAS_TERMS) {
    for (const a of t.aliases || []) {
      rows.push({ alias: a, canonical: t.word, source: 'terms-manifest.cjs/P1.5', patchId: 'exp-v1_1-p1_5-alias' });
    }
  }
  for (const t of P1_TERMS) {
    for (const a of t.aliases || []) {
      rows.push({ alias: a, canonical: t.word, source: 'terms-manifest.cjs/P1', patchId: 'exp-v1_1-p1-terms' });
    }
  }
  const patch = JSON.parse(fs.readFileSync(EXP_PATCH, 'utf8'));
  for (const op of patch.operations) {
    const aliases = op.entry?.aliases || op.fields?.aliases || [];
    const canonical = op.word || op.entry?.word;
    const tone = op.entry?.tonePinyinKey || op.fields?.tonePinyinKey;
    const pinyin = op.entry?.pinyinKey || op.fields?.pinyinKey;
    for (const a of aliases) {
      if (!rows.some((r) => r.alias === a && r.canonical === canonical)) {
        rows.push({
          alias: a,
          canonical,
          source: 'exp-v1_1-p1_5-alias.patch.json',
          patchId: patch.patchId,
          canonicalTone: tone,
          canonicalPinyin: pinyin,
        });
      }
    }
  }
  return rows;
}

function collectDomainPatchVariants() {
  if (!fs.existsSync(DOMAIN_PATCH)) return [];
  const lines = fs.readFileSync(DOMAIN_PATCH, 'utf8').trim().split('\n');
  return lines.map((line, i) => {
    const row = JSON.parse(line);
    return {
      word: row.word,
      pinyin: row.pinyin,
      tone_pinyin: row.tone_pinyin,
      source: row.source,
      line: i + 1,
      lexiconLayer: row.lexiconLayer,
    };
  });
}

function queryRuntime() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(SQLITE, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);

    const stats = {};
    for (const table of ['domain_lexicon', 'base_lexicon', 'industry_routing_lexicon']) {
      if (!tables.includes(table)) continue;
      const total = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE is_alias = 1`).get().c;
      const rows = db
        .prepare(
          `SELECT word, canonical_word, pinyin_key, tone_pinyin_key, domain_id, source FROM ${table} WHERE is_alias = 1 LIMIT 5000`
        )
        .all();
      stats[table] = { aliasRows: total, sample: rows };
    }
    const ngrams = tables.includes('term_pinyin_ngrams')
      ? db.prepare(`SELECT COUNT(*) AS c FROM term_pinyin_ngrams`).get().c
      : 0;
    db.close();
    return { ok: true, tables, stats, term_pinyin_ngrams: ngrams };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function main() {
  const expansion = collectExpansionAliases();
  const domainVariants = collectDomainPatchVariants();
  const homophoneVariants = domainVariants.filter((r) => r.source?.includes('homophone'));
  const runtime = queryRuntime();

  const legalityRows = expansion.map((r) => {
    const c = classify(r.alias, r.canonical);
    return { ...r, ...c, action: c.legality.startsWith('ILLEGAL') ? 'REMOVE' : c.legality.startsWith('LEGAL') ? 'KEEP' : 'REVIEW' };
  });

  const illegalExpansion = legalityRows.filter((r) => r.legality.startsWith('ILLEGAL'));
  const legalExpansion = legalityRows.filter((r) => r.legality.startsWith('LEGAL'));

  // Domain patch variant legality — standalone ASR words
  const variantTarget = {
    钟贝: '中杯', 大悲: '大杯', 小悲: '小杯', 小碑: '小杯', 忠贝: '中杯', 终杯: '中杯', 达杯: '大杯',
    那铁: '拿铁', 拿帖: '拿铁', 磨卡: '摩卡', 美是: '美式', 没事: '美式', 兰梅: '蓝莓', 兰梅马芬: '蓝莓马芬',
  };
  const domainVariantAudit = homophoneVariants.map((r) => {
    const intended = variantTarget[r.word] || '?';
    const legal = P0_ILLEGAL_EXAMPLES.has(`${r.word}|${intended}`) || intended !== '?';
    return {
      word: r.word,
      intended_canonical: intended,
      source: r.source,
      legal: legal ? 'ILLEGAL_ASR_SURFACE_ROW' : 'REVIEW',
      action: 'REMOVE_FROM_JSONL',
    };
  });

  // Runtime alias classification
  const runtimeIllegal = [];
  const runtimeLegal = [];
  if (runtime.ok) {
    for (const [table, data] of Object.entries(runtime.stats)) {
      for (const row of data.sample) {
        const c = classify(row.word, row.canonical_word || '');
        const entry = { table, ...row, ...c };
        if (c.legality.startsWith('ILLEGAL')) runtimeIllegal.push(entry);
        else if (c.legality.startsWith('LEGAL')) runtimeLegal.push(entry);
      }
    }
  }

  const confusionExists = fs.existsSync(CONFUSION_SEED);
  const confusionCount = confusionExists
    ? fs.readFileSync(CONFUSION_SEED, 'utf8').trim().split('\n').filter(Boolean).length
    : 0;

  const out = {
    meta: { timestamp: new Date().toISOString(), sqlite: SQLITE, sqliteReadable: runtime.ok },
    inventory: {
      expansionAliasPairs: expansion.length,
      domainHomophoneVariantRows: homophoneVariants.length,
      legacyConfusionSeedRows: confusionCount,
      confusionSeedActive: false,
    },
    expansion: {
      total: legalityRows.length,
      illegal: illegalExpansion.length,
      legal: legalExpansion.length,
      ambiguous: legalityRows.filter((r) => r.legality === 'AMBIGUOUS_NEEDS_REVIEW').length,
      illegalList: illegalExpansion,
      legalList: legalExpansion,
    },
    domainPatchVariants: domainVariantAudit,
    runtime: {
      ...runtime,
      illegalSampleCount: runtimeIllegal.length,
      legalSampleCount: runtimeLegal.length,
      illegalSamples: runtimeIllegal.slice(0, 40),
    },
    guardrails: {
      validateSeedRejectsConfusion: true,
      scanPatchGranularity: 'DENY_LIST only — no ASR alias legality',
      termsManifestDenyList: true,
      scanAliasLegality: false,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        expansionIllegal: illegalExpansion.length,
        expansionLegal: legalExpansion.length,
        domainHomophoneRows: homophoneVariants.length,
        runtimeIllegal: runtimeIllegal.length,
        runtimeAliasRows: runtime.ok
          ? Object.fromEntries(Object.entries(runtime.stats).map(([k, v]) => [k, v.aliasRows]))
          : runtime.error,
      },
      null,
      2
    )
  );
}

main();
