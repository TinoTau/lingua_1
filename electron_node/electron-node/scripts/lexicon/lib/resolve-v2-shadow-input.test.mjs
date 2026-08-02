#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { repoRoot, resolveV2ShadowInputFiles } from './paths.mjs';
import { classifyLexiconV2Row, loadRegistry } from './v2-classify-row.mjs';
import { loadJsonlInputs } from './read-jsonl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makePack(root, packName, rows) {
  const dir = path.join(root, packName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'entries.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  );
}

function testResolveAssetRoot() {
  const assetRoot = path.join(
    repoRoot(),
    'electron_node',
    'docs',
    'lexicon-assets',
    'p1_3_generic_zh_lexicon_v2_fw_domains',
    'p1_3_lexicon_zh_v2'
  );
  if (!fs.existsSync(assetRoot)) {
    console.log('[resolve-v2-shadow-input] SKIP asset root test (path missing)');
    return;
  }

  const files = resolveV2ShadowInputFiles(assetRoot);
  const rels = files.map((file) => path.relative(assetRoot, file));
  assert.ok(rels.includes(path.join('base_zh_v2', 'entries.jsonl')));
  assert.ok(rels.includes(path.join('idiom_zh_v2', 'entries.jsonl')));
  assert.ok(rels.includes(path.join('common5_zh_v2', 'entries.jsonl')));
  assert.ok(rels.includes(path.join('domain_patch_zh_v2', 'entries.jsonl')));
  assert.ok(!rels.some((rel) => rel.includes('combined_entries.jsonl')));
}

function testResolveTmpTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-v2-input-'));
  makePack(tmp, 'base_zh_v2', [
    {
      type: 'canonical_term',
      word: '测试',
      pinyin: 'ce shi',
      priorScore: 0.9,
      repairTarget: true,
      enabled: true,
      domains: ['travel'],
      lexiconLayer: 'base',
    },
  ]);
  makePack(tmp, 'domain_patch_restaurant', [
    {
      type: 'canonical_term',
      word: '拿铁',
      pinyin: 'na tie',
      priorScore: 0.95,
      repairTarget: true,
      enabled: true,
      domains: ['restaurant'],
      lexiconLayer: 'domain_patch',
    },
  ]);
  fs.writeFileSync(path.join(tmp, 'combined_entries.jsonl'), '{"type":"canonical_term","word":"skip"}\n');

  const files = resolveV2ShadowInputFiles(tmp);
  assert.strictEqual(files.length, 2);
  assert.ok(files.every((file) => path.basename(file) === 'entries.jsonl'));

  fs.rmSync(tmp, { recursive: true, force: true });
}

function testBuildDomainRows() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lex-v2-build-'));
  const seedRoot = path.join(tmp, 'seed');
  makePack(seedRoot, 'domain_patch_zh_v2', [
    {
      type: 'canonical_term',
      termId: 'patch-1',
      word: '拿铁',
      pinyin: 'na tie',
      priorScore: 0.95,
      repairTarget: true,
      enabled: true,
      domains: ['restaurant'],
      lexiconLayer: 'domain_patch',
      aliases: ['那铁'],
    },
  ]);

  const registry = loadRegistry(
    path.join(repoRoot(), 'electron_node', 'electron-node', 'data', 'lexicon', 'profile-registry.json')
  );
  const inputFiles = resolveV2ShadowInputFiles(seedRoot);
  const { rows } = loadJsonlInputs(inputFiles);
  const domainClassifications = rows.map((entry) => classifyLexiconV2Row(entry, registry));

  assert.ok(domainClassifications.every((c) => c.tier === 'domain'));
  assert.ok(domainClassifications.every((c) => c.domainIds.includes('restaurant')));

  fs.rmSync(tmp, { recursive: true, force: true });
}

testResolveAssetRoot();
testResolveTmpTree();
testBuildDomainRows();
console.log('[resolve-v2-shadow-input] PASS');
