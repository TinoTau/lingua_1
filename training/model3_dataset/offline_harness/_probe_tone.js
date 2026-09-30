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
const { recallSpanTopKV2 } = require(path.join(dist, "lexicon-v2/recall-span-topk-v2.js"));
const { resolveToneRecallReadiness } = require(path.join(dist, "lexicon-v2/tone-recall-readiness.js"));

const fw = loadFwDetectorRuntimeConfig();
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;

for (const toneCallerEnabled of [false, true]) {
  for (const pattern of [undefined, [1,2,3]]) {
    const r = recallSpanTopKV2(rt, {
      syllables: ["zhong","guan","cun"],
      windowText: "中关村",
      termLength: 3,
      topK: 8,
      perSpanLimit: 8,
      profile,
      domainIds,
      fuzzyRecallEnabled: true,
      acousticTonePattern: pattern,
      toneCallerEnabled,
    });
    const ready = resolveToneRecallReadiness({
      syllables: ["zhong","guan","cun"],
      runtimeSupportsTone: rt.supportsToneFirstRecall(),
      acousticTonePattern: pattern,
      toneCallerEnabled,
    });
    console.log(JSON.stringify({ toneCallerEnabled, pattern, hitN: r.hits.length, words: r.hits.slice(0,3).map(h=>h.hotword.word), readiness: ready }));
  }
}
const r1 = recallSpanTopKV2(rt, {
  syllables: ["zhong"],
  windowText: "中",
  termLength: 1,
  topK: 1,
  perSpanLimit: 1,
  profile,
  domainIds: [],
  fuzzyRecallEnabled: false,
  acousticTonePattern: [1],
  toneCallerEnabled: true,
});
console.log(JSON.stringify({ single: r1.hits.map(h=>h.hotword.word), len1diag: r1.length1Collector }));
