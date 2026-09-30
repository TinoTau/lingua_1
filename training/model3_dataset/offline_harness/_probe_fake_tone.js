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
const { runLatticeFineSpanGeneration } = require(path.join(dist, "fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"));
const { model3FirstPassCandidateCount } = require(path.join(dist, "model3-runtime/model3-feature-pack.js"));
const { buildUtteranceSyllableCoordinate } = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"));

const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), { enabledDomains: ime.enabledDomains });
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
const text = "中关村软件园那边联调已经完成了";
const coord = buildUtteranceSyllableCoordinate(text);
// Fake uniform tone=1 pattern matching syllable count — DIAGNOSTIC ONLY, not authorized training contract
const pattern = coord.syllables.map(() => 1);
const gen = runLatticeFineSpanGeneration({
  rawText: text,
  runtime: rt,
  profile,
  domainIds,
  minPrior: fw.minPrior,
  imeConfig: ime,
  dict,
  acousticSlices: pattern.map((tone, i) => ({ startMs: i*100, endMs: i*100+90, tone })),
  wordTimeSpans: coord.ranges.map((r, i) => ({ rawStart: 0, rawEnd: text.length, startMs: i*100, endMs: i*100+90, word: text[i]||"x" })),
  toneTimestampOnlyEnabled: true,
  fuzzyRecallEnabled: true,
});
if (!gen.ok) { console.log(JSON.stringify(gen)); process.exit(0); }
const hist={}; let empty=0, nonempty=0;
for (const view of gen.pathFineSpanViews) {
  for (const s of view.pathFineSpans) {
    const m = model3FirstPassCandidateCount(s);
    hist[m]=(hist[m]||0)+1;
    if ((s.candidates||[]).length) nonempty++; else empty++;
  }
}
console.log(JSON.stringify({ok:true, paths:gen.pathFineSpanViews.length, lexical:(gen.lexicalEdges||[]).length, empty, nonempty, hist, sql:gen.trace&&gen.trace.sqlQueryCount}));
