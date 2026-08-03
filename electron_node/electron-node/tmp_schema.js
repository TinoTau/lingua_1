const Database=require("better-sqlite3");
const db=new Database("D:/Programs/github/lingua_1/node_runtime/lexicon/_rebuild_candidate/lexicon.sqlite",{readonly:true});
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name).filter(n=>/domain|term/i.test(n)).join(","));
try { console.log("domain_lexicon", db.prepare("PRAGMA table_info(domain_lexicon)").all()); } catch(e){ console.log(e.message); }
for (const w of ["神经网络","神经","网络","单元测试","单元","测试"]) {
  const rows = db.prepare("SELECT * FROM domain_lexicon WHERE word=? LIMIT 5").all(w);
  console.log(w, rows);
}
