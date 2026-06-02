import * as fs from 'fs';
import * as path from 'path';
import Database = require('better-sqlite3');
import { sha256File, normalizeManifestChecksum } from '../lexicon/lexicon-manifest';
import {
  LEXICON_RUNTIME_CHECKSUM,
  LEXICON_RUNTIME_MANIFEST,
  LEXICON_RUNTIME_SQLITE,
  LEXICON_RUNTIME_STATS,
} from '../lexicon-v2/lexicon-v2-bundle-path';
import type { LexiconV3BundleFiles } from './bundle-io';

export function readManifestBundleVersion(manifestPath: string): number {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { bundleVersion?: number };
  return typeof m.bundleVersion === 'number' ? m.bundleVersion : 1;
}

export function queryRow(
  sqlitePath: string,
  sql: string,
  params: unknown[] = []
): Record<string, unknown> | undefined {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    return db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  } finally {
    db.close();
  }
}

export function verifyChecksumAligned(files: LexiconV3BundleFiles): boolean {
  const manifest = JSON.parse(fs.readFileSync(files.manifestPath, 'utf-8')) as { checksum?: string };
  const fromManifest = normalizeManifestChecksum(manifest.checksum);
  const fromFile = fs.readFileSync(files.checksumPath, 'utf-8').trim();
  const fromSqlite = sha256File(files.sqlitePath);
  return fromManifest === fromSqlite && fromSqlite === fromFile;
}

export function readTableCountsFromStats(statsPath: string): {
  base: number;
  idiom: number;
  domain: number;
  routing: number;
} {
  const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as {
    baseCount?: number;
    idiomCount?: number;
    domainCount?: number;
    routingCount?: number;
  };
  return {
    base: stats.baseCount ?? 0,
    idiom: stats.idiomCount ?? 0,
    domain: stats.domainCount ?? 0,
    routing: stats.routingCount ?? 0,
  };
}

export function patchHistoryCount(sqlitePath: string): number {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='lexicon_patch_history'`
      )
      .get() as { c: number };
    if (!row.c) {
      return 0;
    }
    return (db.prepare('SELECT COUNT(*) AS c FROM lexicon_patch_history').get() as { c: number }).c ?? 0;
  } finally {
    db.close();
  }
}
