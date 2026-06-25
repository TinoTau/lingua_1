#!/usr/bin/env node
/**
 * Industry Expansion Pack V1 — Patch V4 builder (V1.1 Addendum §7).
 *
 * Usage:
 *   npm run build:main
 *   npm run lexicon:industry-pack-v1:build -- --patch-id industry-pack-v1-wave1-pilot [--wave wave1]
 *
 * Options:
 *   --patch-id <id>        required
 *   --entries <path>       default: docs/lexicon-assets/industry_pack_v1/entries.jsonl
 *   --out <dir>            default: docs/lexicon-assets/industry_pack_v1/patches
 *   --wave <name>          only rows with matching "wave" field
 *   --base-version <n>     default: node_runtime manifest bundleVersion
 *   --sqlite <path>        default: node_runtime/lexicon/v3/lexicon.sqlite (readonly term index)
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { PATCH_SCHEMA_VERSION_V4 } from './lib/constants.mjs';
import { validateIndustryEntry } from './lib/validate-entry.mjs';
import {
  pinyinKeyFromField,
  tonePinyinKeyFromField,
  tonePinyinKeyFromWord,
} from './lib/pinyin-keys.mjs';
import { loadTermIndex, resolvePinyinKeyForEntry } from './lib/term-index.mjs';
import { computeTableThresholds } from './lib/table-thresholds.mjs';
import { measurePatchTableThresholds } from './lib/measure-patch-table-thresholds.mjs';
import { electronNodeRoot, repoRoot, defaultRegistryPath, v3RuntimeDir } from '../lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DEFAULT_ENTRIES = path.join(
  repoRoot(),
  'electron_node',
  'docs',
  'lexicon-assets',
  'industry_pack_v1',
  'entries.jsonl'
);

function parseArgs(argv) {
  const out = {
    patchId: '',
    entries: DEFAULT_ENTRIES,
    outDir: path.join(path.dirname(DEFAULT_ENTRIES), 'patches'),
    wave: '',
    baseVersion: null,
    sqlite: path.join(v3RuntimeDir(), 'lexicon.sqlite'),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--patch-id' && argv[i + 1]) {
      out.patchId = argv[++i];
    } else if (a === '--entries' && argv[i + 1]) {
      out.entries = path.resolve(argv[++i]);
    } else if (a === '--out' && argv[i + 1]) {
      out.outDir = path.resolve(argv[++i]);
    } else if (a === '--wave' && argv[i + 1]) {
      out.wave = argv[++i];
    } else if (a === '--base-version' && argv[i + 1]) {
      out.baseVersion = Number(argv[++i]);
    } else if (a === '--sqlite' && argv[i + 1]) {
      out.sqlite = path.resolve(argv[++i]);
    } else if (a === '--no-sqlite') {
      out.sqlite = '';
    }
  }

  return out;
}

function loadRegisteredDomains(registryPath) {
  const rows = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  return new Set(rows.map((r) => r.id));
}

function readBundleVersion() {
  const manifestPath = path.join(v3RuntimeDir(), 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { bundleVersion: m.bundleVersion, tables: m.tables ?? {} };
}

function loadEntries(entriesPath, waveFilter) {
  const lines = fs.readFileSync(entriesPath, 'utf8').split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    const row = JSON.parse(line);
    if (waveFilter && row.wave !== waveFilter) {
      continue;
    }
    entries.push({ row, lineNo: i + 1 });
  }
  return entries;
}

function buildOperations(entries, registeredDomains, termIndex) {
  const operations = [];
  const report = {
    addTerm: 0,
    appendDomainTags: 0,
    addLegalAlias: 0,
    rejected: [],
    rows: [],
  };

  for (const { row, lineNo } of entries) {
    const valid = validateIndustryEntry(row, registeredDomains, lineNo);
    if (!valid.ok) {
      if (valid.code === 'deprecated') {
        continue;
      }
      report.rejected.push({ lineNo, word: row.word, code: valid.code, message: valid.message });
      continue;
    }

    const pinyinKey = resolvePinyinKeyForEntry(row);
    if (!pinyinKey) {
      report.rejected.push({
        lineNo,
        word: valid.word,
        code: 'missing_pinyin_key',
        message: `line ${lineNo}: cannot resolve pinyin_key`,
      });
      continue;
    }

    const toneKey =
      row.tone_pinyin_key?.trim() ||
      tonePinyinKeyFromField(valid.tone_pinyin) ||
      tonePinyinKeyFromWord(valid.word);

    const mutation = row.mutation?.trim() || 'auto';
    const wordPinyinKey = `${valid.word}|${pinyinKey}`;
    const existing = termIndex?.byWordPinyin.get(wordPinyinKey) ?? null;
    const byWord = termIndex?.byWord.get(valid.word) ?? [];

    let opKind = mutation;
    if (mutation === 'auto') {
      opKind = existing ? 'append' : 'add';
    }
    if (mutation === 'add' && existing) {
      report.rejected.push({
        lineNo,
        word: valid.word,
        code: 'term_already_exists',
        message: `line ${lineNo}: add requested but term exists — use mutation append or appendDomainTags`,
      });
      continue;
    }

    if (opKind === 'append' || opKind === 'appendDomainTags') {
      let termId = row.term_id?.trim();
      if (!termId) {
        if (byWord.length === 0) {
          report.rejected.push({
            lineNo,
            word: valid.word,
            code: 'term_not_found',
            message: `line ${lineNo}: append but term not in sqlite index`,
          });
          continue;
        }
        if (byWord.length > 1 && !existing) {
          report.rejected.push({
            lineNo,
            word: valid.word,
            code: 'ambiguous_term_word',
            message: `line ${lineNo}: ambiguous word — provide term_id`,
          });
          continue;
        }
        termId = existing?.termId ?? byWord[0].termId;
      }

      const weights = row.domain_weights ?? Object.fromEntries(valid.domain_tags.map((t) => [t, 1.0]));
      operations.push({
        op: 'appendDomainTags',
        word: valid.word,
        term_id: termId,
        domain_tags: valid.domain_tags,
        domain_weights: weights,
      });
      report.appendDomainTags += 1;
      report.rows.push({ lineNo, word: valid.word, op: 'appendDomainTags', term_id: termId });
      continue;
    }

    const priorScore = row.prior_score ?? 0.85;
    const weights = row.domain_weights ?? Object.fromEntries(valid.domain_tags.map((t) => [t, 1.0]));
    const addOp = {
      op: 'addTerm',
      word: valid.word,
      pinyin: row.pinyin?.trim(),
      tone_pinyin: valid.tone_pinyin,
      pinyin_key: row.pinyin_key?.trim() || undefined,
      tone_pinyin_key: row.tone_pinyin_key?.trim() || toneKey,
      domain_tags: valid.domain_tags,
      domain_weights: weights,
      prior_score: priorScore,
      repair_target: true,
      enabled: row.enabled !== false,
      source: row.source?.trim() || 'industry_pack_v1',
    };
    if (row.term_id?.trim()) {
      addOp.term_id = row.term_id.trim();
    }

    operations.push(addOp);
    report.addTerm += 1;
    report.rows.push({ lineNo, word: valid.word, op: 'addTerm', pinyin_key: pinyinKey });

    if (Array.isArray(row.alias_entries)) {
      for (const ae of row.alias_entries) {
        operations.push({
          op: 'addLegalAlias',
          word: valid.word,
          alias: ae.alias.trim(),
          alias_type: ae.alias_type.trim(),
        });
        report.addLegalAlias += 1;
      }
    }
  }

  return { operations, report };
}

function computeHash(patch) {
  const distHash = path.join(
    electronNodeRoot(),
    'dist/main/electron-node/main/src/lexicon-patch-v4/patch-hash-v4.js'
  );
  if (!fs.existsSync(distHash)) {
    throw new Error('patch-hash-v4 not built — run npm run build:main');
  }
  const { computePatchHashV4 } = require(distHash);
  return computePatchHashV4(patch);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.patchId) {
    console.error(
      'Usage: npm run lexicon:industry-pack-v1:build -- --patch-id <id> [--wave wave1] [--entries path] [--out dir]'
    );
    process.exit(1);
  }

  if (!fs.existsSync(args.entries)) {
    console.error(`[industry-pack-v1] entries not found: ${args.entries}`);
    process.exit(1);
  }

  const registryPath = defaultRegistryPath();
  const registeredDomains = loadRegisteredDomains(registryPath);
  const { bundleVersion, tables } = readBundleVersion();
  const baseVersion = args.baseVersion ?? bundleVersion;

  const termIndex = args.sqlite ? loadTermIndex(args.sqlite) : null;
  if (!termIndex && args.sqlite) {
    console.warn(
      `[industry-pack-v1] WARN: cannot read sqlite term index (${args.sqlite}) — add/append uses mutation field only`
    );
  }

  const parsed = loadEntries(args.entries, args.wave || '');
  const { operations, report } = buildOperations(parsed, registeredDomains, termIndex);

  if (report.rejected.length) {
    console.error('[industry-pack-v1] validation FAIL');
    console.error(JSON.stringify(report.rejected, null, 2));
    process.exit(1);
  }

  if (!operations.length) {
    console.error('[industry-pack-v1] no operations — check --wave filter or empty entries');
    process.exit(1);
  }

  const deltas = {
    newTerms: report.addTerm,
    appendedDomains: report.appendDomainTags,
    newAliases: report.addLegalAlias,
  };

  const patch = {
    patchId: args.patchId,
    patchSchemaVersion: PATCH_SCHEMA_VERSION_V4,
    baseVersion,
    nextVersion: baseVersion + 1,
    hash: '',
    operations,
  };

  if (operations.length > 100) {
    if (args.sqlite && termIndex) {
      try {
        patch.tableThresholds = await measurePatchTableThresholds(args.sqlite, patch);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[industry-pack-v1] WARN: scratch threshold measure failed (${message}) — heuristic fallback`);
        patch.tableThresholds = computeTableThresholds(tables, deltas);
      }
    } else {
      patch.tableThresholds = computeTableThresholds(tables, deltas);
    }
  }

  patch.hash = computeHash(patch);

  fs.mkdirSync(args.outDir, { recursive: true });
  const patchPath = path.join(args.outDir, `${args.patchId}.patch.json`);
  fs.writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');

  const buildReport = {
    patchId: args.patchId,
    patchPath,
    baseVersion,
    nextVersion: baseVersion + 1,
    operationCount: operations.length,
    tableThresholds: patch.tableThresholds ?? null,
    deltas,
    rows: report.rows,
    generatedAt: new Date().toISOString(),
  };
  const reportPath = path.join(args.outDir, `${args.patchId}.build-report.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(buildReport, null, 2)}\n`, 'utf8');

  console.log('[industry-pack-v1] PASS');
  console.log(`  patch → ${patchPath}`);
  console.log(`  report → ${reportPath}`);
  console.log(
    `  ops: addTerm=${report.addTerm} appendDomainTags=${report.appendDomainTags} addLegalAlias=${report.addLegalAlias}`
  );
}

main().catch((err) => {
  console.error('[industry-pack-v1] fatal:', err);
  process.exit(1);
});
