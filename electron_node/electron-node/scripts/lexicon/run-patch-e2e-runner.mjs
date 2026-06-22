#!/usr/bin/env node
/**
 * Lexicon Patch E2E — Electron ABI runner (compiled dist, no Jest VM).
 * Jest cannot load ESM term-materialize inside its VM; production path uses dist + dynamic import.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(__dirname, '../..');
const dist = path.join(root, 'dist/main/electron-node/main/src/lexicon-patch-v3');

const { applyLexiconPatchV3 } = require(path.join(dist, 'patch-service.js'));
const { handleLexiconApplyPatchHttp } = require(path.join(dist, 'apply-patch-http.js'));
const { copyV3BundleToTemp, readBundleSnapshot } = require(path.join(dist, 'bundle-snapshot.js'));
const {
  buildPatchA,
  buildPatchB,
  buildPatchC,
  buildPatchD,
  buildPatchE,
  buildPatchGWrongVersion,
  buildPatchHInvalidDomain,
  buildPatchRollbackProbe,
  buildPatchIMultiDomain,
  buildPatchJUpdateDomainWeights,
  buildPatchKDeleteSingleTag,
  buildPatchLDeleteFullTerm,
  buildPatchMEnableTerm,
  PATCH_KEYS,
  PATCH_TERM_ID,
  PATCH_MULTI_TERM_ID,
  PATCH_MULTI_WORD,
  PATCH_MULTI_PINYIN,
  PATCH_WORDS,
} = require(path.join(dist, 'patch-fixtures.js'));
const {
  patchHistoryCount,
  queryRow,
  readManifestBundleVersion,
  verifyChecksumAligned,
} = require(path.join(dist, 'patch-bundle-verify.js'));
const { resolveLexiconV3BundleFiles } = require(path.join(dist, 'bundle-io.js'));
const { runRecallSmoke, runRecallSmokeMultiDomain } = require(path.join(dist, 'patch-recall-smoke.js'));

const projectRoot = process.env.PROJECT_ROOT || path.resolve(root, '../../..');
const v3Source = path.join(projectRoot, 'node_runtime', 'lexicon', 'v3');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

async function main() {
  if (!fs.existsSync(v3Source)) {
    console.log('[patch-e2e] SKIP — missing v3 bundle at', v3Source);
    process.exit(0);
  }

  const tempDir = copyV3BundleToTemp(v3Source);
  let version = readManifestBundleVersion(resolveLexiconV3BundleFiles(tempDir).manifestPath);
  const opts = () => ({ bundleDir: tempDir, reload: false });

  console.log('[patch-e2e] running against', tempDir);

  await test('Patch A: base add', async () => {
    const res = await applyLexiconPatchV3(buildPatchA(version), opts());
    assert(res.ok, `Patch A failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const row = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT prior_score, enabled, repair_target FROM base_lexicon WHERE pinyin_key = ? AND word = ?`,
      [PATCH_KEYS.basePinyin, PATCH_WORDS.base]
    );
    assert(row?.prior_score === 0.95, 'prior_score');
    assert(row?.enabled === 1, 'enabled');
    assert(row?.repair_target === 1, 'repair_target');
  });

  await test('Patch B: term add + SSOT tags + materialized alias/routing', async () => {
    const res = await applyLexiconPatchV3(buildPatchB(version), opts());
    assert(res.ok, `Patch B failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    const term = queryRow(files.sqlitePath, `SELECT * FROM term WHERE id = ?`, [PATCH_TERM_ID]);
    assert(term?.word === PATCH_WORDS.term, 'term SSOT word');
    assert(term?.prior_score === 0.96, 'term prior_score');
    assert(term?.enabled === 1, 'term enabled');
    const tag = queryRow(
      files.sqlitePath,
      `SELECT weight FROM term_domain_tags WHERE term_id = ? AND domain_id = 'travel'`,
      [PATCH_TERM_ID]
    );
    assert(tag?.weight === 1.0, 'tag weight');
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
        [PATCH_WORDS.term]
      ),
      'materialized canonical'
    );
    const alias = queryRow(
      files.sqlitePath,
      `SELECT canonical_word FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
      [PATCH_WORDS.termAlias]
    );
    assert(alias?.canonical_word === PATCH_WORDS.term, 'alias canonical_word');
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM industry_routing_lexicon WHERE domain_id = 'travel' AND keyword = ?`,
        [PATCH_WORDS.term]
      ),
      'routing row'
    );
  });

  await test('Patch I: insert multidomain term', async () => {
    const res = await applyLexiconPatchV3(buildPatchIMultiDomain(version), opts());
    assert(res.ok, `Patch I failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    assert(
      queryRow(files.sqlitePath, `SELECT 1 FROM term WHERE id = ?`, [PATCH_MULTI_TERM_ID]),
      'term row'
    );
    const travelTag = queryRow(
      files.sqlitePath,
      `SELECT weight FROM term_domain_tags WHERE term_id = ? AND domain_id = 'travel'`,
      [PATCH_MULTI_TERM_ID]
    );
    const restaurantTag = queryRow(
      files.sqlitePath,
      `SELECT weight FROM term_domain_tags WHERE term_id = ? AND domain_id = 'restaurant'`,
      [PATCH_MULTI_TERM_ID]
    );
    assert(travelTag?.weight === 0.8, 'travel tag weight');
    assert(restaurantTag?.weight === 0.6, 'restaurant tag weight');
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE domain_id = 'travel' AND word = ?`,
        [PATCH_MULTI_WORD]
      ),
      'travel materialized'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE domain_id = 'restaurant' AND word = ?`,
        [PATCH_MULTI_WORD]
      ),
      'restaurant materialized'
    );
    const multiRecall = runRecallSmokeMultiDomain(
      tempDir,
      ['travel', 'restaurant'],
      PATCH_MULTI_PINYIN,
      PATCH_MULTI_WORD.length,
      PATCH_MULTI_WORD
    );
    assert(multiRecall.passed, 'multidomain recall hit');
    assert(multiRecall.domainWeights?.travel === 0.8, 'runtime travel weight');
    assert(multiRecall.domainWeights?.restaurant === 0.6, 'runtime restaurant weight');
  });

  await test('Patch J: update domainWeights', async () => {
    const res = await applyLexiconPatchV3(buildPatchJUpdateDomainWeights(version), opts());
    assert(res.ok, `Patch J failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    const travelTag = queryRow(
      files.sqlitePath,
      `SELECT weight FROM term_domain_tags WHERE term_id = ? AND domain_id = 'travel'`,
      [PATCH_MULTI_TERM_ID]
    );
    const restaurantTag = queryRow(
      files.sqlitePath,
      `SELECT weight FROM term_domain_tags WHERE term_id = ? AND domain_id = 'restaurant'`,
      [PATCH_MULTI_TERM_ID]
    );
    assert(travelTag?.weight === 0.5, 'updated travel tag weight');
    assert(restaurantTag?.weight === 1.0, 'updated restaurant tag weight');
    const routing = queryRow(
      files.sqlitePath,
      `SELECT weight FROM industry_routing_lexicon WHERE domain_id = 'restaurant' AND keyword = ?`,
      [PATCH_MULTI_WORD]
    );
    assert(routing?.weight === 1.0, 'routing weight synced');
    const multiRecall = runRecallSmokeMultiDomain(
      tempDir,
      ['travel', 'restaurant'],
      PATCH_MULTI_PINYIN,
      PATCH_MULTI_WORD.length,
      PATCH_MULTI_WORD
    );
    assert(multiRecall.domainWeights?.restaurant === 1.0, 'runtime restaurant weight updated');
  });

  await test('Patch K: delete single tag', async () => {
    const res = await applyLexiconPatchV3(buildPatchKDeleteSingleTag(version), opts());
    assert(res.ok, `Patch K failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    assert(
      queryRow(files.sqlitePath, `SELECT 1 FROM term WHERE id = ?`, [PATCH_MULTI_TERM_ID]),
      'term preserved'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM term_domain_tags WHERE term_id = ? AND domain_id = 'restaurant'`,
        [PATCH_MULTI_TERM_ID]
      ),
      'restaurant tag deleted'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM term_domain_tags WHERE term_id = ? AND domain_id = 'travel'`,
        [PATCH_MULTI_TERM_ID]
      ),
      'travel tag preserved'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE domain_id = 'restaurant' AND word = ?`,
        [PATCH_MULTI_WORD]
      ),
      'restaurant materialized row removed'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE domain_id = 'travel' AND word = ?`,
        [PATCH_MULTI_WORD]
      ),
      'travel materialized row preserved'
    );
  });

  await test('Patch C: term priorScore update (SSOT)', async () => {
    const res = await applyLexiconPatchV3(buildPatchC(version), opts());
    assert(res.ok, `Patch C failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const row = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT prior_score FROM term WHERE id = ?`,
      [PATCH_TERM_ID]
    );
    assert(row?.prior_score === 0.98, 'term prior_score update');
  });

  await test('Recall smoke: base + term domain + alias hit', async () => {
    const files = resolveLexiconV3BundleFiles(tempDir);
    const aliasRow = queryRow(
      files.sqlitePath,
      `SELECT pinyin_key FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
      [PATCH_WORDS.termAlias]
    );
    const aliasPinyin = String(aliasRow?.pinyin_key ?? '');
    assert(aliasPinyin.length > 0, 'alias pinyin_key');
    const rows = runRecallSmoke(tempDir, [
      {
        label: 'base hit',
        tier: 'base',
        pinyinKey: PATCH_KEYS.basePinyin,
        termLength: PATCH_WORDS.base.length,
        expectWord: PATCH_WORDS.base,
        expectHit: true,
      },
      {
        label: 'domain canonical',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: PATCH_KEYS.termPinyin,
        termLength: PATCH_WORDS.term.length,
        expectWord: PATCH_WORDS.term,
        expectHit: true,
      },
      {
        label: 'domain alias',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: aliasPinyin,
        termLength: PATCH_WORDS.termAlias.length,
        expectWord: PATCH_WORDS.termAlias,
        expectHit: true,
      },
    ]);
    assert(rows.every((r) => r.passed), 'recall smoke rows');
  });

  await test('Patch D: term disable cascades to materialized rows', async () => {
    const res = await applyLexiconPatchV3(buildPatchD(version), opts());
    assert(res.ok, `Patch D failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    assert(
      queryRow(files.sqlitePath, `SELECT enabled FROM term WHERE id = ?`, [PATCH_TERM_ID])?.enabled === 0,
      'term disabled'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
        [PATCH_WORDS.term]
      )?.enabled === 0,
      'canonical disabled'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
        [PATCH_WORDS.termAlias]
      )?.enabled === 0,
      'alias disabled'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM industry_routing_lexicon WHERE domain_id = 'travel' AND keyword = ?`,
        [PATCH_WORDS.term]
      ),
      'routing removed'
    );
    const smoke = runRecallSmoke(tempDir, [
      {
        label: 'domain disabled',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: PATCH_KEYS.termPinyin,
        termLength: PATCH_WORDS.term.length,
        expectWord: PATCH_WORDS.term,
        expectHit: false,
      },
    ]);
    assert(smoke[0]?.passed, 'recall disabled');
  });

  await test('Patch M: enable term after disable', async () => {
    const res = await applyLexiconPatchV3(buildPatchMEnableTerm(version), opts());
    assert(res.ok, `Patch M failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    assert(
      queryRow(files.sqlitePath, `SELECT enabled FROM term WHERE id = ?`, [PATCH_TERM_ID])?.enabled === 1,
      'term enabled'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
        [PATCH_WORDS.term]
      )?.enabled === 1,
      'canonical enabled'
    );
    assert(
      queryRow(
        files.sqlitePath,
        `SELECT 1 FROM industry_routing_lexicon WHERE domain_id = 'travel' AND keyword = ?`,
        [PATCH_WORDS.term]
      ),
      'routing restored'
    );
    const smoke = runRecallSmoke(tempDir, [
      {
        label: 'domain re-enabled',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: PATCH_KEYS.termPinyin,
        termLength: PATCH_WORDS.term.length,
        expectWord: PATCH_WORDS.term,
        expectHit: true,
      },
    ]);
    assert(smoke[0]?.passed, 'recall hit after enable');
  });

  await test('Patch L: delete full term', async () => {
    const res = await applyLexiconPatchV3(buildPatchLDeleteFullTerm(version), opts());
    assert(res.ok, `Patch L failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const files = resolveLexiconV3BundleFiles(tempDir);
    assert(
      !queryRow(files.sqlitePath, `SELECT 1 FROM term WHERE id = ?`, [PATCH_MULTI_TERM_ID]),
      'term deleted'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM term_domain_tags WHERE term_id = ?`,
        [PATCH_MULTI_TERM_ID]
      ),
      'tags deleted'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM domain_lexicon WHERE word = ?`,
        [PATCH_MULTI_WORD]
      ),
      'domain_lexicon cleaned'
    );
    assert(
      !queryRow(
        files.sqlitePath,
        `SELECT 1 FROM industry_routing_lexicon WHERE keyword = ?`,
        [PATCH_MULTI_WORD]
      ),
      'routing cleaned'
    );
    const multiRecall = runRecallSmokeMultiDomain(
      tempDir,
      ['travel', 'restaurant'],
      PATCH_MULTI_PINYIN,
      PATCH_MULTI_WORD.length,
      PATCH_MULTI_WORD
    );
    assert(!multiRecall.passed, 'recall miss after term delete');
  });

  await test('manifest/stats/checksum updated after apply', async () => {
    const files = resolveLexiconV3BundleFiles(tempDir);
    const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf-8'));
    assert(manifest.schemaVersion === 'lexicon-v3-five-table-v2', 'schemaVersion v2');
    assert(manifest.lastPatchId, 'lastPatchId');
    assert(manifest.lastAppliedAt, 'lastAppliedAt');
    assert(manifest.bundleVersion === version, 'bundleVersion');
    assert(verifyChecksumAligned(files), 'checksum aligned');
  });

  await test('HTTP handler uses PatchService', async () => {
    const patch = buildPatchA(version);
    const http = await handleLexiconApplyPatchHttp(patch, opts());
    assert(http.status === 400, 'http status');
    assert(http.body.ok === false, 'http ok false');
    assert(http.body.errorCode === 'patch_already_applied', 'errorCode');
  });

  await test('Patch F: duplicate patchId rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const res = await applyLexiconPatchV3(buildPatchA(version), opts());
    assert(res.ok === false && res.errorCode === 'patch_already_applied', 'duplicate rejected');
    assert(readBundleSnapshot(tempDir).checksum === snap.checksum, 'checksum unchanged');
  });

  await test('Patch G: wrong baseVersion rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const histBefore = patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath);
    const res = await applyLexiconPatchV3(buildPatchGWrongVersion(version), opts());
    assert(res.ok === false && res.errorCode === 'version_mismatch', 'version mismatch');
    assert(readBundleSnapshot(tempDir).checksum === snap.checksum, 'checksum unchanged');
    assert(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath) === histBefore, 'history unchanged');
  });

  await test('Patch H: invalid domain rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const res = await applyLexiconPatchV3(buildPatchHInvalidDomain(version), opts());
    assert(res.ok === false && res.errorCode === 'invalid_domain', 'invalid domain');
    assert(readBundleSnapshot(tempDir).checksum === snap.checksum, 'checksum unchanged');
  });

  await test('Patch E: base delete + patch_history', async () => {
    const res = await applyLexiconPatchV3(buildPatchE(version), opts());
    assert(res.ok, `Patch E failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    assert(
      !queryRow(
        resolveLexiconV3BundleFiles(tempDir).sqlitePath,
        `SELECT 1 FROM base_lexicon WHERE word = ?`,
        [PATCH_WORDS.base]
      ),
      'base row deleted'
    );
    assert(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath) > 0, 'patch history');
    const smoke = runRecallSmoke(tempDir, [
      {
        label: 'base deleted',
        tier: 'base',
        pinyinKey: PATCH_KEYS.basePinyin,
        termLength: PATCH_WORDS.base.length,
        expectWord: PATCH_WORDS.base,
        expectHit: false,
      },
    ]);
    assert(smoke[0]?.passed, 'recall base deleted');
  });

  await test('rollback: transaction failure leaves bundle unchanged', async () => {
    const snap = readBundleSnapshot(tempDir);
    const histBefore = patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath);
    process.env.LEXICON_PATCH_E2E_GATE_FAIL = '1';
    const res = await applyLexiconPatchV3(buildPatchRollbackProbe(version), opts());
    delete process.env.LEXICON_PATCH_E2E_GATE_FAIL;
    assert(res.ok === false && res.errorCode === 'apply_transaction_failed', 'rollback failed apply');
    assert(
      !queryRow(
        resolveLexiconV3BundleFiles(tempDir).sqlitePath,
        `SELECT 1 FROM base_lexicon WHERE word = ?`,
        ['回滚探测词']
      ),
      'probe word not written'
    );
    assert(readBundleSnapshot(tempDir).checksum === snap.checksum, 'checksum unchanged');
    assert(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath) === histBefore, 'history unchanged');
  });

  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`\n[patch-e2e] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[patch-e2e] fatal', err);
  process.exit(1);
});
