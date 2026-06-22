import * as fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type Database from 'better-sqlite3';

type TermMaterializeModule = {
  rematerializeTerm: (db: Database.Database, termId: string, opts?: { aliases?: string[] }) => void;
  deleteMaterializedTerm: (db: Database.Database, termId: string) => void;
  slugTermId: (word: string, pinyinKey: string) => string;
};

let cached: TermMaterializeModule | null = null;
let loadPromise: Promise<TermMaterializeModule> | null = null;

function findElectronNodeRoot(startDir: string): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'main'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('[lexicon-patch-v3] electron-node root not found for term-materialize bridge');
}

async function loadModule(): Promise<TermMaterializeModule> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const modulePath = path.join(
        findElectronNodeRoot(__dirname),
        'scripts/lexicon/lib/term-materialize.mjs'
      );
      if (!fs.existsSync(modulePath)) {
        throw new Error(`[lexicon-patch-v3] missing shared materializer: ${modulePath}`);
      }
      const href = pathToFileURL(modulePath).href;
      // TS commonjs emit rewrites import() → require(); keep real ESM dynamic import.
      const importDynamic = new Function('specifier', 'return import(specifier)') as (
        specifier: string
      ) => Promise<TermMaterializeModule>;
      const mod = await importDynamic(href);
      if (typeof mod.rematerializeTerm !== 'function') {
        throw new Error(
          `[lexicon-patch-v3] invalid term-materialize exports: ${Object.keys(mod).join(', ')}`
        );
      }
      return mod;
    })();
  }
  return loadPromise;
}

/** Preload ESM materializer before sync sqlite transaction. */
export async function preloadTermMaterializeModule(): Promise<void> {
  cached = await loadModule();
}

function requireModule(): TermMaterializeModule {
  if (!cached) {
    throw new Error('[lexicon-patch-v3] term materialize module not preloaded');
  }
  return cached;
}

/** Parity with term-materialize.mjs slugTermId — kept sync for upsert path. */
export function slugTermIdForPatch(word: string, pinyinKey: string): string {
  return `term-${Buffer.from(`${word}|${pinyinKey}`, 'utf8').toString('hex').slice(0, 16)}`;
}

export function rematerializeTermInDb(
  db: Database.Database,
  termId: string,
  opts?: { aliases?: string[] }
): void {
  requireModule().rematerializeTerm(db, termId, opts);
}

export function deleteMaterializedTermInDb(db: Database.Database, termId: string): void {
  requireModule().deleteMaterializedTerm(db, termId);
}
