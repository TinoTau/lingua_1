/**
 * Lexicon surface-distinct ambiguity pre-scan (read-only).
 * Finds pinyin_key → multiple distinct words; helps build targeted_cases.json.
 *
 * Run under ELECTRON_RUN_AS_NODE from electron-node cwd.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'pre_kenlm_candidate_pool_acceptance');
process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const Database = require(path.join(root, 'node_modules/better-sqlite3'));
const sqlitePath = path.resolve(repoRoot, 'node_runtime/lexicon/v3/lexicon.sqlite');
const db = new Database(sqlitePath, { readonly: true });

function q(sql, params = []) {
  return db.prepare(sql).all(...params);
}

const ambi = q(`
  SELECT pinyin_key AS pk, COUNT(DISTINCT word) AS n, GROUP_CONCAT(DISTINCT word) AS words
  FROM (
    SELECT pinyin_key, word FROM base_lexicon WHERE enabled = 1
    UNION ALL
    SELECT pinyin_key, word FROM domain_lexicon WHERE enabled = 1
    UNION ALL
    SELECT pinyin_key, word FROM idiom_lexicon WHERE enabled = 1
  )
  GROUP BY pinyin_key
  HAVING COUNT(DISTINCT word) >= 2
  ORDER BY n DESC, length(pinyin_key) ASC
  LIMIT 200
`);

const multiDomain = q(`
  SELECT t.word, t.pinyin_key AS pk, COUNT(DISTINCT td.domain_id) AS dn,
         GROUP_CONCAT(DISTINCT td.domain_id) AS domains
  FROM term t
  JOIN term_domain_tags td ON td.term_id = t.id
  GROUP BY t.word, t.pinyin_key
  HAVING COUNT(DISTINCT td.domain_id) >= 2
  ORDER BY dn DESC
  LIMIT 100
`);

// Prefer CJK multi-char terms useful in sentences
function isUseful(wordsCsv) {
  const words = String(wordsCsv || '').split(',');
  return words.some((w) => /[\u4e00-\u9fff]{2,}/.test(w)) && words.length >= 2;
}

const usefulAmbi = ambi.filter((r) => isUseful(r.words)).slice(0, 80);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'lexicon_surface_ambiguity.json'),
  JSON.stringify({ ambiTop: usefulAmbi, multiDomainTop: multiDomain.slice(0, 50), ambiTotal: ambi.length }, null, 2)
);

console.error(`ambi_keys=${ambi.length} useful=${usefulAmbi.length} multiDomainTerms=${multiDomain.length}`);
console.error(JSON.stringify(usefulAmbi.slice(0, 40), null, 2));
db.close();
