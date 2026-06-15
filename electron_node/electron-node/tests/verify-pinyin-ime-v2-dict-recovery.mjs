/**
 * Pinyin-IME-V2 dictionary export recovery verification (one-shot).
 * Usage: PROJECT_ROOT=... node tests/verify-pinyin-ime-v2-dict-recovery.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const repoRoot = process.env.PROJECT_ROOT?.trim() || path.resolve(process.cwd(), '../..');
process.env.PROJECT_ROOT = repoRoot;

const dictDir = path.join(repoRoot, 'node_runtime', 'pinyin-ime-v2', 'dict');

function countDataLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return { missing: true };
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const data = lines.filter((l) => l.trim() && !l.startsWith('#'));
  return { lines: data.length, bytes: fs.statSync(filePath).size };
}

const layers = {
  base_dictionary: countDataLines(path.join(dictDir, 'base_dictionary.txt')),
  domain_dictionary: countDataLines(path.join(dictDir, 'domain_dictionary.txt')),
  target_dictionary: countDataLines(path.join(dictDir, 'target_dictionary.txt')),
  export_manifest: fs.existsSync(path.join(dictDir, 'export_manifest.json')),
  routing_boost: fs.existsSync(path.join(dictDir, 'routing_boost.json')),
};

const singleCharPath = path.join(repoRoot, 'docs', 'pinyin-v2', 'import', 'single_char_dictionary.tsv');
const singleCharInDictDir = path.join(dictDir, 'single_char_dictionary.tsv');

const distRoot = path.join(process.cwd(), 'dist', 'main', 'electron-node', 'main', 'src', 'fw-detector', 'pinyin-ime-v2');

let loadResult = null;
let spanResult = null;
let loadError = null;

try {
  const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(path.join(
    distRoot,
    'pinyin-ime-v2-dict-load.js'
  ));
  const { runPinyinImeV2SpanProposal } = require(path.join(
    distRoot,
    'run-pinyin-ime-v2-span-proposal.js'
  ));

  const resolvedDir = resolvePinyinImeV2DictDir('node_runtime/pinyin-ime-v2/dict');
  const t0 = Date.now();
  const dict = loadPinyinImeV2Dictionaries(resolvedDir);
  const loadMs = Date.now() - t0;

  const targetKeys = new Set();
  for (const line of fs.readFileSync(path.join(resolvedDir, 'target_dictionary.txt'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const p = t.split('\t');
    if (p.length >= 4) targetKeys.add(`${p[1]}\t${p[3]}`);
  }

  let singleCharRows = 0;
  if (fs.existsSync(singleCharPath)) {
    singleCharRows = fs
      .readFileSync(singleCharPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#') && l.split('\t')[0] !== 'dictionary_type').length;
  }

  loadResult = {
    resolvedDir,
    loadMs,
    mergedEntryCount: dict.entries.length,
    byFirstBucketCount: dict.byFirst.size,
    fallbackEntryCount: [...dict.byFirstFallback.values()].reduce((n, arr) => n + arr.length, 0),
    singleCharLoaded: dict.singleCharLoaded,
    singleCharRows,
    singleCharPath: fs.existsSync(singleCharPath) ? singleCharPath : null,
    singleCharInDictDir: fs.existsSync(singleCharInDictDir),
  };

  const proposal = runPinyinImeV2SpanProposal({
    rawAsrText: '你号世界',
    dict,
    config: { topK: 5 },
  });

  loadResult.proposalSample = {
    rawAsrText: '你号世界',
    candidateCount: proposal.diagnostics.candidateCount,
    top1: proposal.candidates[0]?.text ?? null,
    decodeMs: proposal.diagnostics.decode.decodeMs,
  };

  spanResult = {
    candidateCount: proposal.diagnostics.candidateCount,
    top1: proposal.candidates[0]?.text ?? null,
    decodeMs: proposal.diagnostics.decode.decodeMs,
    note: 'V4 mainline uses span proposal / coarse boundaries; resolvePinyinImeV2Spans retired',
  };
} catch (err) {
  loadError = err instanceof Error ? err.message : String(err);
}

const sqlitePath = path.join(repoRoot, 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');

console.log(
  JSON.stringify(
    {
      repoRoot,
      sqlite: {
        exists: fs.existsSync(sqlitePath),
        bytes: fs.existsSync(sqlitePath) ? fs.statSync(sqlitePath).size : 0,
      },
      exportLayers: layers,
      loadVerification: loadResult,
      loadError,
      spanVerification: spanResult,
    },
    null,
    2
  )
);
