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
const {recallSpanTopKV2}=require(path.join(dist,"lexicon-v2/recall-span-topk-v2.js"));
const candidateDir=path.join(repo,"node_runtime/lexicon/_rebuild_candidate");
const db=new Database(path.join(candidateDir,"lexicon.sqlite"),{readonly:true});
const rt=new LexiconRuntimeV2(); rt.loadFromBundleDir(candidateDir);
const fw=loadFwDetectorRuntimeConfig();
const profile=defaultGeneralProfile();
const domainIds=resolveRecallScope({configEnabledDomains:fw.enabledDomains}).domainIds;
const ime=loadPinyinImeV2RuntimeConfig();
const dict=loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(ime.dictDir),{enabledDomains:ime.enabledDomains});
function tonesOf(word){
  const row=db.prepare("SELECT tone_pinyin_key FROM term WHERE word=? AND enabled=1").get(word)||
            db.prepare("SELECT tone_pinyin_key FROM base_lexicon WHERE word=? AND enabled=1").get(word);
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
function edgeRepls(edges){
  const out=[];
  for (const e of edges||[]) for (const c of e.candidates||[]) out.push({edge:e.edgeId,repl:c.replacement,dom:c.domains,score:c.candidateScore,rt:c.repairTarget});
  return out;
}
function pathSummary(paths){
  return (paths||[]).map(p=>({
    lex:p.lexicalEdgeCount, fb:p.fallbackEdgeCount,
    spans:(p.edgeRefs||[]).map(e=>({id:e.edgeId, repls:(e.candidates||[]).map(c=>c.replacement)}))
  }));
}
const KEEP=["专家系统","单元测试","回归测试","安检通道","循环网络","正则策略","注册中心","流量镜像","测试数据","熔断策略","特征工程","神经网络","联系电话","视频会议","训练数据","迁移学习","迷你吧","邀请函","配置中心","配置文件","降级策略","集成测试"];
const rows=[];
for (const surface of KEEP) {
  const tones=tonesOf(surface);
  const fix=makeCharToneFixtures(surface,tones);
  const t=db.prepare("SELECT pinyin_key,tone_pinyin_key FROM term WHERE word=?").get(surface);
  const syl=String(t.pinyin_key).split("|");
  const pattern=tones;
  const exactW=recallSpanTopKV2(rt,{syllables:syl,windowText:surface,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,acousticTonePattern:pattern,toneCallerEnabled:true});
  const exactX=recallSpanTopKV2(wrap(rt,surface),{syllables:syl,windowText:surface,termLength:syl.length,topK:5,perSpanLimit:5,profile,domainIds,acousticTonePattern:pattern,toneCallerEnabled:true});
  const common={rawText:surface,profile,domainIds,minPrior:fw.minPrior,imeConfig:ime,dict,toneTimestampOnlyEnabled:true,...fix};
  const lw=runLatticeFineSpanGeneration({...common,runtime:rt});
  const lx=runLatticeFineSpanGeneration({...common,runtime:wrap(rt,surface)});
  const ow=runSpanAssemblyV4Orchestrator({...common,runtime:rt,recallDomainScope:domainIds,domainPriors:[]});
  const ox=runSpanAssemblyV4Orchestrator({...common,runtime:wrap(rt,surface),recallDomainScope:domainIds,domainPriors:[]});
  const replW=edgeRepls(lw.lexicalEdges);
  const replX=edgeRepls(lx.lexicalEdges);
  const compoundInW=replW.some(r=>r.repl===surface);
  const compoundInX=replX.some(r=>r.repl===surface);
  const topW=ow.kenlmSentenceCandidates?.combinations?.[0]?.text||"";
  const topX=ox.kenlmSentenceCandidates?.combinations?.[0]?.text||"";
  const textsW=(ow.kenlmSentenceCandidates?.combinations||[]).map(c=>c.text);
  const textsX=(ox.kenlmSentenceCandidates?.combinations||[]).map(c=>c.text);
  const domW=[...(ow.metrics?.retainedDomains||[])].sort();
  const domX=[...(ox.metrics?.retainedDomains||[])].sort();
  const identicalAsm = JSON.stringify(textsW)===JSON.stringify(textsX) && topW===topX && JSON.stringify(domW)===JSON.stringify(domX);
  const covW=lw.trace.coverageStatus; const covX=lx.trace.coverageStatus;
  const hardKeep = covW!==covX || JSON.stringify(domW)!==JSON.stringify(domX) || textsW.length>textsX.length || topW!==topX;
  const verdict = hardKeep ? "KEEP_RUNTIME_REQUIRED" : "DELETE_RUNTIME_SAFE";
  rows.push({
    surface, verdict,
    exactW:exactW.hits.some(h=>h.hotword.word===surface),
    exactX:exactX.hits.some(h=>h.hotword.word===surface),
    exclusionOk: !compoundInX && !exactX.hits.some(h=>h.hotword.word===surface),
    compoundInW, compoundInX,
    lexW:lw.trace.lexicalEdgeCount, lexX:lx.trace.lexicalEdgeCount,
    pathsW:lw.trace.retainedCompletePathCount, pathsX:lx.trace.retainedCompletePathCount,
    covW,covX, topW,topX, textsW,textsX, domW,domX,
    asmW:textsW.length, asmX:textsX.length,
    identicalAsm,
    replW:replW.map(r=>r.edge+":"+r.repl),
    replX:replX.map(r=>r.edge+":"+r.repl),
  });
}
console.log(JSON.stringify({
  required: rows.filter(r=>r.verdict==="KEEP_RUNTIME_REQUIRED").map(r=>r.surface),
  safe: rows.filter(r=>r.verdict==="DELETE_RUNTIME_SAFE").map(r=>r.surface),
  compoundPresentWith: rows.filter(r=>r.compoundInW).map(r=>r.surface),
  compoundAbsentWith: rows.filter(r=>!r.compoundInW).map(r=>r.surface),
  exclusionFails: rows.filter(r=>!r.exclusionOk).map(r=>r.surface),
  samples: rows.filter(r=>["单元测试","神经网络","迷你吧","配置文件","熔断策略","邀请函"].includes(r.surface))
}, null, 2));
