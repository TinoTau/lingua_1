import * as fs from 'fs';
import type Database from 'better-sqlite3';
import type { LexiconPatchV4 } from './patch-types-v4';

export type SourceSyncDiff = {
  word: string;
  jsonl_domains: string[];
  sqlite_domains: string[];
};

function parseJsonlDomainTags(line: string): { word: string; domain_tags: string[] } | null {
  try {
    const row = JSON.parse(line) as {
      word?: string;
      domain_tags?: string[];
      domainTags?: string[];
      status?: string;
    };
    const word = row.word?.trim();
    if (!word) {
      return null;
    }
    if (row.status === 'deprecated') {
      return null;
    }
    const tags = row.domain_tags ?? row.domainTags ?? [];
    return { word, domain_tags: tags.filter((t) => typeof t === 'string' && t.trim()) };
  } catch {
    return null;
  }
}

function wordsTouchedByPatch(patch: LexiconPatchV4): Set<string> {
  const words = new Set<string>();
  for (const op of patch.operations) {
    if (op.word?.trim()) {
      words.add(op.word.trim());
    }
  }
  return words;
}

function readSqliteDomains(db: Database.Database, word: string): string[] {
  const rows = db
    .prepare(
      `SELECT tdt.domain_id FROM term t
       INNER JOIN term_domain_tags tdt ON tdt.term_id = t.id
       WHERE t.word = ?`
    )
    .all(word) as Array<{ domain_id: string }>;
  return [...new Set(rows.map((r) => r.domain_id))].sort();
}

/** SS-02: JSONL.domain_tags ⊆ SQLite.term_domain_tags for patch-touched words. */
export function verifySourceSyncV4(
  patch: LexiconPatchV4,
  db: Database.Database,
  jsonlPath: string
): { ok: true } | { ok: false; diff: SourceSyncDiff[] } {
  if (!fs.existsSync(jsonlPath)) {
    return { ok: false, diff: [{ word: '*', jsonl_domains: [], sqlite_domains: ['missing_jsonl_file'] }] };
  }

  const touched = wordsTouchedByPatch(patch);
  const jsonlByWord = new Map<string, Set<string>>();

  for (const line of fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseJsonlDomainTags(line);
    if (!parsed || !touched.has(parsed.word)) {
      continue;
    }
    const set = jsonlByWord.get(parsed.word) ?? new Set<string>();
    for (const tag of parsed.domain_tags) {
      set.add(tag.trim());
    }
    jsonlByWord.set(parsed.word, set);
  }

  const diff: SourceSyncDiff[] = [];
  for (const word of touched) {
    const jsonlTags = [...(jsonlByWord.get(word) ?? new Set<string>())].sort();
    const sqliteTags = readSqliteDomains(db, word);
    const missing = jsonlTags.filter((t) => !sqliteTags.includes(t));
    if (missing.length) {
      diff.push({ word, jsonl_domains: jsonlTags, sqlite_domains: sqliteTags });
    }
  }

  if (diff.length) {
    return { ok: false, diff };
  }
  return { ok: true };
}
