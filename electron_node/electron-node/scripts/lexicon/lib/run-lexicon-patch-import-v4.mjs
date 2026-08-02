/**
 * Lexicon Patch Importer V4 — 9-step pipeline (V1.2 Addendum §9).
 * 1 build → 2 hash → 3 schema → 4 pre gate → 5 append → 6 apply → 7 runtime gate → 8 source sync → 9 report
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { runPatchV4PreGate } from './run-patch-v4-pre-gate.mjs';
import { v3RuntimeDir, v3BundleFiles, normalizeChecksum } from './lexicon-v3-runtime.mjs';
import { electronNodeRoot } from './paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lexiconScripts = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const DIST_V4 = path.join(
  electronNodeRoot(),
  'dist/main/electron-node/main/src/lexicon-patch-v4'
);

function parseArgv(argv) {
  const bundleIdx = argv.indexOf('--bundle-dir');
  const sourceIdx = argv.indexOf('--source-jsonl');
  const dryRun = argv.includes('--dry-run');
  const skipBuild = argv.includes('--skip-build');

  const bundleDir =
    bundleIdx >= 0 && argv[bundleIdx + 1]
      ? path.resolve(argv[bundleIdx + 1])
      : v3RuntimeDir();

  const sourceJsonl =
    sourceIdx >= 0 && argv[sourceIdx + 1] ? path.resolve(argv[sourceIdx + 1]) : undefined;

  const patchPath = argv.find((a, i) => {
    if (a.startsWith('--')) {
      return false;
    }
    if (bundleIdx >= 0 && i === bundleIdx + 1) {
      return false;
    }
    if (sourceIdx >= 0 && i === sourceIdx + 1) {
      return false;
    }
    return true;
  });

  return { patchPath, bundleDir, sourceJsonl, dryRun, skipBuild };
}

function requireDistV4() {
  if (!fs.existsSync(path.join(DIST_V4, 'patch-service-v4.js'))) {
    throw new Error('lexicon-patch-v4 dist missing — run npm run build:main');
  }
  return {
    loadLexiconPatchV4FromFile: require(path.join(DIST_V4, 'patch-io-v4.js')).loadLexiconPatchV4FromFile,
    validateLexiconPatchV4: require(path.join(DIST_V4, 'patch-validator-v4.js')).validateLexiconPatchV4,
    applyLexiconPatchV4: require(path.join(DIST_V4, 'patch-service-v4.js')).applyLexiconPatchV4,
    verifySourceSyncV4: require(path.join(DIST_V4, 'source-sync-v4.js')).verifySourceSyncV4,
    validateAppendSemanticsV4: require(path.join(DIST_V4, 'append-semantics-v4.js'))
      .validateAppendSemanticsV4,
    createEmptyImportReportV4: require(path.join(DIST_V4, 'import-report-v4.js'))
      .createEmptyImportReportV4,
    appendTrace: require(path.join(DIST_V4, 'import-report-v4.js')).appendTrace,
  };
}


function runBuild(skipBuild) {
  const t0 = performance.now();
  if (skipBuild) {
    return {
      step: 'build',
      status: 'pass',
      message: 'skipped (--skip-build)',
      duration_ms: 0,
    };
  }
  const r = spawnSync('npm', ['run', 'build:main'], {
    cwd: electronNodeRoot(),
    stdio: 'inherit',
    shell: true,
  });
  return {
    step: 'build',
    status: r.status === 0 ? 'pass' : 'fail',
    message: r.status === 0 ? undefined : `build:main exit ${r.status}`,
    duration_ms: Math.round(performance.now() - t0),
  };
}

function runRuntimeGate(bundleDir) {
  const t0 = performance.now();
  const gateScript = path.join(lexiconScripts, 'run-gate-v3-runtime-for-electron.mjs');
  const r = spawnSync('node', [gateScript], {
    cwd: electronNodeRoot(),
    env: { ...process.env, LEXICON_V3_BUNDLE_DIR: bundleDir },
    encoding: 'utf8',
  });
  const stderr = (r.stderr || '').trim();
  const stdout = (r.stdout || '').trim();
  const message = r.status === 0 ? undefined : stderr || stdout || `exit ${r.status}`;
  return {
    step: 'runtime-gate',
    status: r.status === 0 ? 'pass' : 'fail',
    message,
    duration_ms: Math.round(performance.now() - t0),
  };
}

function readManifestTables(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.tables ?? {};
}

function tableDelta(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const delta = {};
  for (const key of keys) {
    const b = Number(before[key] ?? 0);
    const a = Number(after[key] ?? 0);
    if (a !== b) {
      delta[key] = a - b;
    }
  }
  return delta;
}

function writeReport(report) {
  const reportDir = path.join(electronNodeRoot(), 'reports', 'lexicon-import');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = (report.patch_id || 'unknown').replace(/[^\w.-]+/g, '_');
  const reportPath = path.join(reportDir, `${safeId}_${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

function finish(report, startMs) {
  report.duration_ms = Date.now() - startMs;
  const reportPath = writeReport(report);
  const exitCode = report.status === 'success' ? 0 : 1;
  return { exitCode, reportPath };
}

/**
 * @param {string[]} argv
 */
