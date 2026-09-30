/**
 * Lexicon V3 SQLite → pinyin-ime-v1 layer files (read-only).
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { computeImeWeight, clampRoutingBoost } from './dict-weight.mjs';
import { V1_HEADER, pinyinKeyToStream, formatV1Row } from './dict-tsv.mjs';
import {
  assertV3Bundle,
  resolveSqlitePath,
  dictLayerPath,
  defaultPinyinImeV1DictDir,
  DICT_LAYER_FILES,
} from './paths.mjs';

function sqlRowToExportRow(row, dictionaryType, domainBoost = 1) {
  const pinyin = pinyinKeyToStream(row.pinyin_key);
  if (!pinyin || !row.word) {
    return null;
  }
  const isAlias = row.is_alias ? 1 : 0;
  const targetBoost = row.repair_target ? 1 : 0;
  const weight = Number(row.prior_score) || 0.5;
  const imeWeight = computeImeWeight({
    prior_score: weight,
    repair_target: targetBoost,
    is_alias: isAlias,
    domainBoost,
  });
  return {
    dictionaryType,
    surface: row.word,
    canonical: row.canonical_word || row.word,
    pinyin,
    tonePinyin: row.tone_pinyin_key || '',
    weight,
    targetBoost,
    domainId: row.domain_id || '',
    isAlias,
    imeWeight,
  };
}

function fetchRows(db, table, whereExtra = '') {
  const domainCol = table === 'domain_lexicon' ? ', domain_id, canonical_word' : ', NULL AS domain_id, NULL AS canonical_word';
  const toneCol = ', tone_pinyin_key';
  return db
    .prepare(
      `SELECT word, pinyin_key, prior_score, repair_target, enabled, is_alias${domainCol}${toneCol}
       FROM ${table}
       WHERE enabled = 1${whereExtra}`
    )
    .all();
}

function writeLayerFile(outPath, dictionaryType, rows, meta) {
  const lines = [
    V1_HEADER,
    `# dictionary_type=${dictionaryType}`,
    `# schemaVersion=${meta.schemaVersion}`,
    `# bundleDir=${meta.bundleDir}`,
  ];
  for (const row of rows) {
    const exp = sqlRowToExportRow(row, dictionaryType, row._domainBoost ?? 1);
    if (exp) {
      lines.push(formatV1Row(exp));
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  return lines.length - 3;
}

export function exportRoutingBoost(db, outPath) {
  const rows = db
    .prepare(
      `SELECT keyword, domain_id, weight FROM industry_routing_lexicon ORDER BY domain_id, keyword`
    )
    .all();
  const routing = rows.map((r) => ({
    keyword: r.keyword,
    domain_id: r.domain_id,
    boost: clampRoutingBoost(r.weight),
  }));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ routing }, null, 2), 'utf8');
  return routing.length;
}

/**
 * @param {'base'|'domain'|'target'|'all'} layer
 */
export function exportPinyinImeV1Layer(bundleDir, layer, dictDir = defaultPinyinImeV1DictDir()) {
  const manifest = assertV3Bundle(bundleDir);
  const db = new Database(resolveSqlitePath(bundleDir), { readonly: true });
  const meta = { schemaVersion: manifest.schemaVersion, bundleDir };
  const summary = { layer, dictDir, schemaVersion: manifest.schemaVersion, files: {} };

  const routingPath = dictLayerPath('routing', dictDir);
  if (layer === 'all' || layer === 'domain') {
    summary.routingCount = exportRoutingBoost(db, routingPath);
    summary.files.routing = routingPath;
  }

  if (layer === 'base' || layer === 'all') {
    const baseRows = [
      ...fetchRows(db, 'base_lexicon', ' AND is_alias = 0 AND length(word) >= 2'),
      ...fetchRows(db, 'idiom_lexicon', ' AND is_alias = 0'),
    ];
    const out = dictLayerPath('base', dictDir);
    summary.baseRowCount = writeLayerFile(out, 'base', baseRows, meta);
    summary.files.base = out;
  }

  if (layer === 'domain' || layer === 'all') {
    const domainRows = fetchRows(db, 'domain_lexicon');
    const out = dictLayerPath('domain', dictDir);
    summary.domainRowCount = writeLayerFile(out, 'domain', domainRows, meta);
    summary.files.domain = out;
  }

  if (layer === 'target' || layer === 'all') {
    const targetRows = [
      ...fetchRows(db, 'base_lexicon', ' AND repair_target = 1'),
      ...fetchRows(db, 'idiom_lexicon', ' AND repair_target = 1'),
      ...fetchRows(db, 'domain_lexicon', ' AND repair_target = 1'),
    ];
    const out = dictLayerPath('target', dictDir);
    summary.targetRowCount = writeLayerFile(out, 'target', targetRows, meta);
    summary.files.target = out;
  }

  db.close();

  if (layer === 'all') {
    const manifestOut = path.join(dictDir, DICT_LAYER_FILES.manifest);
    fs.mkdirSync(dictDir, { recursive: true });
    fs.writeFileSync(
      manifestOut,
      JSON.stringify({ ...summary, exportedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    summary.files.export_manifest = manifestOut;
  }

  return summary;
}
