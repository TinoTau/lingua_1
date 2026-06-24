#!/usr/bin/env node
/**
 * Build Expansion V1.1 patch JSON + append JSONL rows (Option B · Addendum v1.2.1).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { pinyin } from 'pinyin-pro';

const require = createRequire(import.meta.url);
const { DENY_LIST, P1_TERMS, P1_5_ALIAS_TERMS, EXISTING_TERM_ID_BY_WORD } = require('./terms-manifest.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(root, '../..');
const distHash = path.join(
  root,
  'dist/main/electron-node/main/src/lexicon-patch-v3/patch-hash.js'
);
const patchesDir = path.join(__dirname, 'patches');
const jsonlPath = path.join(
  repoRoot,
  'electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/domain_patch_multidomain_v1/entries.jsonl'
);

function aliasStrings(entry) {
  if (entry.aliasEntries?.length) {
    return entry.aliasEntries.map((e) => e.alias);
  }
  return entry.aliases || [];
}

function aliasPayload(entry) {
  if (entry.aliasEntries?.length) {
    const aliases = [...new Set(entry.aliasEntries.map((e) => e.alias))];
    return { aliasEntries: entry.aliasEntries, aliases };
  }
  const aliases = entry.aliases?.length ? [...new Set(entry.aliases)] : undefined;
  return aliases?.length ? { aliases } : {};
}

function assertGranularity(word, entryOrAliases = []) {
  const aliases = Array.isArray(entryOrAliases) ? entryOrAliases : aliasStrings(entryOrAliases);
  if (DENY_LIST.includes(word)) {
    throw new Error(`P0 denylist hit: ${word}`);
  }
  const cjk = [...word].filter((c) => /[\u4e00-\u9fff]/.test(c));
  if (cjk.length > 5) {
    throw new Error(`P0 length > 5: ${word}`);
  }
  for (const alias of aliases) {
    if (DENY_LIST.includes(alias)) {
      throw new Error(`P0 denylist alias: ${alias}`);
    }
    const al = [...alias].filter((c) => /[\u4e00-\u9fff]/.test(c));
    if (al.length > 5) {
      throw new Error(`P0 alias length > 5: ${alias}`);
    }
  }
}

function pinyinKey(word) {
  const arr = pinyin(word, { toneType: 'none', type: 'array' });
  return arr.map((s) => s.toLowerCase()).join('|');
}

function tonePinyinKey(word) {
  const arr = pinyin(word, { toneType: 'num', type: 'array' });
  return arr.join('|');
}

function tonePinyinSpaced(word) {
  return pinyin(word, { toneType: 'num', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function pinyinSpaced(word) {
  return pinyin(word, { toneType: 'none', type: 'string' }).replace(/\s+/g, ' ').trim();
}

function domainWeights(tags) {
  const w = {};
  for (const t of tags) {
    w[t] = 1.0;
  }
  return w;
}

function termToOp(entry) {
  assertGranularity(entry.word, entry);
  const tags = entry.domainTags;
  return {
    op: 'add',
    table: 'term',
    word: entry.word,
    entry: {
      termId: entry.termId,
      word: entry.word,
      pinyinKey: pinyinKey(entry.word),
      tonePinyinKey: tonePinyinKey(entry.word),
      priorScore: entry.priorScore,
      repairTarget: true,
      enabled: true,
      source: 'expansion_v1_1',
      domainTags: tags,
      domainWeights: domainWeights(tags),
      ...aliasPayload(entry),
    },
  };
}

function p15ToOp(entry) {
  assertGranularity(entry.word, entry);
  const tags = entry.domainTags;
  const existingTermId = EXISTING_TERM_ID_BY_WORD[entry.word];
  const aliasPart = aliasPayload(entry);
  if (existingTermId) {
    return {
      op: 'update',
      table: 'term',
      word: entry.word,
      termId: existingTermId,
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
  return termToOp(entry);
}

function termToJsonl(entry) {
  assertGranularity(entry.word, entry);
  const tags = entry.domainTags;
  return JSON.stringify({
    word: entry.word,
    pinyin: pinyinSpaced(entry.word),
    tone_pinyin: tonePinyinSpaced(entry.word),
    domain_tags: tags,
    domain_weights: domainWeights(tags),
    source: 'expansion_v1_1',
    repair_target: true,
    lexiconLayer: 'domain_patch',
  });
}

function buildPatch(patchId, baseVersion, operations) {
  const patch = {
    patchId,
    baseVersion,
    nextVersion: baseVersion + 1,
    hash: '',
    operations,
  };
  if (!fs.existsSync(distHash)) {
    throw new Error('Run npm run build:main before build-expansion-patches.mjs');
  }
  const { computePatchHash } = require(distHash);
  patch.hash = computePatchHash(patch);
  return patch;
}

function readBundleVersion() {
  const manifestPath = path.join(repoRoot, 'node_runtime/lexicon/v3/manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return m.bundleVersion;
}

function main() {
  const patchBOnly = process.argv.includes('--patch-b-only');
  const bundleVersion = readBundleVersion();
  const p1Ops = P1_TERMS.map(termToOp);
  const p15Ops = P1_5_ALIAS_TERMS.map(p15ToOp);

  if (patchBOnly) {
    const patchB = buildPatch('exp-v1_1-p1_5-alias', bundleVersion, p15Ops);
    fs.mkdirSync(patchesDir, { recursive: true });
    fs.writeFileSync(
      path.join(patchesDir, 'exp-v1_1-p1_5-alias.patch.json'),
      `${JSON.stringify(patchB, null, 2)}\n`,
      'utf8'
    );
    console.log('[expansion-v1_1] Patch B baseVersion', bundleVersion, 'ops', p15Ops.length);
    console.log('[expansion-v1_1] wrote patches →', patchesDir);
    return;
  }

  const patchA = buildPatch('exp-v1_1-p1-terms', bundleVersion, p1Ops);
  const patchB = buildPatch('exp-v1_1-p1_5-alias', bundleVersion + 1, p15Ops);

  fs.mkdirSync(patchesDir, { recursive: true });
  fs.writeFileSync(
    path.join(patchesDir, 'exp-v1_1-p1-terms.patch.json'),
    `${JSON.stringify(patchA, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(patchesDir, 'exp-v1_1-p1_5-alias.patch.json'),
    `${JSON.stringify(patchB, null, 2)}\n`,
    'utf8'
  );

  const jsonlLines = P1_TERMS.map(termToJsonl);
  const existing = fs.existsSync(jsonlPath)
    ? fs.readFileSync(jsonlPath, 'utf8').trim()
    : '';
  if (existing.includes('"source":"expansion_v1_1"')) {
    console.log('[expansion-v1_1] JSONL already contains expansion_v1_1 rows, skip append');
  } else {
    const block = `${existing ? `${existing}\n` : ''}${jsonlLines.join('\n')}\n`;
    fs.writeFileSync(jsonlPath, block, 'utf8');
    console.log('[expansion-v1_1] appended', jsonlLines.length, 'JSONL rows →', jsonlPath);
  }

  console.log('[expansion-v1_1] Patch A baseVersion', bundleVersion, 'ops', p1Ops.length);
  console.log('[expansion-v1_1] Patch B baseVersion', bundleVersion + 1, 'ops', p15Ops.length);
  console.log('[expansion-v1_1] wrote patches →', patchesDir);
}

main();
