const path=require("path");
const repo="D:/Programs/github/lingua_1";
const root=path.join(repo,"electron_node/electron-node");
process.chdir(root); process.env.PROJECT_ROOT=repo;
const dist=path.join(root,"dist/main/electron-node/main/src");
const {LexiconRuntimeV2}=require(path.join(dist,"lexicon-v2/lexicon-runtime-v2.js"));
const {defaultGeneralProfile}=require(path.join(dist,"lexicon-v2/profile-registry.js"));
const {resolveRecallScope}=require(path.join(dist,"lexicon-v2/resolve-recall-enabled-fine-domains.js"));
const {loadFwDetectorRuntimeConfig}=require(path.join(dist,"fw-detector/fw-config.js"));
const {loadPinyinImeV2RuntimeConfig}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js"));
const {loadPinyinImeV2Dictionaries,resolvePinyinImeV2DictDir}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const {runLatticeFineSpanGeneration}=require(path.join(dist,"fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"));
const fw=loadFwDetectorRuntimeConfig();
const ime=loadPinyinImeV2RuntimeConfig();
const dict=loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir),{enabledDomains:ime.enabledDomains});
const profile=defaultGeneralProfile();
const rt=new LexiconRuntimeV2();
rt.loadFromBundleDir(path.join(repo,"node_runtime/lexicon/_rebuild_candidate"));
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
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
const surface="单元测试";
for (const [label,runtime] of [["W",rt],["X",wrap(rt,surface)]]) {
  const gen=runLatticeFineSpanGeneration({rawText:surface,runtime,profile,domainIds,minPrior:fw.minPrior,imeConfig:ime,dict});
  if(!gen.ok){ console.log(surface,label,"FAIL",gen.code,gen.message); continue; }
  const words=(gen.lexicalEdges||[]).map(e=>e.word||e.surface||e.normalized||"").filter(Boolean);
  console.log(JSON.stringify({
    label, ok:true,
    win:gen.trace.windowCount,
    recallable:gen.trace.recallableWindowCount,
    lex:gen.trace.lexicalEdgeCount,
    fb:gen.trace.fallbackEdgeCount,
    paths:gen.segmentationPaths.length,
    compoundInEdges:words.includes(surface),
    words:words.slice(0,30),
    sampleKeys: gen.lexicalEdges[0]?Object.keys(gen.lexicalEdges[0]):[]
  }));
}
