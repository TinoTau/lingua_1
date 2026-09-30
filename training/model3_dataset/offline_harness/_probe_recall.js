const path = require("path");
const repo = "D:/Programs/github/lingua_1";
const root = path.join(repo, "electron_node/electron-node");
process.chdir(root);
process.env.PROJECT_ROOT = repo;
const dist = path.join(root, "dist/main/electron-node/main/src");
const { LexiconRuntimeV2 } = require(path.join(dist, "lexicon-v2/lexicon-runtime-v2.js"));
const { defaultGeneralProfile } = require(path.join(dist, "lexicon-v2/profile-registry.js"));
const { resolveRecallScope } = require(path.join(dist, "lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const { recallSpanTopKV2 } = require(path.join(dist, "lexicon-v2/recall-span-topk-v2.js"));
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, "fw-detector/fw-config.js"));
const { buildUtteranceSyllableCoordinate } = require(path.join(
  dist,
  "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"
));
const fw = loadFwDetectorRuntimeConfig();
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
for (const surface of ["挪", "停车位", "咖啡"]) {
  const coord = buildUtteranceSyllableCoordinate(surface);
  const syllables = coord.syllables;
  const r = recallSpanTopKV2(rt, {
    syllables,
    windowText: surface,
    termLength: syllables.length,
    topK: 8,
    perSpanLimit: 8,
    profile,
    domainIds,
    fuzzyRecallEnabled: true,
    acousticTonePattern: syllables.map(() => 2),
    toneCallerEnabled: true,
  });
  console.log(
    JSON.stringify({
      surface,
      syllables,
      hits: (r.hits || []).map((h) => h.hotword?.word),
    })
  );
}
