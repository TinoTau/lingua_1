const path=require("path");
const repo="D:/Programs/github/lingua_1";
const root=path.join(repo,"electron_node/electron-node");
process.chdir(root); process.env.PROJECT_ROOT=repo;
const dist=path.join(root,"dist/main/electron-node/main/src");
const {LexiconRuntimeV2}=require(path.join(dist,"lexicon-v2/lexicon-runtime-v2.js"));
const {defaultGeneralProfile}=require(path.join(dist,"lexicon-v2/profile-registry.js"));
const {resolveRecallScope}=require(path.join(dist,"lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const {loadFwDetectorRuntimeConfig}=require(path.join(dist,"fw-detector/fw-config.js"));
const {computeCandidateScore,computeCandidateScoreBreakdown,minCandidateScore}=require(path.join(dist,"lexicon-v2/candidate-score.js"));
const {scorePinyinSimilarity}=require(path.join(dist,"lexicon-v2/score-pinyin-similarity.js"));
const rt=new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo,"node_runtime/lexicon/_rebuild_candidate"));
const fw=loadFwDetectorRuntimeConfig();
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
const syl=["dan","yuan","ce","shi"];
const key=syl.join("|");
const base=rt.lookupBaseByPinyinKey(key,4);
const dom=rt.lookupDomainsByPinyinKeyMulti(domainIds,key,4);
const h=[...base,...(dom||[])].find(x=>x.word==="单元测试");
console.log("entry", JSON.stringify({word:h.word,len:h.word.length,sylLen:syl.length,prior:h.priorScore,enabled:h.enabled,pinyin:h.pinyin,tone:h.tone,repairTarget:h.repairTarget,domains:h.domains,isAlias:h.isAlias},null,2));
const phonetic=scorePinyinSimilarity(syl,h.pinyin);
console.log("phonetic",phonetic,"minScore",minCandidateScore());
for (const kind of ["exact_base","exact_domain_strong","exact_domain_weak"]) {
  try {
    const score=computeCandidateScore({hotword:h,windowSyllables:syl,windowText:"单元测试",phoneticScore:phonetic,recallCandidateKind:kind});
    const bd=computeCandidateScoreBreakdown({hotword:h,windowSyllables:syl,windowText:"单元测试",phoneticScore:phonetic,recallCandidateKind:kind});
    console.log(kind, score, bd);
  } catch(e){ console.log(kind,"ERR",e.message); }
}
// tone keys
const toneHits=rt.lookupBaseByPinyinAndToneKey ? "has" : "no";
console.log("toneAPI", toneHits);
