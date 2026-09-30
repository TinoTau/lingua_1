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
const { buildUtteranceSyllableCoordinate } = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"));
const { model3FirstPassCandidateCount, model3PinyinTextDerived } = require(path.join(dist, "model3-runtime/model3-feature-pack.js"));

const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), { enabledDomains: ime.enabledDomains });
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

const texts = [
  "麻烦你帮我看看附近有没有停车位",
  "中关村软件园那边联调已经完成了",
  "请按上线计划执行候选生成流程",
  "可能问一下早餐几点开始我刚才没听太清楚",
];
for (const text of texts) {
  let coord;
  try { coord = buildUtteranceSyllableCoordinate(text); } catch (e) { coord = null; }
  const gen = runLatticeFineSpanGeneration({ rawText: text, runtime: rt, profile, domainIds, minPrior: fw.minPrior, imeConfig: ime, dict });
  if (!gen.ok) { console.log(JSON.stringify({ text, ok:false, code:gen.code, message:gen.message })); continue; }
  const hist = {};
  let empty = 0, nonempty = 0, fallback = 0;
  for (const view of gen.pathFineSpanViews) {
    for (const s of view.pathFineSpans) {
      const n = (s.candidates||[]).length;
      const m = model3FirstPassCandidateCount(s);
      hist[m] = (hist[m]||0)+1;
      if (n===0) empty++; else nonempty++;
      if (s.windowSource==='fallback') fallback++;
    }
  }
  console.log(JSON.stringify({
    text,
    syllableCount: gen.syllableCount,
    coordSyl: coord ? coord.syllables.length : null,
    pinyin: model3PinyinTextDerived(coord ? coord.syllables : []),
    paths: gen.pathFineSpanViews.length,
    lexicalEdgeCount: (gen.lexicalEdges||[]).length,
    edgesAfterFallback: (gen.edgesAfterFallback||[]).length,
    emptySpans: empty,
    nonemptySpans: nonempty,
    fallbackSpans: fallback,
    candHist: hist,
    trace: gen.trace,
  }));
}
