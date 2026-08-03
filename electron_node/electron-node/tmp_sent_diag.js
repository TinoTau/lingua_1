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
const {makeCharToneFixtures}=require(path.join(dist,"fw-detector/span-assembly-v4/test-tone-fixtures.js"));
const {buildUtteranceSyllableCoordinate}=require(path.join(dist,"fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js"));
const {recallSpanTopKV2}=require(path.join(dist,"lexicon-v2/recall-span-topk-v2.js"));
const candidateDir=path.join(repo,"node_runtime/lexicon/_rebuild_candidate");
const db=new Database(path.join(candidateDir,"lexicon.sqlite"),{readonly:true});
const rt=new LexiconRuntimeV2(); rt.loadFromBundleDir(candidateDir);
const fw=loadFwDetectorRuntimeConfig();
const profile=defaultGeneralProfile();
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
const ime=loadPinyinImeV2RuntimeConfig();
const dict=loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir),{enabledDomains:ime.enabledDomains});
const sentence="我们正在训练神经网络模型。";
const compound="神经网络";
const toneRow=db.prepare("SELECT tone_pinyin_key,pinyin_key FROM term WHERE word=?").get(compound);
const compoundTones=String(toneRow.tone_pinyin_key).split("|").map(p=>{const m=p.match(/([1-5])$/);return m?Number(m[1]):1;});
const chars=[...sentence];
const tones=chars.map(()=>1);
const idx=sentence.indexOf(compound);
const start=[...sentence.slice(0,idx)].length;
for(let i=0;i<compoundTones.length;i++) tones[start+i]=compoundTones[i];
const fix=makeCharToneFixtures(sentence,tones);
const gen=runLatticeFineSpanGeneration({rawText:sentence,runtime:rt,profile,domainIds,minPrior:fw.minPrior,imeConfig:ime,dict,toneTimestampOnlyEnabled:true,...fix});
const repl=[];
for(const e of gen.lexicalEdges||[]) for(const c of e.candidates||[]) repl.push(e.edgeId+":"+c.replacement);
console.log(JSON.stringify({ok:gen.ok,lex:gen.trace.lexicalEdgeCount,fb:gen.trace.fallbackEdgeCount,paths:gen.trace.retainedCompletePathCount,win:gen.trace.windowCount,recallable:gen.trace.recallableWindowCount,compoundIn:repl.some(x=>x.includes(compound)),repl:repl.slice(0,30),tonesAtCompound:tones.slice(start,start+4)}));
const coord=buildUtteranceSyllableCoordinate(sentence);
const sylStart=coord.ranges[0]? /* find syllable for compound */ null : null;
// find compound syllable window
let cjk=0; let sylS=-1; let sylE=-1;
for (let i=0;i<chars.length;i++){
  if(/[\u4e00-\u9fff]/.test(chars[i])){
    if(i===start) sylS=cjk;
    if(i===start+compound.length-1) sylE=cjk+1;
    cjk++;
  }
}
const syl=coord.syllables.slice(sylS,sylE);
const r=recallSpanTopKV2(rt,{syllables:syl,windowText:compound,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,acousticTonePattern:compoundTones,toneCallerEnabled:true});
console.log("exact", r.hits.map(h=>h.hotword.word), "syl",syl,"sylRange",sylS,sylE);
