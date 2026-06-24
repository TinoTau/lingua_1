#!/usr/bin/env node
/**
 * Build exp-v1_1-alias-cleanup patch — replace illegal aliases with Contract-legal set only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pinyin } from 'pinyin-pro';

const require = createRequire(import.meta.url);
const { P1_TERMS, P1_5_ALIAS_TERMS, EXISTING_TERM_ID_BY_WORD } = require('./terms-manifest.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(root, '../..');
const distHash = path.join(root, 'dist/main/electron-node/main/src/lexicon-patch-v3/patch-hash.js');
const patchesDir = path.join(__dirname, 'patches');

function aliasPayload(entry) {
  if (entry.aliasEntries?.length) {
    const aliases = [...new Set(entry.aliasEntries.map((e) => e.alias))];
    return { aliasEntries: entry.aliasEntries, aliases };
  }
  return { aliases: [] };
}

function domainWeights(tags) {
  const w = {};
  for (const t of tags) {
    w[t] = 1.0;
  }
  return w;
}

function cleanupOp(entry, termIdOverride) {
  const termId = termIdOverride || entry.termId;
  const tags = entry.domainTags;
  const aliasPart = aliasPayload(entry);
  return {
    op: 'update',
    table: 'term',
    word: entry.word,
    termId,
    fields: {
      priorScore: entry.priorScore,
      repairTarget: true,
      enabled: true,
      domainTags: tags,
      domainWeights: domainWeights(tags),
      aliasesReplace: true,
      aliases: aliasPart.aliases ?? [],
      ...aliasPart,
    },
  };
}

function readBundleVersion() {
  const manifestPath = path.join(repoRoot, 'node_runtime/lexicon/v3/manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).bundleVersion;
}

function main() {
  if (!fs.existsSync(distHash)) {
    throw new Error('Run npm run build:main before build-alias-cleanup-patch.mjs');
  }
  const { computePatchHash } = require(distHash);
  const bundleVersion = readBundleVersion();

  const ops = [];
  for (const entry of P1_TERMS) {
    if (entry.termId === 'exp-v1_1-liantiao' || entry.termId === 'exp-v1_1-qiaokeli') {
      ops.push(cleanupOp(entry, entry.termId));
    }
  }
  for (const entry of P1_5_ALIAS_TERMS) {
    const termId = EXISTING_TERM_ID_BY_WORD[entry.word] || entry.termId;
    ops.push(cleanupOp(entry, termId));
  }

  const patch = {
    patchId: 'exp-v1_1-alias-cleanup',
    baseVersion: bundleVersion,
    nextVersion: bundleVersion + 1,
    hash: '',
    operations: ops,
  };
  patch.hash = computePatchHash(patch);

  fs.mkdirSync(patchesDir, { recursive: true });
  const outPath = path.join(patchesDir, 'exp-v1_1-alias-cleanup.patch.json');
  fs.writeFileSync(outPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
  console.log('[alias-cleanup] wrote', outPath, 'ops', ops.length, 'baseVersion', bundleVersion);
}

main();
