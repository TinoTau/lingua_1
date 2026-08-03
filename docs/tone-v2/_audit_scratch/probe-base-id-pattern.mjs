import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../electron_node/electron-node');
const require = createRequire(path.join(root, 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(path.resolve(root, '../../node_runtime/lexicon/v3/lexicon.sqlite'), {
  readonly: true,
});
for (const w of ['高速', '候选', '蓝莓马芬', '医师', '上线计划']) {
  const t = db.prepare('SELECT id FROM term WHERE word=?').get(w);
  const b = db.prepare('SELECT id FROM base_lexicon WHERE word=? AND is_alias=0').get(w);
  console.log(w, 'term', t?.id, 'base', b?.id);
}
console.log(
  db
    .prepare(
      `SELECT
        CASE
          WHEN id LIKE 'base-rebuild-%' THEN 'base-rebuild'
          WHEN id LIKE 'exp-%' THEN 'exp'
          ELSE 'other'
        END AS k,
        COUNT(*) AS c
       FROM base_lexicon WHERE is_alias=0 GROUP BY 1`
    )
    .all()
);
console.log('base aliases', db.prepare(`SELECT COUNT(*) AS c FROM base_lexicon WHERE is_alias=1`).get());
console.log('domain aliases', db.prepare(`SELECT COUNT(*) AS c FROM domain_lexicon WHERE is_alias=1`).get());
console.log('routing', db.prepare(`SELECT COUNT(*) AS c FROM industry_routing_lexicon`).get());
db.close();
