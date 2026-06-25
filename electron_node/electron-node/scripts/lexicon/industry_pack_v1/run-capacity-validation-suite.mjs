#!/usr/bin/env node
/**
 * Industry Pack V1 — Builder Capacity Validation suite orchestrator.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { repoRoot } from '../lib/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const assetRoot = path.join(
  repoRoot(),
  'electron_node',
  'docs',
  'lexicon-assets',
  'industry_pack_v1'
);
const entriesPath = path.join(assetRoot, 'entries.capacity-validation.jsonl');
const patchPath = path.join(assetRoot, 'patches', 'industry-pack-v1-capacity-validation.patch.json');
const reportDir = path.join(root, 'reports', 'lexicon-expansion');

const PATCH_ID = 'industry-pack-v1-capacity-validation';
const results = [];

function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = fn();
    results.push({ step: name, status: 'pass', duration_ms: Date.now() - t0, ...detail });
    console.log(`[capacity-validation] PASS ${name}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ step: name, status: 'fail', duration_ms: Date.now() - t0, message });
    console.error(`[capacity-validation] FAIL ${name}: ${message}`);
    return false;
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: opts.silent ? 'pipe' : 'inherit',
    ...opts,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const skipImport = process.argv.includes('--skip-import');
  const startMs = Date.now();

  fs.mkdirSync(reportDir, { recursive: true });

  let ok = true;
  ok = step('generate_entries', () => {
    const r = run('node', [
      'scripts/lexicon/industry_pack_v1/generate-capacity-validation-entries-for-electron.mjs',
    ], {
      silent: true,
    });
    if (r.status !== 0) {
      throw new Error(r.stderr || 'generate failed');
    }
    const lines = fs.readFileSync(entriesPath, 'utf8').trim().split('\n').length;
    if (lines < 200) {
      throw new Error(`expected >=200 entries, got ${lines}`);
    }
    return { entryLines: lines };
  }) && ok;

  ok = step('build_patch_electron', () => {
    const r = run('node', [
      'scripts/lexicon/industry_pack_v1/build-patch-v4-for-electron.mjs',
      '--patch-id',
      PATCH_ID,
      '--entries',
      entriesPath,
    ]);
    if (r.status !== 0) {
      throw new Error('build-patch-v4-for-electron failed');
    }
    const patch = readJson(patchPath);
    if (patch.operations.length <= 100) {
      throw new Error('expected >100 operations for tableThresholds test');
    }
    if (!patch.tableThresholds?.term) {
      throw new Error('missing tableThresholds on large patch');
    }
    return {
      operationCount: patch.operations.length,
      tableThresholds: patch.tableThresholds,
      baseVersion: patch.baseVersion,
      nextVersion: patch.nextVersion,
    };
  }) && ok;

  ok = step('dry_run_import', () => {
    const r = run('node', [
      'scripts/lexicon/lexicon-patch-import-v4-for-electron.mjs',
      patchPath,
      '--source-jsonl',
      entriesPath,
      '--dry-run',
    ]);
    if (r.status !== 0) {
      throw new Error('dry-run import failed');
    }
    return {};
  }) && ok;

  let importReport = null;
  if (!skipImport) {
    ok = step('formal_import_electron', () => {
      const t0 = Date.now();
      const r = run('node', [
        'scripts/lexicon/lexicon-patch-import-v4-for-electron.mjs',
        patchPath,
        '--source-jsonl',
        entriesPath,
      ]);
      const duration_ms = Date.now() - t0;
      if (r.status !== 0) {
        throw new Error('formal import failed');
      }
      const reportsDir = path.join(root, 'reports', 'lexicon-import');
      const files = fs
        .readdirSync(reportsDir)
        .filter((f) => f.startsWith(PATCH_ID))
        .sort();
      importReport = readJson(path.join(reportsDir, files[files.length - 1]));
      return {
        import_duration_ms: duration_ms,
        importReport: {
          status: importReport.status,
          new_terms: importReport.new_terms,
          appended_domains: importReport.appended_domains,
          source_sync: importReport.source_sync,
          runtime_reload: importReport.runtime_reload,
          table_counts_delta: importReport.table_counts_delta,
        },
      };
    }) && ok;

    ok = step('runtime_gate', () => {
      const r = run('npm', ['run', 'lexicon:gate:v3-runtime']);
      if (r.status !== 0) {
        throw new Error('runtime gate failed');
      }
      return {};
    }) && ok;

    ok = step('post_import_verify', () => {
      const vr = run('npx', [
        'electron',
        './scripts/lexicon/industry_pack_v1/verify-capacity-post-import.mjs',
      ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true });
      if (vr.status !== 0) {
        throw new Error(vr.stderr || vr.stdout || 'post-import verify failed');
      }
      return { verifySnippet: (vr.stdout || '').slice(-800) };
    }) && ok;
    ok = step('counterfactual', () => {
      const r = run('npx', ['electron', './scripts/lexicon/industry_pack_v1/run-counterfactual-validation.mjs'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        silent: true,
      });
      if (r.status !== 0) {
        throw new Error(r.stderr || r.stdout || 'counterfactual failed');
      }
      return {};
    }) && ok;
  }

  ok = step('patch_v4_e2e', () => {
    const r = run('npm', ['run', 'test:lexicon-patch-v4-e2e']);
    if (r.status !== 0) {
      throw new Error('patch v4 e2e failed');
    }
    return {};
  }) && ok;

  ok = step('freeze_contract', () => {
    const r = run('npm', ['run', 'test:fw-detector', '--', '--testPathPattern=freeze-contract'], {
      silent: true,
    });
    if (r.status !== 0) {
      throw new Error('freeze-contract failed');
    }
    return {};
  }) && ok;

  ok = step('ranking_semantics', () => {
    const r = run('node', ['tests/run-fw-ranking-semantics-test.mjs'], { silent: true });
    if (r.status !== 0) {
      throw new Error('ranking semantics failed');
    }
    return {};
  }) && ok;

  ok = step('industry_case_manifest', () => {
    const r = run('npm', ['run', 'test:industry-pack-v1-cases'], { silent: true });
    if (r.status !== 0) {
      throw new Error('industry case manifest failed');
    }
    return {};
  }) && ok;

  const manifestBefore = { bundleVersion: 4, term: 130 };
  let manifestAfter = null;
  try {
    manifestAfter = readJson(path.join(repoRoot(), 'node_runtime', 'lexicon', 'v3', 'manifest.json'));
  } catch {
    /* optional */
  }

  const summary = {
    suite: 'industry-pack-v1-capacity-validation',
    status: ok ? 'pass' : 'fail',
    duration_ms: Date.now() - startMs,
    skipImport,
    manifestBefore,
    manifestAfter: manifestAfter
      ? {
          bundleVersion: manifestAfter.bundleVersion,
          lastPatchId: manifestAfter.lastPatchId,
          tables: manifestAfter.tables,
          domainAvailability: manifestAfter.domainAvailability,
        }
      : null,
    importReport,
    steps: results,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(reportDir, `capacity-validation_${stamp}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[capacity-validation] report → ${outPath}`);
  process.exit(ok ? 0 : 1);
}

main();
