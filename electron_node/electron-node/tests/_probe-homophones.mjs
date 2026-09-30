import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = 'd:\\Programs\\github\\lingua_1';
const DIST = path.join(ROOT, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const OUT = path.join(ROOT, 'docs/user_correction/model3/single_char_recall_contract_evidence.csv');
fs.writeFileSync(OUT, 'start\n');
const { LexiconRuntimeV2 } = require(path.join(DIST, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(DIST, 'lexicon-v2/profile-registry.js'));
const { recallSpanTopKV2 } = require(path.join(DIST, 'lexicon-v2/recall-span-topk-v2.js'));
const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { textToToneSyllables } = require(path.join(DIST, 'lexicon/phonetic/tone-pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const r = new LexiconRuntimeV2(); r.loadFromBundleDir(path.join(ROOT, 'node_runtime/lexicon/v3'));
const profile = defaultGeneralProfile();
function tonePat(t){return textToToneSyllables(t).map(s=>Number((String(s).match(/([1-5])$/)||[])[1]||1));}
function exists(term){const syl=textToSyllables(term);const key=syllablesKey(syl);return r.lookupBaseByExactSurfaceAndPinyin(key,term,syl.length).some(h=>h.word===term);}
function recall(src){const syl=textToSyllables(src);return recallSpanTopKV2(r,{syllables:syl,windowText:src,termLength:1,topK:8,profile,domainIds:[],perSpanLimit:8,acousticTonePattern:tonePat(src)}).hits.map(h=>h.hotword.word);}
const pairs=[['成','城'],['他','她'],['他','它'],['在','再'],['做','作'],['账','帐'],['背','杯'],['向','项'],['木','目'],['李','里']];
const lines=['pairId,sourceChar,targetChar,sourcePinyin,targetPinyin,sourceTone,targetTone,sourceExists,targetExists,recallSourceResult,targetReturned,systematicSurfaceExact,notes'];
pairs.forEach(([s,t],i)=>{
  const hits=recall(s);
  lines.push([`p${i+1}`,s,t,textToSyllables(s).join('|'),textToSyllables(t).join('|'),textToToneSyllables(s).join('|'),textToToneSyllables(t).join('|'),exists(s),exists(t),hits.join(';')||'(empty)',hits.includes(t)?'YES':'NO',hits.includes(t)?'NO':'YES',''].join(','));
});
fs.writeFileSync(OUT, lines.join('\n'));
r.close?.(); console.log('ok', lines.length);
