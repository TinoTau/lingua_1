#!/usr/bin/env node
/**
 * Formalize Full Rebuild Source SSOT: verify hashes vs tmp extract, write sources.manifest.json.
 * Does NOT modify CSV content.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { electronNodeRoot, repoRoot } from './lib/paths.mjs';

const root = electronNodeRoot();
const repo = repoRoot();
const formalDir = path.join(root, '../docs/lexicon-assets/full_rebuild_v1');
const tmpDir = path.join(repo, 'tmp/lexicon_corrected_review_20260718_extract');

const FILES = [
  'lexicon_full_corrected_review.csv',
  'term_domain_tags_corrected.csv',
  'supplemental_terms.csv',
  'terms_to_remove_or_rebuild.csv',
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function countLines(p) {
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1);
}

fs.mkdirSync(formalDir, { recursive: true });

const sources = [];
for (const name of FILES) {
  const formalPath = path.join(formalDir, name);
  const tmpPath = path.join(tmpDir, name);
  if (!fs.existsSync(formalPath)) {
    if (!fs.existsSync(tmpPath)) throw new Error(`missing ${name}`);
    fs.copyFileSync(tmpPath, formalPath);
  }
  const formalHash = sha256File(formalPath);
  const tmpHash = fs.existsSync(tmpPath) ? sha256File(tmpPath) : null;
  if (tmpHash && tmpHash !== formalHash) {
    throw new Error(`hash mismatch ${name}: formal=${formalHash} tmp=${tmpHash}`);
  }
  const rows = countLines(formalPath);
  sources.push({
    file: name,
    relativePath: path
      .relative(repo, formalPath)
      .replace(/\\/g, '/'),
    sha256: `sha256:${formalHash}`,
    recordCount: rows,
    matchesTmpExtract: tmpHash === formalHash,
  });
  console.log(`[formalize] ${name} rows=${rows} sha256=${formalHash.slice(0, 16)}… tmpMatch=${tmpHash === formalHash}`);
}

const idiomPath = path.join(
  root,
  '../docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/idiom_zh_v2/entries.jsonl'
);
const registryPath = path.join(root, 'data/lexicon/profile-registry.json');
if (!fs.existsSync(idiomPath)) throw new Error(`missing idiom source ${idiomPath}`);
if (!fs.existsSync(registryPath)) throw new Error(`missing registry ${registryPath}`);

const idiomHash = sha256File(idiomPath);
const idiomLines = fs.readFileSync(idiomPath, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
const registryHash = sha256File(registryPath);

const manifest = {
  schemaVersion: 'lexicon-full-rebuild-sources-v1',
  rebuildMode: 'FULL_REBUILD',
  contentBundleVersion: 11,
  loadOrder: [
    'lexicon_full_corrected_review.csv',
    'terms_to_remove_or_rebuild.csv',
    'supplemental_terms.csv',
    'term_domain_tags_corrected.csv',
    'idiom_zh_v2/entries.jsonl',
    'profile-registry.json',
  ],
  termSources: sources,
  idiomSource: {
    relativePath: path.relative(repo, idiomPath).replace(/\\/g, '/'),
    sha256: `sha256:${idiomHash}`,
    recordCount: idiomLines,
    purpose: 'idiom_lexicon SSOT (4-char idioms)',
  },
  hierarchySource: {
    relativePath: path.relative(repo, registryPath).replace(/\\/g, '/'),
    sha256: `sha256:${registryHash}`,
    purpose: 'domain_hierarchy edges from profile-registry parent links',
  },
  columns: {
    lexicon_full_corrected_review: [
      'term_id',
      'word',
      'pinyin_key',
      'tone_pinyin_key',
      'source',
      'prior_score',
      'before_tags',
      'corrected_tags',
      'tag_count',
      'term_status',
      'confidence',
      'shape_flags',
      'notes',
      'term_type?',
      'exception_reason?',
    ],
    term_domain_tags_corrected: ['term_id', 'word', 'domain_id', 'weight', 'source', 'confidence'],
    supplemental_terms: ['word', 'domain_id', 'weight', 'source', 'reason', 'term_type?', 'exception_reason?'],
    terms_to_remove_or_rebuild: 'same as review; excluded from import; no termType required',
  },
  optionalAtomicityColumns: {
    term_type: 'optional on review + supplemental only; tags/remove list do not need it',
    exception_reason: 'required together with term_type for ACCEPT_EXCEPTION',
    missingFields:
      'absent columns parse as undefined; Validator audit reports UNRESOLVED/REJECT without deleting rows',
  },
  notes: [
    'ATOMICITY CONTENT CLEANUP NOT EXECUTED — sources include existing composites such as 上线计划/接口文档.',
    'tmp/ extract is archival only; formal build MUST read this directory.',
    'Optional term_type/exception_reason columns may be added later; existing CSV row content unchanged this round.',
  ],
};

fs.writeFileSync(path.join(formalDir, 'sources.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(
  path.join(formalDir, 'README.md'),
  `# Full Rebuild Source SSOT (v1)

**PRODUCTION FULL REBUILD INPUT** — not seed-only shadow.

| File | Purpose |
|------|---------|
| lexicon_full_corrected_review.csv | Primary term SSOT |
| terms_to_remove_or_rebuild.csv | Exclude list |
| supplemental_terms.csv | +73 terms / tags |
| term_domain_tags_corrected.csv | Domain tags |
| sources.manifest.json | Hashes + load order |

Idiom SSOT: \`p1_3_.../idiom_zh_v2/entries.jsonl\`  
Hierarchy SSOT: \`electron_node/electron-node/data/lexicon/profile-registry.json\`

Build: \`npm run lexicon:full-rebuild\` (from electron_node/electron-node).

Do **not** use \`lexicon:build:v2-shadow\` + \`prepare:v3-runtime\` for production.
`
);

console.log('[formalize] wrote', path.join(formalDir, 'sources.manifest.json'));
