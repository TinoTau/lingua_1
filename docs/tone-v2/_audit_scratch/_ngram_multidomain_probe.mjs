const { createRequire } = require("module");
const path = require("path");
const root = "d:/Programs/github/lingua_1/electron_node/electron-node";
const dist = path.join(root, "dist/main/electron-node/main/src");
const require2 = createRequire(path.join(root, "package.json"));
process.chdir(root);
process.env.PROJECT_ROOT = "d:/Programs/github/lingua_1";
const { LexiconRuntimeV2 } = require2(path.join(dist, "lexicon-v2/lexicon-runtime-v2.js"));
const { defaultGeneralProfile } = require2(path.join(dist, "lexicon-v2/profile-registry.js"));
const { resolveRecallScope } = require2(path.join(dist, "lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const { loadFwDetectorRuntimeConfig } = require2(path.join(dist, "fw-detector/fw-config.js"));
const { recallSpanTopKV3 } = require2(path.join(dist, "lexicon-v2/recall-span-topkv3.js"));
const runtime = new LexiconRuntimeV2();
const st = runtime.loadFromBundleDir("d:/Programs/github/lingua_1/node_runtime/lexicon/v3");
if (st.status !== "ok") { console.error(st); process.exit(1); }
const fw = loadFwDetectorRuntimeConfig();
const scope = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
const profile = defaultGeneralProfile();
const cases = [
  { word: "预订", syllables: ["yu","ding"] },
  { word: "中杯", syllables: ["zhong","bei"] },
  { word: "发票", syllables: ["fa","piao"] },
  { word: "打包", syllables: ["da","bao"] },
];
const out = [];
for (const c of cases) {
  const r = recallSpanTopKV3({
    runtimeV2: runtime,
    syllables: c.syllables,
    windowText: c.word,
    domainIds: scope,
    profile,
    exactTopK: 2,
    parentFragmentTopK: 3,
    perParentTermPerWindow: 1,
  });
  out.push({
    word: c.word,
    scopeSize: scope.length,
    hits: r.hits.map(h => ({
      hitKind: h.hitKind,
      word: h.hotword.word,
      domains: h.hotword.domains,
      parentTerm: h.parentTerm,
      parentTermId: h.parentTermId,
      source: h.source,
    })),
  });
}
console.log(JSON.stringify(out, null, 2));
