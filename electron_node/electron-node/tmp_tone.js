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
const {recallSpanTopKV2}=require(path.join(dist,"lexicon-v2/recall-span-topk-v2.js"));
const {runLatticeFineSpanGeneration}=require(path.join(dist,"fw-detector/span-assembly-v4/lattice-fine-span-runtime.js"));
const {loadPinyinImeV2RuntimeConfig}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js"));
const {loadPinyinImeV2Dictionaries,resolvePinyinImeV2DictDir}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js"));
const candidateDir=path.join(repo,"node_runtime/lexicon/_rebuild_candidate");
const db=new Database(path.join(candidateDir,"lexicon.sqlite"),{readonly:true});
const rt=new LexiconRuntimeV2(); rt.loadFromBundleDir(candidateDir);
const fw=loadFwDetectorRuntimeConfig();
const profile=defaultGeneralProfile();
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
const ime=loadPinyinImeV2RuntimeConfig();
const dict=loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir),{enabledDomains:ime.enabledDomains});
function tones(word){
  const row=db.prepare("SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1").get(word);
  return String(row.tone_pinyin_key).split("|").map(p=>{const m=p.match(/([1-5])$/); return m?Number(m[1]):0;});
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
const surface="单元测试";
const t=db.prepare("SELECT pinyin_key,tone_pinyin_key FROM term WHERE word=?").get(surface);
const syl=String(t.pinyin_key).split("|");
const pattern=tones(surface);
for (const label of ["noTone","withTone","toneCallerFalse"]) {
  const r=recallSpanTopKV2(rt,{syllables:syl,windowText:surface,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,
    acousticTonePattern: label==="noTone"?undefined:pattern,
    toneCallerEnabled: label!=="toneCallerFalse"});
  console.log(label, r.hits.map(h=>h.hotword.word+"@"+h.candidateScore), "n="+r.hits.length);
}
// Without exclusion vs with, with tones
const rW=recallSpanTopKV2(rt,{syllables:syl,windowText:surface,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,acousticTonePattern:pattern,toneCallerEnabled:true});
const rX=recallSpanTopKV2(wrap(rt,surface),{syllables:syl,windowText:surface,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,acousticTonePattern:pattern,toneCallerEnabled:true});
console.log("WITH hits", rW.hits.map(h=>h.hotword.word));
console.log("WITHOUT hits", rX.hits.map(h=>h.hotword.word));
