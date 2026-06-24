#!/usr/bin/env node
/**
 * Lexicon Patch V4 E2E — Electron ABI runner.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.join(__dirname, '../..');
const distV4 = path.join(root, 'dist/main/electron-node/main/src/lexicon-patch-v4');
const distV3 = path.join(root, 'dist/main/electron-node/main/src/lexicon-patch-v3');

const { applyLexiconPatchV4 } = require(path.join(distV4, 'patch-service-v4.js'));
const { applyLexiconPatchV3 } = require(path.join(distV3, 'patch-service.js'));
const { buildPatchA } = require(path.join(distV3, 'patch-fixtures.js'));
const {
  buildPatchNAppendYuyueTechAi,
  buildPatchN1AppendSaomaTechAi,
  buildPatchN2DuplicateAddYuyue,
  buildPatchN3AddHuigun,
  buildPatchN4AppendYuyueTechAiLowWeight,
  PATCH_V4_YUYUE_WORD,
  PATCH_V4_SAOMA_WORD,
  PATCH_V4_HUIGUN_WORD,
} = require(path.join(distV4, 'patch-fixtures-v4.js'));
const { copyV3BundleToTemp } = require(path.join(distV3, 'bundle-snapshot.js'));
const { resolveLexiconV3BundleFiles } = require(path.join(distV3, 'bundle-io.js'));
const { queryRow, verifyChecksumAligned } = require(path.join(distV3, 'patch-bundle-verify.js'));

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

function soleTermId(sqlitePath, word) {
  const rows = require('better-sqlite3')(sqlitePath, { readonly: true })
    .prepare('SELECT id FROM term WHERE word = ?')
    .all(word);
  if (rows.length !== 1) {
    throw new Error(`expected single term for ${word}, got ${rows.length}`);
  }
  return rows[0].id;
}

function domainTagsForTerm(sqlitePath, termId) {
  return require('better-sqlite3')(sqlitePath, { readonly: true })
    .prepare('SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ? ORDER BY domain_id')
    .all(termId);
}

async function main() {
  if (!fs.existsSync(v3Source)) {
    console.log('[patch-v4-e2e] SKIP — missing v3 bundle at', v3Source);
    process.exit(0);
  }

  const tempDir = copyV3BundleToTemp(v3Source);
  const files = resolveLexiconV3BundleFiles(tempDir);
  let version = JSON.parse(fs.readFileSync(files.manifestPath, 'utf8')).bundleVersion;
  const opts = () => ({ bundleDir: tempDir, reload: false });

  const yuyueTermId = soleTermId(files.sqlitePath, PATCH_V4_YUYUE_WORD);
  const saomaTermId = soleTermId(files.sqlitePath, PATCH_V4_SAOMA_WORD);

  console.log('[patch-v4-e2e] running against', tempDir);

  await test('Patch N: appendDomainTags 预约 → tech_ai', async () => {
    const res = await applyLexiconPatchV4(buildPatchNAppendYuyueTechAi(version, yuyueTermId), opts());
    assert(res.ok, `Patch N failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const tags = domainTagsForTerm(files.sqlitePath, yuyueTermId).map((r) => r.domain_id);
    assert(tags.includes('tourism_hotel'), 'tourism_hotel preserved');
    assert(tags.includes('tourism_route'), 'tourism_route preserved');
    assert(tags.includes('tech_ai'), 'tech_ai appended');
    const tech = domainTagsForTerm(files.sqlitePath, yuyueTermId).find((r) => r.domain_id === 'tech_ai');
    assert(tech?.weight === 0.6, 'tech_ai weight');
  });

  await test('Patch N+1: appendDomainTags 扫码 → tech_ai', async () => {
    const res = await applyLexiconPatchV4(buildPatchN1AppendSaomaTechAi(version, saomaTermId), opts());
    assert(res.ok, `Patch N+1 failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const tags = domainTagsForTerm(files.sqlitePath, saomaTermId).map((r) => r.domain_id);
    for (const d of ['food_order', 'coffee', 'milk_tea', 'tech_ai']) {
      assert(tags.includes(d), `preserved/appended ${d}`);
    }
  });

  await test('Patch N+2: duplicate addTerm 预约 → FAIL', async () => {
    const res = await applyLexiconPatchV4(buildPatchN2DuplicateAddYuyue(version), opts());
    assert(!res.ok, 'expected failure');
    assert(res.errorCode === 'term_already_exists', `got ${res.errorCode}`);
  });

  await test('Patch N+3: addTerm 回滚', async () => {
    const res = await applyLexiconPatchV4(buildPatchN3AddHuigun(version), opts());
    assert(res.ok, `Patch N+3 failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    assert(
      queryRow(files.sqlitePath, `SELECT 1 FROM term WHERE word = ?`, [PATCH_V4_HUIGUN_WORD]),
      '回滚 term exists'
    );
  });

  await test('Patch N+4: weight merge max(existing,incoming)', async () => {
    const res = await applyLexiconPatchV4(
      buildPatchN4AppendYuyueTechAiLowWeight(version, yuyueTermId),
      opts()
    );
    assert(res.ok, `Patch N+4 failed: ${res.errorCode} ${res.message}`);
    version = res.bundleVersion;
    const tech = domainTagsForTerm(files.sqlitePath, yuyueTermId).find((r) => r.domain_id === 'tech_ai');
    assert(tech?.weight === 0.6, 'weight stays max 0.6 not 0.3');
  });

  await test('Legacy V3 Patch A still applies', async () => {
    const res = await applyLexiconPatchV3(buildPatchA(version), opts());
    assert(res.ok, `V3 legacy failed: ${res.errorCode} ${res.message}`);
  });

  assert(verifyChecksumAligned(files), 'checksum not aligned with manifest');

  console.log(`[patch-v4-e2e] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[patch-v4-e2e]', err);
  process.exit(1);
});
