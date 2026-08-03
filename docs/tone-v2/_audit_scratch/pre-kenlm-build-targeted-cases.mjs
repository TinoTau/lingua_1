/**
 * Build targeted_cases.json from lexicon ambiguity keys that actually
 * produce surface-distinct Recall under production recallTopKForWindows.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'pre_kenlm_candidate_pool_acceptance');
process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { buildLexicalWindowQueries } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-window-queries.js')
);
const { latticeHardBlockFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-hard-block-filter.js')
);
const { buildWordTimeSpans } = require(path.join(dist, 'fw-detector/tone-time-align.js'));
const { isFuzzyPinyinRecallEnabled } = require(
  path.join(dist, 'lexicon-v2/lexicon-fw-recall-config.js')
);
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);

const runtime = new LexiconRuntimeV2();
runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const fuzzyEnabled = isFuzzyPinyinRecallEnabled();

function surfacesFor(text) {
  const coordinate = buildUtteranceSyllableCoordinate(text);
  const partition = partitionCoarseSpans({ rawText: text, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  if (!coarseSpans.length) return [];
  const wordTimeSpans = buildWordTimeSpans(text, [], [], [], []);
  const windows = buildLexicalWindowQueries({
    rawText: text,
    globalSyllables: coordinate.syllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  const filtered = latticeHardBlockFilter({ windows, rawText: text, coarseSpans, wordTimeSpans });
  const recallable = filtered.filter((w) => !w.blocked);
  const recall = recallTopKForWindows({
    rawText: text,
    windows: recallable,
    globalSyllables: [...coordinate.syllables],
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    wordTimeSpans,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled: fwConfig.toneTimestampOnlyEnabled === true,
  });
  const by = new Map();
  for (const c of recall.candidates) {
    const l = by.get(c.windowId) || [];
    l.push(c);
    by.set(c.windowId, l);
  }
  const out = [];
  for (const w of recallable) {
    const cands = by.get(w.windowId) || [];
    const surfaces = [...new Set(cands.map((c) => c.replacement))];
    if (surfaces.length >= 2) {
      out.push({
        windowId: w.windowId,
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        text: w.windowText,
        surfaces,
      });
    }
  }
  return out;
}

const ambi = JSON.parse(fs.readFileSync(path.join(outDir, 'lexicon_surface_ambiguity.json'), 'utf8'))
  .ambiTop;

const singles = [];
for (const row of ambi) {
  const words = String(row.words).split(',').filter((w) => /^[\u4e00-\u9fff]{2,4}$/.test(w));
  for (const w of words.slice(0, 3)) {
    const text = `请确认${w}`;
    const hits = surfacesFor(text);
    if (hits.length) {
      singles.push({ word: w, pk: row.pk, text, hits });
      break;
    }
  }
  if (singles.length >= 40) break;
}

console.error(`single_triggers=${singles.length}`);
console.error(JSON.stringify(singles.slice(0, 15), null, 2));

// build duals from pairs of singles with different pinyin
const duals = [];
for (let i = 0; i < singles.length && duals.length < 15; i++) {
  for (let j = i + 1; j < singles.length && duals.length < 15; j++) {
    if (singles[i].pk === singles[j].pk) continue;
    const text = `请确认${singles[i].word}和${singles[j].word}`;
    const hits = surfacesFor(text);
    // non-overlapping >=2
    const sorted = [...hits].sort((a, b) => a.syllableStart - b.syllableStart);
    const elig = [];
    let end = -1;
    for (const h of sorted) {
      if (h.syllableStart >= end) {
        elig.push(h);
        end = h.syllableEnd;
      }
    }
    if (elig.length >= 2) {
      duals.push({ text, elig, a: singles[i].word, b: singles[j].word });
    }
  }
}
console.error(`dual_triggers=${duals.length}`);

// triples
const triples = [];
for (let i = 0; i < Math.min(singles.length, 12) && triples.length < 10; i++) {
  for (let j = i + 1; j < Math.min(singles.length, 12) && triples.length < 10; j++) {
    for (let k = j + 1; k < Math.min(singles.length, 12) && triples.length < 10; k++) {
      const text = `请确认${singles[i].word}、${singles[j].word}和${singles[k].word}`;
      const hits = surfacesFor(text);
      const sorted = [...hits].sort((a, b) => a.syllableStart - b.syllableStart);
      const elig = [];
      let end = -1;
      for (const h of sorted) {
        if (h.syllableStart >= end) {
          elig.push(h);
          end = h.syllableEnd;
        }
      }
      if (elig.length >= 3) {
        let pot = 1;
        for (const e of elig) pot *= e.surfaces.length;
        triples.push({ text, elig, pot, words: [singles[i].word, singles[j].word, singles[k].word] });
      }
    }
  }
}
console.error(`triple_triggers=${triples.length}`);

const cases = [];
let n = 1;
for (const s of singles.slice(0, 14)) {
  cases.push({
    caseId: `A${String(n).padStart(2, '0')}`,
    group: ['A'],
    text: s.text,
    expectedTerms: [s.word],
    why: `${s.pk} → ${s.hits[0].surfaces.join('/')}`,
    lexiconTerms: s.hits[0].surfaces,
  });
  n += 1;
}
n = 1;
for (const d of duals.slice(0, 10)) {
  cases.push({
    caseId: `B${String(n).padStart(2, '0')}`,
    group: ['B'],
    text: d.text,
    expectedTerms: [d.a, d.b],
    why: `dual surface spans ${d.elig.map((e) => e.surfaces.join('/')).join(' × ')}`,
    lexiconTerms: d.elig.flatMap((e) => e.surfaces),
  });
  n += 1;
}
n = 1;
for (const t of triples.slice(0, 6)) {
  cases.push({
    caseId: `C${String(n).padStart(2, '0')}`,
    group: ['C'],
    text: t.text,
    expectedTerms: t.words,
    why: `triple pot=${t.pot} :: ${t.elig.map((e) => e.surfaces.join('/')).join(' × ')}`,
    lexiconTerms: t.elig.flatMap((e) => e.surfaces),
  });
  n += 1;
}

// Domain / overlap / noise extras from known triggers
const extras = [
  { caseId: 'D01', group: ['D'], text: '请确认少糖去冰大杯', expectedTerms: ['少糖', '去冰', '大杯'], why: 'multi-domain coffee tags' },
  { caseId: 'D02', group: ['D'], text: '我想堂食还是带走', expectedTerms: ['堂食', '带走'], why: 'multi-domain 4 tags' },
  { caseId: 'D03', group: ['D'], text: '前台正在确认预订', expectedTerms: ['前台', '预订'], why: '预订 multi-domain' },
  { caseId: 'E01', group: ['E'], text: '请确认上线计划', expectedTerms: ['上线', '计划'], why: 'overlap windows' },
  { caseId: 'E02', group: ['E'], text: '请检查接口文档', expectedTerms: ['接口', '文档'], why: 'overlap windows' },
  { caseId: 'F01', group: ['F'], text: singles[0]?.text || '请确认地址', expectedTerms: [], why: 'raw-correct keep alternatives' },
  { caseId: 'G01', group: ['G'], text: '请确认客户地址', expectedTerms: ['地址'], why: 'noise di|zhi context' },
  { caseId: 'G02', group: ['G'], text: '请把地质报告发给经理', expectedTerms: ['地质'], why: '地质 context' },
];
for (const e of extras) cases.push(e);

fs.writeFileSync(path.join(outDir, 'targeted_cases.json'), JSON.stringify(cases, null, 2));
fs.writeFileSync(
  path.join(outDir, 'targeted_case_builder_log.json'),
  JSON.stringify({ singles: singles.length, duals: duals.length, triples: triples.length, cases: cases.length, sampleSingles: singles.slice(0, 20), sampleDuals: duals.slice(0, 5), sampleTriples: triples.slice(0, 5) }, null, 2)
);
console.error(`wrote cases=${cases.length}`);
