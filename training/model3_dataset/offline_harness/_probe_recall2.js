const path = require("path");
const repo = "D:/Programs/github/lingua_1";
const root = path.join(repo, "electron_node/electron-node");
process.chdir(root);
process.env.PROJECT_ROOT = repo;
const dist = path.join(root, "dist/main/electron-node/main/src");
const { LexiconRuntimeV2 } = require(path.join(dist, "lexicon-v2/lexicon-runtime-v2.js"));
const { defaultGeneralProfile } = require(path.join(dist, "lexicon-v2/profile-registry.js"));
const { resolveRecallScope } = require(path.join(dist, "lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, "fw-detector/fw-config.js"));
const { loadPinyinImeV2RuntimeConfig } = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js"));
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const { buildUtteranceSyllableCoordinate } = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"));
const { partitionCoarseSpans } = require(path.join(dist, "fw-detector/span-assembly-shared/coarse-span-partition.js"));
const { buildLexicalWindowQueries } = require(path.join(dist, "fw-detector/span-assembly-v4/build-lexical-window-queries.js"));
const { latticeHardBlockFilter } = require(path.join(dist, "fw-detector/span-assembly-v4/lattice-hard-block-filter.js"));
const { recallTopKForWindows } = require(path.join(dist, "fw-detector/span-assembly-v4/recall-topk-for-windows.js"));
const { recallSpanTopKV2 } = require(path.join(dist, "lexicon-v2/recall-span-topk-v2.js"));

const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), { enabledDomains: ime.enabledDomains });
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
const load = rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
const text = "中关村软件园";
const coordinate = buildUtteranceSyllableCoordinate(text);
const coarse = partitionCoarseSpans({ rawText: text, imeConfig: ime, dict }).coarseSpans;
const windows = buildLexicalWindowQueries({ rawText: text, globalSyllables: coordinate.syllables, coarseSpans: coarse, charSyllableRanges: coordinate.ranges });
const filtered = latticeHardBlockFilter({ windows, rawText: text, coarseSpans: coarse, wordTimeSpans: [] });
const recallable = filtered.filter((w) => !w.blocked);
const recall = recallTopKForWindows({
  rawText: text,
  windows: recallable,
  globalSyllables: [...coordinate.syllables],
  runtime: rt,
  profile,
  domainIds,
  minPrior: fw.minPrior,
  fuzzyRecallEnabled: true,
});
console.log(JSON.stringify({
  loadStatus: load.status,
  domainIds: domainIds.slice(0,5),
  domainN: domainIds.length,
  syl: coordinate.syllables,
  windows: recallable.length,
  candN: (recall.candidates||[]).length,
  sql: recall.physicalSqlStatementCount,
  logical: recall.logicalWindowRecallCount,
  sample: (recall.candidates||[]).slice(0,5).map(c => ({word:c.hotword&&c.hotword.word||c.word, src:c.source, win:c.windowId})),
}));
// direct span recall
try {
  const r = recallSpanTopKV2(rt, {
    syllables: coordinate.syllables.slice(0,3),
    windowText: text.slice(0,3),
    termLength: 3,
    topK: 8,
    perSpanLimit: 8,
    profile,
    domainIds,
    fuzzyRecallEnabled: true,
  });
  console.log(JSON.stringify({ directHits: (r.hits||[]).slice(0,5).map(h => h.hotword&&h.hotword.word), hitN: (r.hits||[]).length }));
} catch (e) {
  console.log(JSON.stringify({ directErr: String(e&&e.message||e) }));
}