export async function runLexiconPatchImportV4(argv) {
  const startMs = Date.now();
  const { patchPath, bundleDir, sourceJsonl, dryRun, skipBuild } = parseArgv(argv);

  if (!patchPath) {
    console.error(
      'Usage: npm run lexicon:patch:import -- <patch.json> [--bundle-dir <dir>] [--source-jsonl <path>] [--dry-run] [--skip-build]'
    );
    return { exitCode: 1, reportPath: undefined };
  }

  const resolvedPatch = path.resolve(patchPath);
  const files = v3BundleFiles(bundleDir);
  let report = null;
  let dist = null;

  try {
    dist = requireDistV4();
    report = dist.createEmptyImportReportV4(resolvedPatch, bundleDir);
    dist.appendTrace(report, `importer v4 start dryRun=${dryRun}`);

    const buildStep = runBuild(skipBuild);
    dist.appendTrace(report, `build: ${buildStep.status}`);
    if (buildStep.status === 'fail') {
      report.error_code = 'build_failed';
      report.status = 'fail';
      return finish(report, startMs);
    }

    dist = requireDistV4();
    const patch = dist.loadLexiconPatchV4FromFile(resolvedPatch);
    report.patch_id = patch.patchId;
    report.patch_schema_version = patch.patchSchemaVersion;
    report.base_version = patch.baseVersion;
    report.next_version = patch.nextVersion;

    if (fs.existsSync(files.manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf8'));
      report.checksum_before = normalizeChecksum(manifest.checksum);
    }

    const tablesBefore = fs.existsSync(files.manifestPath)
      ? readManifestTables(files.manifestPath)
      : {};

    const validationError = dist.validateLexiconPatchV4(patch, files.manifestPath);
    if (validationError) {
      report.error_code = validationError.code;
      report.pre_gate_results.push({
        step: 'validate-schema-hash',
        status: 'fail',
        message: validationError.message,
        duration_ms: 0,
      });
      report.status = 'fail';
      return finish(report, startMs);
    }
    report.pre_gate_results.push({
      step: 'validate-schema-hash',
      status: 'pass',
      duration_ms: 0,
    });

    const preGate = runPatchV4PreGate(resolvedPatch);
    report.pre_gate_results.push(...preGate.results);
    if (!preGate.ok) {
      report.error_code = 'pre_gate_failed';
      report.status = 'fail';
      return finish(report, startMs);
    }

    const appendErr = dist.validateAppendSemanticsV4(patch);
    if (appendErr) {
      report.pre_gate_results.push({
        step: 'validate-append-semantics-apply',
        status: 'fail',
        message: `${appendErr.code}: ${appendErr.message}`,
        duration_ms: 0,
      });
      report.error_code = appendErr.code;
      report.status = 'fail';
      return finish(report, startMs);
    }

    if (dryRun) {
      report.status = 'success';
      report.runtime_reload = 'skipped (dry-run)';
      report.source_sync = sourceJsonl ? 'skipped (dry-run)' : 'skipped';
      dist.appendTrace(report, 'dry-run complete — apply skipped');
      return finish(report, startMs);
    }

    const applyResult = await dist.applyLexiconPatchV4(patch, { bundleDir, reload: true });
    if (!applyResult.ok) {
      report.error_code = applyResult.errorCode ?? 'apply_failed';
      report.status = 'fail';
      if (applyResult.applyStats) {
        report.collision_terms = applyResult.applyStats.collision_terms ?? [];
        report.collisions = report.collision_terms.length;
      }
      dist.appendTrace(report, `apply failed: ${applyResult.message}`);
      return finish(report, startMs);
    }

    const stats = applyResult.applyStats;
    if (stats) {
      report.new_terms = stats.new_terms;
      report.appended_domains = stats.appended_domains;
      report.new_aliases = stats.new_aliases;
      report.removed_aliases = stats.removed_aliases;
      report.dangerous_ops = stats.dangerous_ops;
      report.rematerialized_term_ids = stats.rematerialized_term_ids;
      report.append_domain_tags = stats.append_domain_tags;
      report.collision_terms = stats.collision_terms;
      report.collisions = stats.collision_terms.length;
    }
    report.checksum_after = applyResult.checksum ?? '';
    report.runtime_reload = 'ok';
    report.base_version = applyResult.baseVersion;
    report.next_version = applyResult.nextVersion;

    const tablesAfter = readManifestTables(files.manifestPath);
    report.table_counts_delta = tableDelta(tablesBefore, tablesAfter);

    const runtimeGate = runRuntimeGate(bundleDir);
    report.runtime_gate_results.push(runtimeGate);
    if (runtimeGate.status === 'fail') {
      report.error_code = 'runtime_gate_failed';
      report.status = 'fail';
      dist.appendTrace(report, 'runtime gate failed after apply — see G-03 runbook');
      return finish(report, startMs);
    }

    if (sourceJsonl) {
      const Database = require('better-sqlite3');
      const db = new Database(files.sqlitePath, { readonly: true });
      try {
        const sync = dist.verifySourceSyncV4(patch, db, sourceJsonl);
        if (sync.ok) {
          report.source_sync = 'pass';
        } else {
          report.source_sync = 'fail';
          report.source_sync_diff = sync.diff;
          report.error_code = 'source_sync_failed';
          report.status = 'fail';
        }
      } finally {
        db.close();
      }
    } else {
      report.source_sync = 'skipped';
    }

    if (report.status !== 'fail') {
      report.status = 'success';
      report.error_code = '';
    }

    return finish(report, startMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (report) {
      report.error_code = report.error_code || 'importer_exception';
      report.status = 'fail';
      if (dist?.appendTrace) {
        dist.appendTrace(report, message);
      }
      return finish(report, startMs);
    }
    console.error('[lexicon:patch:import]', message);
    return { exitCode: 1, reportPath: undefined };
  }
}
