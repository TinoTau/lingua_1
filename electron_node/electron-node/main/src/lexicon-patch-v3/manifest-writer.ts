import * as fs from 'fs';
import type Database from 'better-sqlite3';
import { sha256File, normalizeManifestChecksum } from '../lexicon/lexicon-manifest';
import { LEXICON_V3_RUNTIME_SCHEMA_VERSION } from '../lexicon-v2/lexicon-types-v2';
import type { LexiconPatchV3 } from './patch-types';
import type { LexiconV3BundleFiles } from './bundle-io';
import { collectBundleTableStats } from './sqlite-table-stats';

export function writeBundleManifestsAfterPatch(
  db: Database.Database,
  files: LexiconV3BundleFiles,
  patch: LexiconPatchV3
): void {
  const tables = collectBundleTableStats(db);
  const checksumHex = sha256File(files.sqlitePath);
  const checksum = `sha256:${checksumHex}`;
  const appliedAt = new Date().toISOString();

  const manifest = {
    schemaVersion: LEXICON_V3_RUNTIME_SCHEMA_VERSION,
    bundleVersion: patch.nextVersion,
    bundleTag: 'v3-runtime',
    buildTime: appliedAt,
    checksum,
    tables: {
      base: tables.base_lexicon.rowCount,
      idiom: tables.idiom_lexicon.rowCount,
      domain: tables.domain_lexicon.rowCount,
      routing: tables.industry_routing_lexicon.rowCount,
    },
    seedInputs: readExistingSeedInputs(files.manifestPath),
    overlayInputs: [],
    lastPatchId: patch.patchId,
    lastAppliedAt: appliedAt,
  };

  const stats = {
    baseCount: manifest.tables.base,
    idiomCount: manifest.tables.idiom,
    domainCount: manifest.tables.domain,
    routingCount: manifest.tables.routing,
    generatedAt: appliedAt,
    bundleVersion: patch.nextVersion,
    checksum,
  };

  fs.writeFileSync(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(files.statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(files.checksumPath, `${normalizeManifestChecksum(checksum)}\n`, 'utf-8');
}

function readExistingSeedInputs(manifestPath: string): string[] {
  if (!fs.existsSync(manifestPath)) {
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    seedInputs?: string[];
    seed_inputs?: string[];
  };
  return parsed.seedInputs ?? parsed.seed_inputs ?? [];
}
