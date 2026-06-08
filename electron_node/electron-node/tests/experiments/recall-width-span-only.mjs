#!/usr/bin/env node
/** EXPERIMENT ONLY — span-level recall width (no KenLM), all 20 approvedSpan samples */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getPath: (n) =>
          n === 'userData' ? path.join(PROJECT_ROOT, 'electron_node/electron-node/tmp-experiment') : PROJECT_ROOT,
      },
    },
  };
} catch (_) {}

const { recallSpanTopK } = require('../../dist/main/electron-node/main/src/lexicon/local-span-recall.js');
const { ensureLexiconRuntimeV2Loaded } = require('../../dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2-holder.js');
const { defaultGeneralProfile } = require('../../dist/main/electron-node/main/src/lexicon-v2/profile-registry.js');

const GROUPS = {
  A_baseline: { one: 8, two: 4, many: 2 },
  B_medium: { one: 12, two: 6, many: 3 },
  C_wide: { one: 16, two: 8, many: 4 },
  D_very_wide: { one: 24, two: 12, many: 6 },
};
const MIN_PRIOR = 0.5;
const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];

function limit(n, g) {
  const x = GROUPS[g];
  return n <= 1 ? x.one : n === 2 ? x.two : x.many;
}

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function isRefCorrect(spanText, word, ref) {
  const w = norm(word);
  const s = norm(spanText);
  if (!w || w === s || w.length !== s.length) return false;
  return norm(ref).includes(w);
}

function main() {
  ensureLexiconRuntimeV2Loaded();
  const profile = defaultGeneralProfile();
  const perf = JSON.parse(fs.readFileSync(path.join(__dirname, '../fw-detector-dialog-200-phase4e-quality-perf.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json'), 'utf8'));
  const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
  const cases = (perf.samples?.approvedSpan || []).filter((c) => (c.approvedSpanCount || 0) > 0);

  const out = { experimentOnly: true, groups: {} };
  for (const g of Object.keys(GROUPS)) {
    let spans = 0;
    let cands = 0;
    const rank = { top1: 0, top2: 0, top4: 0, top8: 0, notFound: 0, analyzed: 0 };
    for (const c of cases) {
      const ref = refById[c.id] || '';
      const n = (c.spans || []).length;
      const lim = limit(n, g);
      for (const s of c.spans || []) {
        rank.analyzed += 1;
        const recall = recallSpanTopK(s.text, profile, lim, MIN_PRIOR, DOMAINS, { perSpanLimit: lim });
        const hits = recall.hits.filter((h) => h.word !== s.text);
        spans += 1;
        cands += hits.length;
        let found = false;
        hits.forEach((h, i) => {
          if (isRefCorrect(s.text, h.word, ref)) {
            found = true;
            const r = i + 1;
            if (r <= 1) rank.top1 += 1;
            if (r <= 2) rank.top2 += 1;
            if (r <= 4) rank.top4 += 1;
            if (r <= 8) rank.top8 += 1;
          }
        });
        if (!found) rank.notFound += 1;
      }
    }
    out.groups[g] = {
      spanCount: spans,
      recallCandidateCount: cands,
      avgPerSpan: spans ? cands / spans : 0,
      rankStats: rank,
    };
  }
  const p = path.join(__dirname, 'recall-width-span-only-results.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main();
