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
const {
  loadPinyinImeV2Dictionaries,
  resolvePinyinImeV2DictDir,
} = require(path.join(dist, "fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const { runLatticeFineSpanGeneration } = require(path.join(
  dist,
  "fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"
));
const { voteUtteranceDomainFromPool } = require(path.join(
  dist,
  "fw-detector/span-assembly-shared/utterance-domain-vote.js"
));
const { buildUtteranceSyllableCoordinate } = require(path.join(
  dist,
  "fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"
));

const fw = loadFwDetectorRuntimeConfig();
const ime = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir), {
  enabledDomains: ime.enabledDomains,
});
const profile = defaultGeneralProfile();
const rt = new LexiconRuntimeV2();
console.error("load", rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3")));
const domainIds = resolveRecallScope({ configEnabledDomains: fw.enabledDomains }).domainIds;
const text = "麻烦你帮我看看附近有没有停车位";
console.error("coord", (() => { try { const c=buildUtteranceSyllableCoordinate(text); return {n:c.syllables.length, s:c.syllables.slice(0,5)}; } catch(e){ return String(e);} })());
const gen = runLatticeFineSpanGeneration({
  rawText: text,
  runtime: rt,
  profile,
  domainIds,
  minPrior: fw.minPrior,
  imeConfig: ime,
  dict,
});
console.log(
  JSON.stringify({
    ok: gen.ok,
    code: gen.code,
    message: gen.message,
    views: (gen.pathFineSpanViews || []).length,
  })
);
if (gen.ok) {
  const pfs = gen.pathFineSpanViews[0].pathFineSpans;
  console.log(
    JSON.stringify({
      n: pfs.length,
      first: {
        id: pfs[0].spanId,
        rawStart: pfs[0].rawStart,
        rawEnd: pfs[0].rawEnd,
        keys: Object.keys(pfs[0]),
        cand0: pfs[0].candidates && pfs[0].candidates[0] && Object.keys(pfs[0].candidates[0]),
      },
    })
  );
  const pools = pfs.map((s) => ({
    candidates: (s.candidates || []).map((c) => ({
      hitKind: "exact_term",
      source: c.graphSource || c.source || "base_term",
      score: c.score || 0,
      domains: c.domains || [],
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
    })),
  }));
  const vote = voteUtteranceDomainFromPool(pools);
  console.log(JSON.stringify({ retained: vote.retainedDomains, scores: vote.domainScores }));
}
