#!/usr/bin/env node
/**
 * Recover 统一联调前准备：
 * 1) electron-rebuild better-sqlite3
 * 2) 生成热词 bundle
 * 3) 校验 bundle schema
 * 4) 启用 %APPDATA% lexiconRecall
 * 5) build:main
 *
 * 用法（在 electron-node 目录）：
 *   node scripts/prepare-recover-test.mjs
 *   set PROJECT_ROOT=D:\Programs\github\lingua_1
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronNodeRoot = path.resolve(__dirname, '..');
/** lingua_1 仓库根（与 init-lexicon-bundle.mjs 一致） */
const repoRoot = path.resolve(__dirname, '../../..');
const bundleDir = path.join(repoRoot, 'node_runtime', 'lexicon', 'current');
const sqlitePath = path.join(bundleDir, 'lexicon.sqlite');

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || electronNodeRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, PROJECT_ROOT: repoRoot, ...opts.env },
  });
  if (r.status !== 0) {
    throw new Error(`命令失败: ${cmd} ${args.join(' ')} (exit ${r.status})`);
  }
}

function ensureLexiconConfig() {
  const appData = process.env.APPDATA;
  if (!appData) {
    console.warn('APPDATA 未设置，跳过写 electron-node-config.json');
    return;
  }
  const dir = path.join(appData, 'lingua-electron-node');
  const cfgPath = path.join(dir, 'electron-node-config.json');
  fs.mkdirSync(dir, { recursive: true });
  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  cfg.features = cfg.features || {};
  cfg.features.lexiconRecall = {
    maxReplacements: 2,
    minPhoneticScore: 0.85,
    ...cfg.features.lexiconRecall,
    enabled: true,
  };
  cfg.servicePreferences = {
    ...(cfg.servicePreferences || {}),
    'faster-whisper-vad': true,
    'asr-sherpa-lm': true,
    'nmt-m2m100': true,
  };
  cfg.testServer = { port: 5020, ...cfg.testServer };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('已更新配置:', cfgPath);
  console.log('  features.lexiconRecall:', JSON.stringify(cfg.features.lexiconRecall));
}

async function verifyBundleSchema() {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(sqlitePath, { readonly: true });
  const cols = db.prepare(`PRAGMA table_info(lexicon_terms)`).all().map((r) => r.name);
  const required = ['id', 'word', 'pinyin', 'frequency', 'enabled'];
  for (const c of required) {
    if (!cols.includes(c)) {
      db.close();
      throw new Error(`lexicon_terms 缺少列 ${c}，请重新运行 init-lexicon-bundle.mjs`);
    }
  }
  const hwCount = db.prepare(`SELECT COUNT(*) AS n FROM lexicon_terms WHERE enabled=1`).get().n;
  const cfCount = db
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='lexicon_confusions'`)
    .get();
  let confusionRows = 0;
  if (cfCount.n) {
    confusionRows = db.prepare(`SELECT COUNT(*) AS n FROM lexicon_confusions WHERE enabled=1`).get().n;
  }
  db.close();
  console.log(`Bundle OK: hotwords=${hwCount} confusions=${confusionRows}`);
  console.log('  path:', bundleDir);
}

async function main() {
  console.log('='.repeat(60));
  console.log('Recover 测试准备');
  console.log('='.repeat(60));
  console.log('PROJECT_ROOT →', repoRoot);
  console.log('Bundle dir   →', bundleDir);

  process.env.PROJECT_ROOT = repoRoot;

  run('npm', ['rebuild', 'better-sqlite3']);
  run('node', ['scripts/build-lexicon-bundle.mjs']);

  if (!fs.existsSync(sqlitePath)) {
    throw new Error('lexicon.sqlite 未生成: ' + sqlitePath);
  }
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(sqlitePath)).digest('hex');
  const manifestPath = path.join(bundleDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.checksum !== checksum) {
    fs.writeFileSync(path.join(bundleDir, 'checksum.txt'), checksum);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, checksum, version: 'dev-local-hotword-v1' }, null, 2)
    );
    console.log('已同步 manifest checksum');
  }

  await verifyBundleSchema();
  ensureLexiconConfig();

  const lmCandidates = [
    process.env.CHAR_LM_PATH,
    path.join(repoRoot, 'electron_node', 'services', 'asr_sherpa_lm', 'models', 'kenLM', 'zh_char_3gram.trie.bin'),
    path.join(repoRoot, 'kenLM', 'model', 'zh_char_3gram.trie.bin'),
    path.join(repoRoot, 'models', 'kenlm', 'zh_char_3gram', 'zh_char_3gram.trie.bin'),
    path.join(electronNodeRoot, 'assets', 'models', 'zh_char_3gram.trie.bin'),
  ].filter(Boolean);
  const lmHit = lmCandidates.find((p) => fs.existsSync(p));
  if (lmHit) {
    console.log('Sentence KenLM trie:', lmHit);
    if (!process.env.CHAR_LM_PATH) {
      console.log('  提示: set CHAR_LM_PATH=' + lmHit);
    }
  } else {
    console.warn('Sentence KenLM 未找到（fail-open；非 CTC asr_kenlm_meta）');
    console.warn('  训练: bash scripts/kenlm/train_zh_char_3gram.sh (WSL/Linux)');
    console.warn('  或设置 CHAR_LM_PATH → models/kenlm/zh_char_3gram/zh_char_3gram.trie.bin');
  }

  run('npm', ['run', 'build:main']);

  try {
    run('npx', ['@electron/rebuild', '-f', '-w', 'better-sqlite3']);
  } catch (e) {
    console.warn('@electron/rebuild 失败（启动节点前请手动执行）:', e.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('准备完成。下一步：');
  console.log('  1) set PROJECT_ROOT=' + repoRoot);
  console.log('  2) npm run start   # 节点 + test server 5020');
  console.log('  3) node tests/run-dialog-200-batch.js');
  console.log('  4) node tests/run-homophone-expectation.js tests/dialog-200-batch-result.json');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
