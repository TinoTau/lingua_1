#!/usr/bin/env node
/**
 * Exact Recall + dialog_200 compare: production v3 vs _rebuild_candidate.
 * READ ONLY relative to sources; loads two bundles separately.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const root = path.join(repoRoot, 'electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'repro_rebuild_audit');
const require = createRequire(path.join(root, 'package.json'));

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

if (!fs.existsSync(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'))) {
  console.error('Need npm run build:main first');
  process.exit(1);
}

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
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));

const Database = require('better-sqlite3');
const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();

function loadRuntime(bundleDir) {
  const rt = new LexiconRuntimeV2();
  const st = rt.loadFromBundleDir(bundleDir);
  if (st.status !== 'ok') throw new Error(`load fail ${bundleDir}: ${st.status}`);
  return rt;
}

function toneFromDb(db, word, n) {
  const row =
    db.prepare(`SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1`).get(word) ||
    db.prepare(`SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1`).get(word);
  if (!row?.tone_pinyin_key) return Array.from({ length: n }, () => 1);
  return String(row.tone_pinyin_key)
    .split('|')
    .map((p) => {
      const m = p.match(/([1-5])$/);
      return m ? Number(m[1]) : 1;
    });
}

function exactProbes(rt, db, scopeDomainIds) {
  const list = [
    { word: '候选', syllables: ['hou', 'xuan'] },
    { word: '计划', syllables: ['ji', 'hua'] },
    { word: '蓝莓', syllables: ['lan', 'mei'] },
    { word: '马芬', syllables: ['ma', 'fen'] },
    { word: '蓝莓马芬', syllables: ['lan', 'mei', 'ma', 'fen'] },
    { word: '医师', syllables: ['yi', 'shi'] },
    { word: '登机', syllables: ['deng', 'ji'] },
    { word: '上线计划', syllables: ['shang', 'xian', 'ji', 'hua'] },
    { word: '接口文档', syllables: ['jie', 'kou', 'wen', 'dang'] },
  ];
  return list.map((p) => {
    const pattern = toneFromDb(db, p.word, p.syllables.length);
    const r = recallSpanTopKV2(rt, {
      syllables: p.syllables,
      windowText: p.word,
      termLength: p.syllables.length,
      topK: 3,
      perSpanLimit: 3,
      profile,
      domainIds: scopeDomainIds,
      acousticTonePattern: pattern,
      toneCallerEnabled: true,
    });
    return {
      word: p.word,
      found: r.hits.some((h) => h.hotword.word === p.word),
      top: r.hits.slice(0, 2).map((h) => ({ word: h.hotword.word, id: h.hotword.id, score: h.candidateScore })),
    };
  });
}

function runDialog(rt, cases, scopeDomainIds) {
  let completed = 0;
  let failed = 0;
  let uncovered = 0;
  let kenlm = 0;
  const sentences = [];
  const t0 = performance.now();
  for (const c of cases) {
    try {
      const out = runSpanAssemblyV4Orchestrator({
        rawText: c.text,
        runtime: rt,
        profile,
        recallDomainScope: scopeDomainIds,
        minPrior: fwConfig.minPrior,
        imeConfig,
        dict,
        domainPriors: [],
      });
      completed += 1;
      const lt = out.latticeTrace || {};
      if (lt.coverageStatus && lt.coverageStatus !== 'complete') uncovered += 1;
      const texts = (out.kenlmSentenceCandidates?.combinations || []).map((x) => x.text).filter(Boolean);
      kenlm += texts.length;
      sentences.push({ id: c.id || c.caseId, texts: texts.slice(0, 3), domains: out.metrics?.retainedDomains || out.vote?.retainedDomains });
    } catch (e) {
      failed += 1;
      sentences.push({ id: c.id || c.caseId, error: String(e.message || e) });
    }
  }
  return {
    completed,
    failed,
    uncovered,
    kenlm,
    ms: performance.now() - t0,
    sentences,
  };
}

const prodDir = path.join(repoRoot, 'node_runtime/lexicon/v3');
const candDir = path.join(repoRoot, 'node_runtime/lexicon/_rebuild_candidate');
const prodRt = loadRuntime(prodDir);
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const prodDb = new Database(path.join(prodDir, 'lexicon.sqlite'), { readonly: true });
const candDb = new Database(path.join(candDir, 'lexicon.sqlite'), { readonly: true });

const prodExact = exactProbes(prodRt, prodDb, domainIds);
const cases = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);
const prodDlg = runDialog(prodRt, cases, domainIds);

// Reload candidate after prod run (registry singleton attached to last load).
const candRt = loadRuntime(candDir);
const candExact = exactProbes(candRt, candDb, domainIds);
const candDlg = runDialog(candRt, cases, domainIds);
const exactEqual = JSON.stringify(prodExact) === JSON.stringify(candExact);

let sentenceDiffs = 0;
const diffSamples = [];
for (let i = 0; i < cases.length; i++) {
  const a = JSON.stringify(prodDlg.sentences[i]?.texts || []);
  const b = JSON.stringify(candDlg.sentences[i]?.texts || []);
  if (a !== b) {
    sentenceDiffs += 1;
    if (diffSamples.length < 10) {
      diffSamples.push({
        id: cases[i].id,
        prod: prodDlg.sentences[i]?.texts,
        cand: candDlg.sentences[i]?.texts,
      });
    }
  }
}

const summary = {
  exactEqual,
  prodExact,
  candExact,
  dialog: {
    prod: { completed: prodDlg.completed, failed: prodDlg.failed, uncovered: prodDlg.uncovered, kenlm: prodDlg.kenlm, ms: prodDlg.ms },
    cand: { completed: candDlg.completed, failed: candDlg.failed, uncovered: candDlg.uncovered, kenlm: candDlg.kenlm, ms: candDlg.ms },
    sentenceDiffs,
    diffSamples,
    businessEqual:
      prodDlg.completed === candDlg.completed &&
      prodDlg.failed === candDlg.failed &&
      prodDlg.uncovered === candDlg.uncovered &&
      sentenceDiffs === 0,
  },
  compositesPresent: {
    上线计划: candExact.find((x) => x.word === '上线计划')?.found,
    接口文档: candExact.find((x) => x.word === '接口文档')?.found,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'runtime_compare.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
prodDb.close();
candDb.close();
process.exit(summary.exactEqual && summary.dialog.businessEqual ? 0 : 2);
