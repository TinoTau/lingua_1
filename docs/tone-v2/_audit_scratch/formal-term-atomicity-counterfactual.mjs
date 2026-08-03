#!/usr/bin/env node
/** READ ONLY counterfactual: compound WITH vs atomic-only coverage for key surfaces. */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.join(__dirname, 'formal_term_atomicity_audit');
const root = path.join(repoRoot, 'electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const require = createRequire(path.join(root, 'package.json'));

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));

const runtime = new LexiconRuntimeV2();
const st = runtime.loadFromBundleDir(path.join(repoRoot, 'node_runtime/lexicon/v3'));
if (st.status !== 'ok') {
  console.error(st);
  process.exit(1);
}
const fwConfig = loadFwDetectorRuntimeConfig();
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

function tonesFromKey(toneKey, n) {
  if (!toneKey) return Array.from({ length: n }, () => 1);
  return String(toneKey)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
}

function recallWord(word, syllables, toneKey) {
  const pattern = tonesFromKey(toneKey, syllables.length);
  const r = recallSpanTopKV2(runtime, {
    syllables,
    windowText: word,
    termLength: syllables.length,
    topK: 3,
    perSpanLimit: 3,
    profile,
    domainIds,
    acousticTonePattern: pattern,
    toneCallerEnabled: true,
  });
  return {
    word,
    hitCount: r.hits.length,
    hits: r.hits.map((h) => ({
      word: h.hotword.word,
      id: h.hotword.id,
      domains: h.hotword.domains || [],
      score: h.candidateScore,
    })),
    foundSelf: r.hits.some((h) => h.hotword.word === word),
  };
}

const cases = [
  {
    compound: '上线计划',
    compoundSyl: ['shang', 'xian', 'ji', 'hua'],
    compoundTone: 'shang4|xian4|ji4|hua4',
    atoms: [
      { word: '上线', syl: ['shang', 'xian'], tone: 'shang4|xian4' },
      { word: '计划', syl: ['ji', 'hua'], tone: 'ji4|hua4' },
    ],
  },
  {
    compound: '接口文档',
    compoundSyl: ['jie', 'kou', 'wen', 'dang'],
    compoundTone: 'jie1|kou3|wen2|dang4',
    atoms: [
      { word: '接口', syl: ['jie', 'kou'], tone: 'jie1|kou3' },
      { word: '文档', syl: ['wen', 'dang'], tone: 'wen2|dang4' },
    ],
  },
  {
    compound: '内科医生',
    compoundSyl: ['nei', 'ke', 'yi', 'sheng'],
    compoundTone: 'nei4|ke1|yi1|sheng1',
    atoms: [
      { word: '内科', syl: ['nei', 'ke'], tone: 'nei4|ke1' },
      { word: '医生', syl: ['yi', 'sheng'], tone: 'yi1|sheng1' },
    ],
  },
];

const results = [];
for (const c of cases) {
  const withCompound = recallWord(c.compound, c.compoundSyl, c.compoundTone);
  const atomRecalls = c.atoms.map((a) => recallWord(a.word, a.syl, a.tone));
  const allAtomsExact = atomRecalls.every((a) => a.foundSelf);
  results.push({
    compound: c.compound,
    withCompoundExact: withCompound.foundSelf,
    withCompoundHits: withCompound.hits,
    atoms: atomRecalls,
    withoutCompoundAtomicCoverage: allAtomsExact,
    latticeCoverageClaim:
      allAtomsExact
        ? 'atomic edges can cover syllable ranges [0,2)+[2,4) if windows emit both; Raw/canonical remain fallback; no need for compound term'
        : 'MISSING_ATOM — do not delete until atoms exist',
  });
}

fs.writeFileSync(path.join(outDir, 'atomic_split_counterfactual.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
