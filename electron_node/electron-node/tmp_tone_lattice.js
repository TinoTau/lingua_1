const path=require("path");
const repo="D:/Programs/github/lingua_1";
const root=path.join(repo,"electron_node/electron-node");
process.chdir(root); process.env.PROJECT_ROOT=repo;
const dist=path.join(root,"dist/main/electron-node/main/src");
const Database=require("better-sqlite3");
const {LexiconRuntimeV2}=require(path.join(dist,"lexicon-v2/lexicon-runtime-v2.js"));
const {defaultGeneralProfile}=require(path.join(dist,"lexicon-v2/profile-registry.js"));
const {resolveRecallScope}=require(path.join(dist,"lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const {loadFwDetectorRuntimeConfig}=require(path.join(dist,"fw-detector/fw-config.js"));
const {loadPinyinImeV2RuntimeConfig}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js"));
const {loadPinyinImeV2Dictionaries,resolvePinyinImeV2DictDir}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const {runLatticeFineSpanGeneration}=require(path.join(dist,"fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"));
const {runSpanAssemblyV4Orchestrator}=require(path.join(dist,"fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js"));
const {makeCharToneFixtures}=require(path.join(dist,"fw-detector/span-assembly-v4/test-tone-fixtures.js"));
const candidateDir=path.join(repo,"node_runtime/lexicon/_rebuild_candidate");
const db=new Database(path.join(candidateDir,"lexicon.sqlite"),{readonly:true});
const rt=new LexiconRuntimeV2(); rt.loadFromBundleDir(candidateDir);
const fw=loadFwDetectorRuntimeConfig();
const profile=defaultGeneralProfile();
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
const ime=loadPinyinImeV2RuntimeConfig();
const dict=loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir),{enabledDomains:ime.enabledDomains});
function tonesOf(word){
  const row=db.prepare("SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1").get(word);
  return String(row.tone_pinyin_key).split("|").map(p=>{const m=p.match(/([1-5])$/); const n=m?Number(m[1]):1; return (n>=1&&n<=5)?n:1;});
}
function wrap(runtime, excludeWord){
  return new Proxy(runtime,{get(target,prop){
    const val=Reflect.get(target,prop);
    if(typeof val!=="function") return val;
    if(String(prop).startsWith("lookup")) return function(...args){
      const out=val.apply(target,args);
      if(Array.isArray(out)) return out.filter(h=>String(h&&h.word||"")!==excludeWord);
      return out;
    };
    return function(...args){return val.apply(target,args)};
  }});
}
for (const surface of ["单元测试","神经网络","迷你吧","配置文件"]) {
  const tones=tonesOf(surface);
  const fix=makeCharToneFixtures(surface,tones);
  const common={rawText:surface,profile,domainIds,minPrior:fw.minPrior,imeConfig:ime,dict,toneTimestampOnlyEnabled:true,...fix};
  const w=runLatticeFineSpanGeneration({...common,runtime:rt});
  const x=runLatticeFineSpanGeneration({...common,runtime:wrap(rt,surface)});
  const wordsW=(w.lexicalEdges||[]).map(e=>e.replacement||e.word).filter(Boolean);
  const wordsX=(x.lexicalEdges||[]).map(e=>e.replacement||e.word).filter(Boolean);
  const ow=runSpanAssemblyV4Orchestrator({...common,runtime:rt,recallDomainScope:domainIds,domainPriors:[]});
  const ox=runSpanAssemblyV4Orchestrator({...common,runtime:wrap(rt,surface),recallDomainScope:domainIds,domainPriors:[]});
  const topW=ow.kenlmSentenceCandidates?.combinations?.[0]?.text;
  const topX=ox.kenlmSentenceCandidates?.combinations?.[0]?.text;
  const domW=ow.metrics?.retainedDomains||[];
  const domX=ox.metrics?.retainedDomains||[];
  console.log(JSON.stringify({
    surface,
    lexW:w.trace.lexicalEdgeCount, lexX:x.trace.lexicalEdgeCount,
    pathsW:w.trace.retainedCompletePathCount, pathsX:x.trace.retainedCompletePathCount,
    compoundW:wordsW.includes(surface), compoundX:wordsX.includes(surface),
    wordsW:wordsW.slice(0,12), wordsX:wordsX.slice(0,12),
    topW, topX, domW, domX,
    asmW:ow.kenlmSentenceCandidates?.combinations?.length,
    asmX:ox.kenlmSentenceCandidates?.combinations?.length,
  }));
}
