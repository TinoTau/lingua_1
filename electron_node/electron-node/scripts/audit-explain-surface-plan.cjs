const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const sqlitePath = path.resolve(__dirname, '../../../node_runtime/lexicon/v3/lexicon.sqlite');
const outDir = path.resolve(
  __dirname,
  '../../../docs/tone-v2/_audit_scratch/lattice_v1_batch1_1b'
);
const db = new Database(sqlitePath, { readonly: true });

const indexes = db
  .prepare(
    `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'base_lexicon'`
  )
  .all();

const ambiguityPlan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT id, word FROM base_lexicon
     WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ?
     ORDER BY prior_score DESC LIMIT ?`
  )
  .all('shi', 1, 8);

const surfacePlan = db
  .prepare(
    `EXPLAIN QUERY PLAN
     SELECT id, word FROM base_lexicon
     WHERE pinyin_key = ? AND word = ? AND enabled = 1 AND length(word) = 1 AND is_alias = 0
     LIMIT 2`
  )
  .all('shi', '是');

const payload = {
  generatedAt: '2026-07-28',
  sqlitePath,
  indexes,
  ambiguityPlan,
  hypotheticalExactSurfacePlan: surfacePlan,
  note: 'Read-only EXPLAIN on operational v3; no schema change',
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'explain_query_plan_surface_vs_ambiguity.json'),
  JSON.stringify(payload, null, 2),
  'utf-8'
);
console.log(JSON.stringify(payload, null, 2));
db.close();
