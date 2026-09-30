const path = require("path");
const repo = "D:/Programs/github/lingua_1";
const root = path.join(repo, "electron_node/electron-node");
process.chdir(root);
process.env.PROJECT_ROOT = repo;
const dist = path.join(root, "dist/main/electron-node/main/src");
const { LexiconRuntimeV2 } = require(path.join(dist, "lexicon-v2/lexicon-runtime-v2.js"));
const rt = new LexiconRuntimeV2();
const load = rt.loadFromBundleDir(path.join(repo, "node_runtime/lexicon/v3"));
console.log(JSON.stringify({status:load.status, methods: Object.getOwnPropertyNames(Object.getPrototypeOf(rt)).filter(x=>x.toLowerCase().includes('look')||x.toLowerCase().includes('base')||x.toLowerCase().includes('query')).slice(0,40)}));
const keys = ["zhong|guan|cun", "zhong guan cun", "zhongguancun"];
for (const k of keys) {
  try {
    const base = rt.lookupBaseByPinyinKey ? rt.lookupBaseByPinyinKey(k, 3) : null;
    console.log(JSON.stringify({k, n: (base||[]).length, sample:(base||[]).slice(0,3).map(h=>h.word||h)}));
  } catch(e) { console.log(JSON.stringify({k, err:String(e&&e.message||e)})); }
}
try {
  const db = rt.db || rt._db || null;
  console.log('hasDb', !!db, 'keys', Object.keys(rt).slice(0,30));
} catch(e) {}
