#!/usr/bin/env node
/** READ ONLY reconcile candidate vs production + content hash A/B. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { computeBundleContentHash } from '../../../electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const root = path.join(repo, 'electron_node/electron-node');
const require = createRequire(path.join(root, 'package.json'));
const Database = require('better-sqlite3');
const outDir = path.join(__dirname, 'repro_rebuild_audit');
fs.mkdirSync(outDir, { recursive: true });

const prod = path.join(repo, 'node_runtime/lexicon/v3/lexicon.sqlite');
const cand = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate/lexicon.sqlite');
const candB = path.join(repo, 'node_runtime/lexicon/_rebuild_candidate_b/lexicon.sqlite');

function tableKeys(db, sql) {
  return new Set(db.prepare(sql).all().map((r) => Object.values(r).join('\t')));
}

function diffSets(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA: onlyA.slice(0, 30), onlyB: onlyB.slice(0, 30), onlyACount: onlyA.length, onlyBCount: onlyB.length };
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

const dbP = new Database(prod, { readonly: true });
const dbC = new Database(cand, { readonly: true });

const tables = [
  'term',
  'base_lexicon',
  'domain_lexicon',
  'term_domain_tags',
  'idiom_lexicon',
  'industry_routing_lexicon',
  'domain_hierarchy',
];

const tableDiff = {};
for (const t of tables) {
  tableDiff[t] = { old: count(dbP, t), new: count(dbC, t) };
}

const termKey = (r) => `${r.id}\t${r.word}\t${r.pinyin_key}\t${r.tone_pinyin_key || ''}\t${r.source || ''}`;
const prodTerms = dbP.prepare(`SELECT id,word,pinyin_key,tone_pinyin_key,source FROM term`).all();
const candTerms = dbC.prepare(`SELECT id,word,pinyin_key,tone_pinyin_key,source FROM term`).all();
const prodByWord = new Map(prodTerms.map((t) => [t.word, t]));
const candByWord = new Map(candTerms.map((t) => [t.word, t]));

let idSame = 0;
let idChanged = 0;
const idChanges = [];
for (const [w, pt] of prodByWord) {
  const ct = candByWord.get(w);
  if (!ct) continue;
  if (pt.id === ct.id) idSame += 1;
  else {
    idChanged += 1;
    if (idChanges.length < 40) idChanges.push({ word: w, old: pt.id, new: ct.id });
  }
}

const termSetDiff = diffSets(
  tableKeys(dbP, `SELECT id || '\t' || word FROM term`),
  tableKeys(dbC, `SELECT id || '\t' || word FROM term`)
);
const tagSetDiff = diffSets(
  tableKeys(dbP, `SELECT term_id || '\t' || domain_id || '\t' || weight FROM term_domain_tags`),
  tableKeys(dbC, `SELECT term_id || '\t' || domain_id || '\t' || weight FROM term_domain_tags`)
);
const hierDiff = diffSets(
  tableKeys(dbP, `SELECT parent_domain_id || '\t' || child_domain_id FROM domain_hierarchy`),
  tableKeys(dbC, `SELECT parent_domain_id || '\t' || child_domain_id FROM domain_hierarchy`)
);
const idiomDiff = diffSets(
  tableKeys(dbP, `SELECT id || '\t' || word FROM idiom_lexicon`),
  tableKeys(dbC, `SELECT id || '\t' || word FROM idiom_lexicon`)
);

const keySurfaces = ['上线计划', '接口文档', '候选', '计划', '蓝莓马芬', '医师', '登机'];
const keyPresence = {};
for (const w of keySurfaces) {
  keyPresence[w] = {
    prod: !!prodByWord.get(w),
    cand: !!candByWord.get(w),
    prodId: prodByWord.get(w)?.id,
    candId: candByWord.get(w)?.id,
  };
}

const hashP = computeBundleContentHash(Database, prod);
const hashC = computeBundleContentHash(Database, cand);
let hashB = null;
if (fs.existsSync(candB)) {
  hashB = computeBundleContentHash(Database, candB);
}

const summary = {
  tableDiff,
  termId: { idSame, idChanged, idChanges },
  termSetDiff,
  tagSetDiff,
  hierDiff,
  idiomDiff,
  keyPresence,
  contentHash: { production: hashP, candidate: hashC, candidateB: hashB, aEqualsB: hashB != null ? hashC === hashB : null, candEqualsProd: hashC === hashP },
  compositesStillPresent: {
    上线计划: keyPresence['上线计划'],
    接口文档: keyPresence['接口文档'],
  },
};

fs.writeFileSync(path.join(outDir, 'reconcile.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
dbP.close();
dbC.close();
