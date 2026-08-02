/**
 * Post-Atomicity Exact Recall + static gates probe.
 * Loads node_runtime/lexicon/v3 (promoted Full Rebuild bundle).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '../../..');
const electronRoot = path.join(repo, 'electron_node/electron-node');
const dist = path.join(electronRoot, 'dist/main/electron-node/main/src');
const outDir = path.join(__dirname, 'post_atomicity_exact_recall');
fs.mkdirSync(outDir, { recursive: true });

process.chdir(electronRoot);
process.env.PROJECT_ROOT = repo;
const require = createRequire(path.join(electronRoot, 'package.json'));
const Database = require('better-sqlite3');

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { recallSpanTopKV2 } = require(path.join(dist, 'lexicon-v2/recall-span-topk-v2.js'));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));

const bundleDir = path.resolve(repo, process.env.LEXICON_BUNDLE || 'node_runtime/lexicon/v3');
const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json'), 'utf8'));
const contentHashPath = path.join(bundleDir, 'content.sha256');
const contentHash = fs.existsSync(contentHashPath)
  ? fs.readFileSync(contentHashPath, 'utf8').trim()
  : manifest.contentHash || '';

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((r) => r.name);

function termCount(word) {
  return db.prepare(`SELECT COUNT(*) AS n FROM term WHERE word = ? AND enabled = 1`).get(word).n;
}

function termRow(word) {
  return db
    .prepare(
      `SELECT id, word, pinyin_key, tone_pinyin_key, source FROM term WHERE word = ? AND enabled = 1 LIMIT 1`
    )
    .get(word);
}

const CHECK_WORDS = [
  { word: '休息', expectFormal: true },
  { word: '策略', expectFormal: true },
  { word: '神经网络', expectFormal: true },
  { word: '单元测试', expectFormal: true },
  { word: '迷你吧', expectFormal: true },
  { word: '训练', expectFormal: true },
  { word: '会议', expectFormal: true },
  { word: '上线', expectFormal: true },
  { word: '计划', expectFormal: true },
  { word: '接口', expectFormal: true },
  { word: '文档', expectFormal: true },
  { word: '上线计划', expectFormal: false },
  { word: '接口文档', expectFormal: false },
  { word: '专家系统', expectFormal: false },
  { word: '邀请函', expectFormal: false },
];

const fw = loadFwDetectorRuntimeConfig();
const rt = new LexiconRuntimeV2();
const load = rt.loadFromBundleDir(bundleDir);
if (load.status !== 'ok') throw new Error(`load fail: ${JSON.stringify(load)}`);
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

function exactRecall(word) {
  const row = termRow(word);
  if (!row) return { hit: false, reason: 'NO_TERM' };
  const syllables = String(row.pinyin_key).split('|').filter(Boolean);
  const tones = String(row.tone_pinyin_key || '')
    .split('|')
    .filter(Boolean);
  const acousticTonePattern =
    tones.length === syllables.length ? tones.map((t) => Number(String(t).replace(/\D/g, '')) || 0) : undefined;
  const res = recallSpanTopKV2(rt, {
    syllables,
    windowText: word,
    topK: 8,
    domainIds,
    acousticTonePattern,
    toneCallerEnabled: Boolean(acousticTonePattern),
  });
  const hits = res?.hits || [];
  const hit = hits.some((h) => {
    const w = h?.hotword?.word || h?.word || h?.surface || h?.text;
    return w === word;
  });
  return {
    hit,
    termId: row.id,
    pinyin_key: row.pinyin_key,
    tone_pinyin_key: row.tone_pinyin_key,
    candidateCount: hits.length,
    topWords: hits.slice(0, 5).map((h) => h?.hotword?.word || h?.word || h?.surface || h?.text),
  };
}

const rows = [];
for (const item of CHECK_WORDS) {
  const n = termCount(item.word);
  const formalOk = item.expectFormal ? n > 0 : n === 0;
  let recall = null;
  if (item.expectFormal) {
    recall = exactRecall(item.word);
  }
  const recallOk = item.expectFormal ? recall?.hit === true : true;
  rows.push({
    word: item.word,
    expectFormal: item.expectFormal,
    formalCount: n,
    formalOk,
    recallHit: recall?.hit ?? null,
    recallOk,
    ...recall,
    pass: formalOk && recallOk,
  });
}

const atomicity = manifest.atomicity || {};
const summary = atomicity.summary || {};
const staticGates = {
  atomicityMode: atomicity.mode || manifest.atomicity?.mode,
  REJECT_COMPOSITE: summary.REJECT_COMPOSITE ?? null,
  UNRESOLVED: summary.UNRESOLVED ?? null,
  ACCEPT_EXCEPTION: summary.ACCEPT_EXCEPTION ?? null,
  term_pinyin_ngrams_absent: !tables.includes('term_pinyin_ngrams'),
  parent_fragment_absent: !tables.some((t) => /parent_fragment/i.test(t)),
  contentHash,
  checksum: String(manifest.checksum || '').replace(/^sha256:/, ''),
  bundleVersion: manifest.bundleVersion,
  loadStatus: load.status,
};

const allPass = rows.every((r) => r.pass) &&
  staticGates.REJECT_COMPOSITE === 0 &&
  staticGates.UNRESOLVED === 0 &&
  staticGates.term_pinyin_ngrams_absent &&
  staticGates.parent_fragment_absent &&
  (staticGates.atomicityMode === 'enforce' || summary.ACCEPT !== undefined);

const out = { generatedAt: new Date().toISOString(), bundleDir, staticGates, rows, allPass };
fs.writeFileSync(path.join(outDir, 'exact_recall_summary.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(allPass ? 0 : 2);
