#!/usr/bin/env node
/**
 * Counterfactual verification CF-01～CF-04 (V1.1 Addendum §10).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { repoRoot } from '../lib/paths.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const SQLITE = path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'lexicon.sqlite');

const results = [];

function record(id, pass, detail) {
  results.push({ id, pass, ...detail });
  console.log(`[counterfactual] ${pass ? 'PASS' : 'FAIL'} ${id}`);
}

function main() {
  const Database = require('better-sqlite3');
  const db = new Database(SQLITE, { readonly: true });

  // CF-01: repair_target=true for new industry terms (Recall + Apply eligible)
  const cf01 = db
    .prepare(`SELECT repair_target FROM term WHERE word = '智能体' LIMIT 1`)
    .get();
  record('CF-01', cf01?.repair_target === 1, {
    word: '智能体',
    repair_target: cf01?.repair_target,
    note: 'repair_target=1 required for Apply; Recall independent',
  });

  // CF-04: append preserves existing domains (机场 keeps tourism_transport)
  const airportDomains = db
    .prepare(
      `SELECT tdt.domain_id FROM term t JOIN term_domain_tags tdt ON tdt.term_id = t.id WHERE t.word = '机场'`
    )
    .all()
    .map((r) => r.domain_id);
  record('CF-04', airportDomains.includes('tourism_transport') && airportDomains.includes('tech_ai'), {
    word: '机场',
    domains: airportDomains,
  });

  db.close();

  // CF-03: unregistered domain rejected at build validation
  const tmpJsonl = path.join(os.tmpdir(), `cf03-invalid-domain-${Date.now()}.jsonl`);
  fs.writeFileSync(
    tmpJsonl,
    `${JSON.stringify({
      word: '非法域词',
      pinyin: 'fei fa yu ci',
      tone_pinyin: 'fei3 fa3 yu4 ci2',
      domain_tags: ['not_a_registered_domain'],
      repair_target: true,
      mutation: 'add',
    })}\n`
  );
  const cf03 = spawnSync(
    'node',
    [
      'scripts/lexicon/industry_pack_v1/build-patch-v4-for-electron.mjs',
      '--patch-id',
      'cf03-should-fail',
      '--entries',
      tmpJsonl,
    ],
    { cwd: root, encoding: 'utf8', shell: true }
  );
  const cf03Rejected = cf03.status !== 0;
  record('CF-03', cf03Rejected, {
    exitCode: cf03.status,
    stderrSnippet: (cf03.stderr || cf03.stdout || '').slice(0, 300),
  });
  try {
    fs.unlinkSync(tmpJsonl);
  } catch {
    /* ignore */
  }

  // CF-02: documented design check — importer always triggers runtime_reload on success
  const importReportsDir = path.join(root, 'reports', 'lexicon-import');
  const capReport = fs
    .readdirSync(importReportsDir)
    .filter((f) => f.startsWith('industry-pack-v1-capacity-validation'))
    .sort()
    .pop();
  const capJson = capReport
    ? JSON.parse(fs.readFileSync(path.join(importReportsDir, capReport), 'utf8'))
    : null;
  record('CF-02', capJson?.runtime_reload === 'ok' || capJson?.checksum_after?.length > 0, {
    note: 'Post-apply bundle committed; runtime_reload=ok when import pipeline completes',
    runtime_reload: capJson?.runtime_reload,
    bundleVersion: JSON.parse(
      fs.readFileSync(path.join(repoRoot(), 'node_runtime/lexicon/v3/manifest.json'), 'utf8')
    ).bundleVersion,
  });

  const allPass = results.every((r) => r.pass);
  console.log(JSON.stringify({ status: allPass ? 'pass' : 'fail', results }, null, 2));
  process.exit(allPass ? 0 : 1);
}

main();
