#!/usr/bin/env node
/**
 * Runtime SSOT Contract V1.1 acceptance (Fine-Span Domain Presence Vote):
 * clean + build:main → Electron ABI smoke → FAIL on native/ABI errors.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '../..');
const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const expectedChecksum =
  'sha256:62e04b3a43dfc1927713df0d4e2b9b735d30a6f682e916c42dab47ceef57b4ef';

function fail(msg) {
  console.error('ACCEPTANCE_FAIL:', msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

console.log('=== Runtime SSOT acceptance: clean + build:main ===');
run('npm', ['run', 'build:main']);

const distPick = path.join(
  root,
  'dist/main/electron-node/main/src/fw-detector/span-assembly-v4/window-candidate-to-pick.js'
);
const distVote = path.join(
  root,
  'dist/main/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.js'
);
const distRecall = path.join(
  root,
  'dist/main/electron-node/main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.js'
);
if (!fs.existsSync(distPick)) fail('dist missing after build');
const pickSrc = fs.readFileSync(distPick, 'utf8');
const voteSrc = fs.readFileSync(distVote, 'utf8');
const recallSrc = fs.readFileSync(distRecall, 'utf8');
if (pickSrc.includes('selectedDomain') || pickSrc.includes('candidateDomains')) {
  fail('dist pick converter contains forbidden decision fields');
}
if (/domainId:\s*pick\.domainId/.test(pickSrc)) {
  fail('dist SpanReplacementPick still carries domainId');
}
if (!voteSrc.includes('DOMAIN_BUCKET_RETENTION_RATIO')) {
  fail('dist vote missing DOMAIN_BUCKET_RETENTION_RATIO');
}
if (/domains\?\.\[0\]|domains\[0\]/.test(recallSrc)) {
  fail('dist recall still projects domains[0]');
}
if (/domainId:\s*domainId/.test(recallSrc) && recallSrc.includes('domains?.[0]')) {
  fail('dist recall still assigns domainId from domains[0]');
}

const checksumTxt = fs.readFileSync(path.join(bundleDir, 'checksum.txt'), 'utf8').trim();
if (checksumTxt !== expectedChecksum) {
  fail(`lexicon checksum mismatch: ${checksumTxt}`);
}
const sqliteBuf = fs.readFileSync(path.join(bundleDir, 'lexicon.sqlite'));
const sqliteHash = 'sha256:' + crypto.createHash('sha256').update(sqliteBuf).digest('hex');
if (sqliteHash !== expectedChecksum) fail(`lexicon.sqlite hash mismatch: ${sqliteHash}`);

const smokePath = path.join(require('os').tmpdir(), `runtime-ssot-smoke-${process.pid}.cjs`);
const smoke = `
const path = require('path');
const crypto = require('crypto');
const root = ${JSON.stringify(root)};
process.chdir(root);
module.paths.unshift(path.join(root, 'node_modules'));
const Database = require('better-sqlite3');
const { LexiconRuntimeV2 } = require(path.join(root, 'dist/main/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.js'));
const { runDomainAwareAssembly } = require(path.join(root, 'dist/main/electron-node/main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.js'));
const { buildSentenceCandidates, mergeCrossBucketSentenceCandidates } = require(path.join(root, 'dist/main/electron-node/main/src/fw-detector/build-sentence-candidates.js'));
const { allocateDomainBucketSentenceBudget } = require(path.join(root, 'dist/main/electron-node/main/src/fw-detector/span-assembly-shared/utterance-domain-vote.js'));
const bundleDir = ${JSON.stringify(bundleDir)};
const expected = ${JSON.stringify(expectedChecksum)};

function die(m) { console.error('SMOKE_FAIL', m); process.exit(2); }
try {
  require('better-sqlite3');
} catch (e) {
  die('better-sqlite3 load: ' + e.message);
}

const db = new Database(path.join(bundleDir, 'lexicon.sqlite'), { readonly: true });
const hash = 'sha256:' + crypto.createHash('sha256').update(require('fs').readFileSync(path.join(bundleDir, 'lexicon.sqlite'))).digest('hex');
if (hash !== expected) die('sqlite hash ' + hash);

const rt = new LexiconRuntimeV2();
const state = rt.loadFromBundleDir(bundleDir);
if (state.status !== 'ok') die('LexiconRuntimeV2 load ' + JSON.stringify(state));
console.log('LOAD_OK', JSON.stringify({ status: state.status }));

const words = ['预订','少糖','中杯','菜单','接送','机场','你好'];
const found = db.prepare('SELECT * FROM term WHERE word IN (' + words.map(()=>'?').join(',') + ')').all(...words);
const traces = [];
for (const t of found) {
  const tags = db.prepare('SELECT domain_id FROM term_domain_tags WHERE term_id = ? ORDER BY domain_id').all(t.id).map(x => x.domain_id);
  const hits = tags.length
    ? rt.lookupDomainsByPinyinKeyMulti(tags, t.pinyin_key, [...t.word].length, 10)
    : rt.lookupBaseByPinyinKey(t.pinyin_key, [...t.word].length, 10);
  const match = hits.find(h => h.word === t.word) || hits[0];
  const domains = (match && match.domains) || [];
  traces.push({ sample: t.word, DB_tags: tags, Hotword_domains: domains, hitCount: hits.length });
  console.log(JSON.stringify(traces[traces.length-1]));
  if (tags.length && domains.length === 0) die('domain recall empty for ' + t.word);
  if (!tags.length && match && (match.domains||[]).length) die('base forged domains for ' + t.word);
}

const byWord = {};
for (const h of [
  ...rt.lookupDomainsByPinyinKeyMulti(['coffee','milk_tea','food_order'], 'shao|tang', 2, 5),
  ...rt.lookupDomainsByPinyinKeyMulti(['coffee','milk_tea','food_order'], 'zhong|bei', 2, 5),
]) { if (!byWord[h.word]) byWord[h.word]=h; }
const rawText = '我要少糖中杯';
const candidates = [];
let idx = 0;
for (const word of ['少糖','中杯']) {
  const h = byWord[word];
  if (!h) die('missing hit ' + word);
  const start = rawText.indexOf(word);
  candidates.push({
    candidateId: 'c'+(idx++), replacement: word, rawStart: start, rawEnd: start+word.length,
    syllableStart: start, syllableEnd: start+2, score: h.priorScore || 1,
    source: 'domain_term', hitKind: 'exact_term', domains: Object.freeze([...(h.domains||[])]),
    repairTarget: true, recallSource: 'lexicon_pinyin_topk', isCovered: false, anchorCoarseSpanId: word === '少糖' ? 'cs0' : 'cs1'
  });
}
const coarseSpans = [
  { id:'cs0', text: '少糖', rawStart:2, rawEnd:4, syllableStart:2, syllableEnd:4 },
  { id:'cs1', text: '中杯', rawStart:4, rawEnd:6, syllableStart:4, syllableEnd:6 },
];
const assembly = runDomainAwareAssembly(candidates, coarseSpans, rawText);
if (!Array.isArray(assembly.vote.retainedDomains)) die('missing retainedDomains');
if (assembly.vote.domainScores && Object.values(assembly.vote.domainScores).some(v => typeof v === 'number' && !Number.isInteger(v))) {
  die('domainScores must be integer span counts');
}
const perBucket = allocateDomainBucketSentenceBudget(assembly.bucketSpanSets.length, 16);
const perBucketGenerated = [];
for (const sets of assembly.bucketSpanSets) {
  const r = buildSentenceCandidates(rawText, sets, 16);
  perBucketGenerated.push(r.combinations);
}
const merged = mergeCrossBucketSentenceCandidates(perBucketGenerated, 16);
const sentences = merged.combinations;
const pick = assembly.spanSets[0] && assembly.spanSets[0][0];
const emptyVote = runDomainAwareAssembly([], coarseSpans, '随便说说天气不错');
console.log(JSON.stringify({
  Vote_primary: assembly.vote.utteranceDomain,
  retainedDomains: assembly.vote.retainedDomains,
  domainScores: assembly.vote.domainScores,
  bucketCount: assembly.bucketSpanSets.length,
  sameDomainCount: assembly.metrics.sameDomainCandidateCount,
  baseCount: assembly.metrics.baseCandidateCount,
  sentenceCount: sentences.length,
  Pick_keys: pick ? Object.keys(pick) : [],
  KenLM_input: sentences.map(c => c.text),
  noEvidenceWinner: emptyVote.vote.utteranceDomain,
  noEvidenceInsufficient: emptyVote.vote.insufficientEvidence,
  noEvidenceBuckets: emptyVote.bucketSpanSets.length
}));
if (pick && (pick.domainId != null || pick.domains || pick.selectedDomain)) die('Pick carries domain metadata');
if (!assembly.vote.utteranceDomain) die('missing vote primary');
if (emptyVote.vote.insufficientEvidence !== true) die('empty evidence should be insufficient');
if (sentences.length > 16) die('sentence candidates exceed 16');
db.close(); rt.close();
console.log('SMOKE_COMPLETE');
process.exit(0);
`;
fs.writeFileSync(smokePath, smoke, 'utf8');
console.log('=== Electron ABI smoke ===');
const er = spawnSync('npx', ['electron', smokePath], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
try { fs.unlinkSync(smokePath); } catch (_) {}
if (er.status !== 0) fail('Electron smoke exited ' + er.status);
console.log('ACCEPTANCE_PASS');
