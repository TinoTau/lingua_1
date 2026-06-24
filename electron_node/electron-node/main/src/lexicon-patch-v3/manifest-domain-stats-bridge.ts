import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';

const nodeRequire = createRequire(__filename);

type ManifestDomainStatsHelper = {
  readDomainAvailabilityFromDb: (db: Database.Database) => Record<string, number>;
  readDomainHierarchyCountFromDb: (db: Database.Database) => number;
};

let cached: ManifestDomainStatsHelper | null = null;

function findElectronNodeRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'main'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('[lexicon-patch-v3] electron-node root not found for manifest-domain-stats');
}

function loadHelper(): ManifestDomainStatsHelper {
  if (!cached) {
    const modulePath = path.join(
      findElectronNodeRoot(__dirname),
      'scripts/lexicon/lib/manifest-domain-stats.cjs'
    );
    if (!fs.existsSync(modulePath)) {
      throw new Error(`[lexicon-patch-v3] missing manifest-domain-stats helper: ${modulePath}`);
    }
    cached = nodeRequire(modulePath) as ManifestDomainStatsHelper;
  }
  return cached;
}

export function readDomainAvailabilityFromDb(db: Database.Database): Record<string, number> {
  return loadHelper().readDomainAvailabilityFromDb(db);
}

export function readDomainHierarchyCountFromDb(db: Database.Database): number {
  return loadHelper().readDomainHierarchyCountFromDb(db);
}
