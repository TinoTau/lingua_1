#!/usr/bin/env node
/** Count mineable 2-5 CJK words from base/common5 not in term table. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';
import { rejectPhraseLike } from '../industry_pack_v1/lib/reject-phrase-like.mjs';

const require = createRequire(import.meta.url);
const db = new (require('better-sqlite3'))(
  path.join(repoRoot(), 'node_runtime/lexicon/v3/lexicon.sqlite'),
  { readonly: true }
);
const existing = new Set(db.prepare('SELECT word FROM term').all().map((r) => r.word));

function cjkLen(w) {
  return [...w].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
}

function scan(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\n/);
  let ok = 0;
  for (const line of lines) {
    const o = JSON.parse(line);
    const w = o.word?.trim();
    if (!w || existing.has(w)) continue;
    if (cjkLen(w) !== w.length || cjkLen(w) < 2 || cjkLen(w) > 5) continue;
    if (rejectPhraseLike(w)) continue;
    ok++;
  }
  return { lines: lines.length, mineable: ok };
}

const asset = path.join(
  repoRoot(),
  'electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2'
);

console.log(
  JSON.stringify(
    {
      existingTerms: existing.size,
      base: scan(path.join(asset, 'base_zh_v2/entries.jsonl')),
      common5: scan(path.join(asset, 'common5_zh_v2/entries.jsonl')),
      idiom: scan(path.join(asset, 'idiom_zh_v2/entries.jsonl')),
    },
    null,
    2
  )
);
db.close();
