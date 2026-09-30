#!/usr/bin/env node
/** READ-ONLY SSOT audit probes — homophone pairs + d160 paths */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../..');
const DIST = path.join(ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const OUT_SC = path.join(ROOT, 'docs/user_correction/model3/single_char_recall_contract_evidence.csv');
const OUT_MP = path.join(ROOT, 'docs/user_correction/model3/multipath_consumer_contract_evidence.csv');

function stubElectron() {
  try {
    const p = require.resolve('electron');
    require.cache[p] = { id: p, filename: p, loaded: true, exports: { app: { getPath: () => ROOT } } };
  } catch (_) {}
}
stubElectron();

const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const { compareSegmentationPathBestFirst } = require(path.join(DIST, 'fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.js'));

const runtime = new LexiconRuntimeV2();
runtime.loadFromBundleDir(path.join(ROOT, 'node_runtime/lexicon/v3'));
const profile = defaultGeneralProfile();

function tonePat(t) {
  return textToToneSyllables(t).map((s) => Number((String(s).match(/([1-5])$/) || [])[1] || 1));
}
function exists(term) {
  const syl = textToSyllables(term);
  if (!syl.length) return false;
  const key = syllablesKey(syl);
  const b = runtime.lookupBaseByExactSurfaceAndPinyin(key, term, syl.length);
  return b.some((h) => h.word === term);
}
function recallWords(src, dom = []) {
  const syl = textToSyllables(src);
  const out = recallSpanTopKV2(runtime, {
    syllables: syl, windowText: src, termLength: 1, topK: 8, profile,
    domainIds: dom, perSpanLimit: 8, acousticTonePattern: tonePat(src),
  });
  return out.hits.map((h) => h.hotword.word);
}

// Representative same-pinyin same-tone pairs from lexicon TSV groups
const PAIRS = [
  { source: '成', target: '城', note: 'd019' },
  { source: '他', target: '她', note: 'ta1 homophone' },
  { source: '他', target: '它', note: 'ta1 homophone' },
  { source: '在', target: '再', note: 'zai4 homophone' },
  { source: '做', target: '作', note: 'zuo4 homophone' },
  { source: '账', target: '帐', note: 'zhang4 homophone' },
  { source: '背', target: '杯', note: 'd002 negative control bei4/bei1' },
  { source: '向', target: '项', note: 'xiang4 homophone probe' },
  { source: '木', target: '目', note: 'mu4 homophone probe' },
  { source: '李', target: '里', note: 'li3 homophone probe' },
];

const scRows = [['pairId,sourceChar,targetChar,sourcePinyin,targetPinyin,sourceTone,targetTone,sourceExists,targetExists,recallSourceResult,targetReturned,systematicSurfaceExact,notes']];
for (const p of PAIRS) {
  const sp = textToSyllables(p.source).join('|');
  const tp = textToSyllables(p.target).join('|');
  const st = textToToneSyllables(p.source).join('|');
  const tt = textToToneSyllables(p.target).join('|');
  const hits = recallWords(p.source);
  const targetRet = hits.includes(p.target) ? 'YES' : 'NO';
  const sameTone = st === tt;
  scRows.push([
    p.note, p.source, p.target, sp, tp, st, tt,
    exists(p.source), exists(p.target),
    hits.join(';') || '(empty)', targetRet,
    targetRet === 'NO' && sameTone && exists(p.target) ? 'YES' : 'NO',
    p.note,
  ].join(','));
}

// d160 + six multipath cases from controlled CSV
const MULTI = [
  { id: 'd179', region: '限计划意境全任', pathCount: 2, selected: '限|计|划|意|境|全|任', reachable: 'YES' },
  { id: 'd142', region: '药师堵车您提', pathCount: 2, selected: '药师|堵|车|您|提', reachable: 'YES' },
  { id: 'd099', region: '苏和步', pathCount: 2, selected: '苏|和|步', reachable: 'NO' },
  { id: 'd131', region: '意识规则要是', pathCount: 2, selected: '意识|规|则|要是', reachable: 'NO' },
  { id: 'd160', region: '顺便向木李', pathCount: 4, selected: '顺|便|向|木|李', reachable: 'NO' },
  { id: 'd176', region: '意识规则要是', pathCount: 2, selected: '意识|规|则|要是', reachable: 'NO' },
];

const mpRows = [['caseId,regionText,generatedPathCount,retrySelectedPath,normalMainlineWouldConsumeAllPaths,retryConsumesPathCount,semanticDifference,notes']];
for (const c of MULTI) {
  const altNote = c.id === 'd160'
    ? '4 regional paths enumerated; 2-char lexical edges exist; best-first selects all-single-char path; 项目 needs 2-char 向木 window not on selected path'
    : '';
  mpRows.push([
    c.id, c.region, c.pathCount, c.selected,
    'ALL_RETAINED_PATHS', '1_BEST_PATH_ONLY',
    'YES', altNote,
  ].join(','));
}

// d160 path ranking simulation (read-only): if paths existed as boundary keys from controlled data
const d160Paths = [
  { boundaryKey: '0|1|2|3|4|5', surfaces: ['顺','便','向','木','李'], lex2: 0 },
  { boundaryKey: '0|2|3|4|5', surfaces: ['顺便','向','木','李'], lex2: 1 },
  { boundaryKey: '0|1|2|4|5', surfaces: ['顺','便','向木','李'], lex2: 1 },
  { boundaryKey: '0|2|4|5', surfaces: ['顺便','向木','李'], lex2: 2 },
];
// Simulate compare on mock paths with lexicalEdgeCount
const mockPaths = d160Paths.map((p, i) => ({
  boundaryKey: p.boundaryKey,
  positions: p.surfaces.length,
  lexicalEdgeCount: p.lex2,
  fallbackEdgeCount: p.surfaces.length - p.lex2,
  fuzzyEdgeCount: 0,
  exactEdgeCount: p.lex2,
}));
const sorted = [...mockPaths].sort(compareSegmentationPathBestFirst);
mpRows.push('');
mpRows.push('d160_path_rank_simulation,boundaryKey,surfaces,lex2Edges,rankAfterBestFirst');
d160Paths.forEach((p, i) => {
  const rank = sorted.findIndex((m) => m.boundaryKey === p.boundaryKey) + 1;
  mpRows.push(`d160,${p.boundaryKey},${p.surfaces.join('|')},${p.lex2},rank=${rank}`);
});

fs.writeFileSync(OUT_SC, scRows.join('\n'));
fs.writeFileSync(OUT_MP, mpRows.join('\n'));
runtime.close?.();
console.log('wrote', OUT_SC, OUT_MP);
