import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = 'd:\\Programs\\github\\lingua_1';
const DIST = path.join(ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const r = new LexiconRuntimeV2(); r.loadFromBundleDir(path.join(ROOT, 'node_runtime/lexicon/v3'));
const profile = defaultGeneralProfile();
function tonePat(t){return textToToneSyllables(t).map(s=>Number((String(s).match(/([1-5])$/)||[])[1]||1));}
function exists(term){
  const syl=textToSyllables(term); if(!syl.length) return false;
  const key=syllablesKey(syl);
  const b=r.lookupBaseByExactSurfaceAndPinyin(key,term,syl.length);
  const d=syl.length>=2&&syl.length<=5?r.lookupDomainsByPinyinKeyMulti(profile.enabledDomains||[],key,syl.length):[];
  return [...b,...d].some(h=>h.word===term);
}
function recall(w,dom){
  const syl=textToSyllables(w);
  const out=recallSpanTopKV2(r,{syllables:syl,windowText:w,termLength:syl.length,topK:8,profile,domainIds:dom,perSpanLimit:8,acousticTonePattern:tonePat(w)});
  return out.hits.map(h=>h.hotword.word);
}
const terms=['杯','燕','城','项目','里','更衣室','柜子','钥匙','衣室','规则','意识','李','李工','燕麦','堵','不','苏','和','步','背','烟','成','向木','顺便'];
const lines=[];
for(const t of terms){
  lines.push(`${t}\texists=${exists(t)}\tpinyin=${textToSyllables(t).join('|')}\ttone=${textToToneSyllables(t).join('|')}`);
}
lines.push('--- recall 背 -> ' + recall('背',['coffee','milk_tea']).join(','));
lines.push('--- recall 烟 -> ' + recall('烟',['coffee']).join(','));
lines.push('--- recall 成 -> ' + recall('成',['tech_ai']).join(','));
lines.push('--- recall 项目 probe on 向 -> ' + recall('向',['transport']).join(','));
lines.push('--- recall 项目 probe on 木 -> ' + recall('木',['transport']).join(','));
lines.push('--- recall 意识|规|则|要是 windows');
for(const w of ['意识','规','则','要是']){lines.push(`  ${w} -> ${recall(w,['milk_tea','tourism_hotel']).join(',')}`);}
fs.writeFileSync(path.join(ROOT,'docs/user_correction/model3/_lexicon_probe.txt'), lines.join('\n'));
r.close?.(); console.log('wrote');
