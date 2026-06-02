/**
 * Lexicon V3.1 Patch Apply E2E + Recall Smoke (temp bundle copy).
 */
import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { applyLexiconPatchV3 } from './patch-service';
import { handleLexiconApplyPatchHttp } from './apply-patch-http';
import { copyV3BundleToTemp, readBundleSnapshot } from './bundle-snapshot';
import {
  buildPatchA,
  buildPatchB,
  buildPatchC,
  buildPatchD,
  buildPatchE,
  buildPatchGWrongVersion,
  buildPatchHInvalidDomain,
  buildPatchRollbackProbe,
  PATCH_KEYS,
  PATCH_WORDS,
} from './patch-fixtures';
import {
  patchHistoryCount,
  queryRow,
  readManifestBundleVersion,
  verifyChecksumAligned,
} from './patch-bundle-verify';
import { resolveLexiconV3BundleFiles } from './bundle-io';
import { runRecallSmoke } from './patch-recall-smoke';
import * as sqliteGate from './sqlite-gate';

const PROJECT_ROOT =
  process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../../../..');
const V3_SOURCE = path.join(PROJECT_ROOT, 'node_runtime', 'lexicon', 'v3');

function canOpenSqlite(): boolean {
  try {
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const describeE2e = fs.existsSync(V3_SOURCE) ? describe : describe.skip;

describeE2e('lexicon-patch-v3 e2e', () => {
  let tempDir: string;
  let version: number;
  let snapBefore: ReturnType<typeof readBundleSnapshot>;

  beforeAll(() => {
    tempDir = copyV3BundleToTemp(V3_SOURCE);
    version = readManifestBundleVersion(resolveLexiconV3BundleFiles(tempDir).manifestPath);
    snapBefore = readBundleSnapshot(tempDir);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const opts = () => ({ bundleDir: tempDir, reload: false });

  it('Patch A: base add', async () => {
    const res = await applyLexiconPatchV3(buildPatchA(version), opts());
    expect(res.ok).toBe(true);
    version = res.bundleVersion!;
    const row = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT prior_score, enabled, repair_target FROM base_lexicon WHERE pinyin_key = ? AND word = ?`,
      [PATCH_KEYS.basePinyin, PATCH_WORDS.base]
    );
    expect(row?.prior_score).toBe(0.95);
    expect(row?.enabled).toBe(1);
    expect(row?.repair_target).toBe(1);
  });

  it('Patch B: domain add + alias + routing', async () => {
    const res = await applyLexiconPatchV3(buildPatchB(version), opts());
    expect(res.ok).toBe(true);
    version = res.bundleVersion!;
    const files = resolveLexiconV3BundleFiles(tempDir);
    const canonical = queryRow(
      files.sqlitePath,
      `SELECT * FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
      [PATCH_WORDS.domain]
    );
    expect(canonical).toBeTruthy();
    const alias = queryRow(
      files.sqlitePath,
      `SELECT canonical_word, enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
      [PATCH_WORDS.domainAlias]
    );
    expect(alias?.canonical_word).toBe(PATCH_WORDS.domain);
    const route = queryRow(
      files.sqlitePath,
      `SELECT * FROM industry_routing_lexicon WHERE domain_id = 'travel' AND keyword = ?`,
      [PATCH_WORDS.domain]
    );
    expect(route).toBeTruthy();
  });

  it('Patch C: domain priorScore update', async () => {
    const res = await applyLexiconPatchV3(buildPatchC(version), opts());
    expect(res.ok).toBe(true);
    version = res.bundleVersion!;
    const row = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT prior_score FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
      [PATCH_WORDS.domain]
    );
    expect(row?.prior_score).toBe(0.98);
  });

  it('Recall smoke: base + domain + alias hit', () => {
    const files = resolveLexiconV3BundleFiles(tempDir);
    const aliasRow = queryRow(
      files.sqlitePath,
      `SELECT pinyin_key FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
      [PATCH_WORDS.domainAlias]
    );
    const aliasPinyin = String(aliasRow?.pinyin_key ?? '');
    expect(aliasPinyin.length).toBeGreaterThan(0);
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
        pinyinKey: PATCH_KEYS.domainPinyin,
        termLength: PATCH_WORDS.domain.length,
        expectWord: PATCH_WORDS.domain,
        expectHit: true,
      },
      {
        label: 'domain alias',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: aliasPinyin,
        termLength: PATCH_WORDS.domainAlias.length,
        expectWord: PATCH_WORDS.domainAlias,
        expectHit: true,
      },
    ]);
    expect(rows.every((r) => r.passed)).toBe(true);
  });

  it('Patch D: domain disable', async () => {
    const res = await applyLexiconPatchV3(buildPatchD(version), opts());
    expect(res.ok).toBe(true);
    version = res.bundleVersion!;
    const files = resolveLexiconV3BundleFiles(tempDir);
    const canonical = queryRow(
      files.sqlitePath,
      `SELECT enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 0`,
      [PATCH_WORDS.domain]
    );
    expect(canonical?.enabled).toBe(0);
    const alias = queryRow(
      files.sqlitePath,
      `SELECT enabled FROM domain_lexicon WHERE domain_id = 'travel' AND word = ? AND is_alias = 1`,
      [PATCH_WORDS.domainAlias]
    );
    expect(alias?.enabled).toBe(0);
    const route = queryRow(
      files.sqlitePath,
      `SELECT * FROM industry_routing_lexicon WHERE domain_id = 'travel' AND keyword = ?`,
      [PATCH_WORDS.domain]
    );
    expect(route).toBeFalsy();
    const smoke = runRecallSmoke(tempDir, [
      {
        label: 'domain disabled',
        tier: 'domain',
        domainId: 'travel',
        pinyinKey: PATCH_KEYS.domainPinyin,
        termLength: PATCH_WORDS.domain.length,
        expectWord: PATCH_WORDS.domain,
        expectHit: false,
      },
    ]);
    expect(smoke[0].passed).toBe(true);
  });

  it('manifest/stats/checksum updated after apply', () => {
    const files = resolveLexiconV3BundleFiles(tempDir);
    const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf-8')) as {
      lastPatchId?: string;
      lastAppliedAt?: string;
      bundleVersion?: number;
    };
    expect(manifest.lastPatchId).toBeTruthy();
    expect(manifest.lastAppliedAt).toBeTruthy();
    expect(manifest.bundleVersion).toBe(version);
    expect(verifyChecksumAligned(files)).toBe(true);
  });

  it('HTTP handler uses PatchService', async () => {
    const patch = buildPatchA(version);
    const http = await handleLexiconApplyPatchHttp(patch, opts());
    expect(http.status).toBe(400);
    expect(http.body.ok).toBe(false);
    expect(http.body.errorCode).toBe('patch_already_applied');
  });

  it('Patch F: duplicate patchId rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const patchA = buildPatchA(version);
    const res = await applyLexiconPatchV3(patchA, opts());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('patch_already_applied');
    const snapAfter = readBundleSnapshot(tempDir);
    expect(snapAfter.checksum).toBe(snap.checksum);
    expect(readManifestBundleVersion(resolveLexiconV3BundleFiles(tempDir).manifestPath)).toBe(version);
  });

  it('Patch G: wrong baseVersion rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const histBefore = patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath);
    const res = await applyLexiconPatchV3(buildPatchGWrongVersion(version), opts());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('version_mismatch');
    const snapAfter = readBundleSnapshot(tempDir);
    expect(snapAfter.checksum).toBe(snap.checksum);
    expect(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath)).toBe(histBefore);
  });

  it('Patch H: invalid domain rejected', async () => {
    const snap = readBundleSnapshot(tempDir);
    const res = await applyLexiconPatchV3(buildPatchHInvalidDomain(version), opts());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('invalid_domain');
    expect(readBundleSnapshot(tempDir).checksum).toBe(snap.checksum);
  });

  it('Patch E: base delete + patch_history', async () => {
    const res = await applyLexiconPatchV3(buildPatchE(version), opts());
    expect(res.ok).toBe(true);
    version = res.bundleVersion!;
    const row = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT 1 FROM base_lexicon WHERE word = ?`,
      [PATCH_WORDS.base]
    );
    expect(row).toBeFalsy();
    expect(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath)).toBeGreaterThan(0);
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
    expect(smoke[0].passed).toBe(true);
  });

  it('rollback: transaction failure leaves bundle unchanged', async () => {
    const snap = readBundleSnapshot(tempDir);
    const histBefore = patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath);
    const gateSpy = jest
      .spyOn(sqliteGate, 'assertTableThresholds')
      .mockImplementation(() => {
        throw new Error('gate_fail_test');
      });
    const res = await applyLexiconPatchV3(buildPatchRollbackProbe(version), opts());
    gateSpy.mockRestore();
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('apply_transaction_failed');
    const probe = queryRow(
      resolveLexiconV3BundleFiles(tempDir).sqlitePath,
      `SELECT 1 FROM base_lexicon WHERE word = ?`,
      ['回滚探测词']
    );
    expect(probe).toBeFalsy();
    expect(readBundleSnapshot(tempDir).checksum).toBe(snap.checksum);
    expect(patchHistoryCount(resolveLexiconV3BundleFiles(tempDir).sqlitePath)).toBe(histBefore);
  });
});
