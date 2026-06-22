import type Database from 'better-sqlite3';
import type {
  LexiconPatchV3,
  LexiconTierTable,
  PatchOperation,
  TermPatchEntry,
  TierPatchEntry,
} from './patch-types';
import { LEXICON_PATCH_HISTORY_TABLE, isTermPatchEntry } from './patch-types';
import {
  entryToTierRow,
  materializeTierAliasRows,
  sqlTierTableName,
} from './row-materialize';
import { assertTableThresholds } from './sqlite-gate';
import { ensurePatchHistoryTable } from './sqlite-schema';
import {
  deleteMaterializedTermInDb,
  preloadTermMaterializeModule,
  rematerializeTermInDb,
  slugTermIdForPatch,
} from './term-materialize-bridge';
import { resolvePinyinKey } from './pinyin-resolve';

function normalizeTagWeights(tags: string[], raw: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tag of tags) {
    const value = raw?.[tag];
    out[tag] = value != null && value > 0 ? value : 1.0;
  }
  return out;
}

function resolveTermId(entry: TermPatchEntry): string {
  const pinyinKey = resolvePinyinKey(entry.word, entry.pinyinKey)!;
  return entry.termId?.trim() || slugTermIdForPatch(entry.word, pinyinKey);
}

function upsertTerm(db: Database.Database, entry: TermPatchEntry): string {
  const pinyinKey = resolvePinyinKey(entry.word, entry.pinyinKey)!;
  const termId = resolveTermId(entry);
  db.prepare(
    `INSERT INTO term (id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier)
     VALUES (@id, @word, @pinyin_key, @tone_pinyin_key, @prior_score, @repair_target, @enabled, @source, 'domain')
     ON CONFLICT(id) DO UPDATE SET
       word=excluded.word,
       pinyin_key=excluded.pinyin_key,
       tone_pinyin_key=excluded.tone_pinyin_key,
       prior_score=excluded.prior_score,
       repair_target=excluded.repair_target,
       enabled=excluded.enabled,
       source=excluded.source`
  ).run({
    id: termId,
    word: entry.word.trim(),
    pinyin_key: pinyinKey,
    tone_pinyin_key: entry.tonePinyinKey?.trim() ?? '',
    prior_score: entry.priorScore,
    repair_target: entry.repairTarget === true ? 1 : 0,
    enabled: entry.enabled === false ? 0 : 1,
    source: entry.source?.trim() || 'patch-v3',
  });
  return termId;
}

function replaceTermTags(
  db: Database.Database,
  termId: string,
  tags: string[],
  weights: Record<string, number>
): void {
  db.prepare('DELETE FROM term_domain_tags WHERE term_id = ?').run(termId);
  const insert = db.prepare(
    `INSERT INTO term_domain_tags (term_id, domain_id, weight) VALUES (@term_id, @domain_id, @weight)`
  );
  for (const domainId of tags) {
    insert.run({ term_id: termId, domain_id: domainId, weight: weights[domainId] ?? 1.0 });
  }
}

function applyTermAdd(db: Database.Database, entry: TermPatchEntry): void {
  const tags = entry.domainTags.map((t) => t.trim()).filter(Boolean);
  if (!tags.length) {
    throw new Error('term add requires non-empty domainTags');
  }
  const weights = normalizeTagWeights(tags, entry.domainWeights);
  const termId = upsertTerm(db, entry);
  replaceTermTags(db, termId, tags, weights);
  rematerializeTermInDb(db, termId, { aliases: entry.aliases });
}

function applyTermUpdate(db: Database.Database, op: PatchOperation): void {
  const termId = op.termId?.trim();
  if (!termId) {
    throw new Error('term update requires termId');
  }
  const fields = (op.fields ?? {}) as Partial<TermPatchEntry>;
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: termId };

  if (fields.priorScore !== undefined) {
    sets.push('prior_score = @prior_score');
    params.prior_score = fields.priorScore;
  }
  if (fields.repairTarget !== undefined) {
    sets.push('repair_target = @repair_target');
    params.repair_target = fields.repairTarget ? 1 : 0;
  }
  if (fields.enabled !== undefined) {
    sets.push('enabled = @enabled');
    params.enabled = fields.enabled === false ? 0 : 1;
  }
  if (fields.tonePinyinKey !== undefined) {
    sets.push('tone_pinyin_key = @tone_pinyin_key');
    params.tone_pinyin_key = fields.tonePinyinKey;
  }

  if (sets.length) {
    db.prepare(`UPDATE term SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  if (fields.domainTags?.length) {
    const tags = fields.domainTags.map((t) => t.trim()).filter(Boolean);
    const weights = normalizeTagWeights(tags, fields.domainWeights);
    replaceTermTags(db, termId, tags, weights);
  } else if (fields.domainWeights) {
    const existing = db
      .prepare('SELECT domain_id FROM term_domain_tags WHERE term_id = ?')
      .all(termId) as Array<{ domain_id: string }>;
    const tags = existing.map((r) => r.domain_id);
    const weights = normalizeTagWeights(tags, fields.domainWeights);
    replaceTermTags(db, termId, tags, weights);
  }

  rematerializeTermInDb(db, termId);
}

function applyTermDelete(db: Database.Database, op: PatchOperation): void {
  const termId = op.termId?.trim();
  if (!termId) {
    throw new Error('term delete requires termId');
  }
  if (op.domainId?.trim()) {
    const domainId = op.domainId.trim();
    const remaining = db
      .prepare('SELECT COUNT(*) AS c FROM term_domain_tags WHERE term_id = ? AND domain_id != ?')
      .get(termId, domainId) as { c: number };
    if ((remaining.c ?? 0) === 0) {
      throw new Error(`term delete-tag rejected: last tag for term_id=${termId}`);
    }
    db.prepare('DELETE FROM term_domain_tags WHERE term_id = ? AND domain_id = ?').run(termId, domainId);
    rematerializeTermInDb(db, termId);
    return;
  }

  deleteMaterializedTermInDb(db, termId);
  db.prepare('DELETE FROM term_domain_tags WHERE term_id = ?').run(termId);
  db.prepare('DELETE FROM term WHERE id = ?').run(termId);
}

function applyTermEnableDisable(db: Database.Database, op: PatchOperation, enabled: number): void {
  const termId = op.termId?.trim();
  if (!termId) {
    throw new Error('term enable/disable requires termId');
  }
  db.prepare('UPDATE term SET enabled = ? WHERE id = ?').run(enabled, termId);
  rematerializeTermInDb(db, termId);
}

function applyTierOp(db: Database.Database, tier: Exclude<LexiconTierTable, 'term'>, op: PatchOperation): void {
  const table = sqlTierTableName(tier);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO ${table}
      (id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const updateEnabled = db.prepare(
    `UPDATE ${table} SET enabled = @enabled WHERE pinyin_key = @pinyin_key AND word = @word`
  );
  const deleteCanonical = db.prepare(
    `DELETE FROM ${table} WHERE pinyin_key = @pinyin_key AND word = @word`
  );
  const deleteAliases = db.prepare(`DELETE FROM ${table} WHERE canonical_word = @word`);

  if (op.op === 'add') {
    const entry = op.entry as TierPatchEntry;
    if (!entry) {
      throw new Error(`${tier} add missing entry`);
    }
    const canonical = entryToTierRow(entry, tier);
    insert.run(canonical);
    for (const aliasRow of materializeTierAliasRows(tier, entry, canonical)) {
      insert.run(aliasRow);
    }
    return;
  }

  if (op.op === 'delete') {
    deleteAliases.run({ word: op.word });
    deleteCanonical.run({ pinyin_key: op.pinyinKey, word: op.word });
    return;
  }

  if (op.op === 'enable' || op.op === 'disable') {
    updateEnabled.run({
      enabled: op.op === 'enable' ? 1 : 0,
      pinyin_key: op.pinyinKey,
      word: op.word,
    });
    return;
  }

  if (op.op === 'update') {
    const fields = (op.fields ?? {}) as Partial<TierPatchEntry>;
    const sets: string[] = [];
    const params: Record<string, unknown> = {
      word: op.word,
      pinyin_key: op.pinyinKey,
    };
    if (fields.priorScore !== undefined) {
      sets.push('prior_score = @prior_score');
      params.prior_score = fields.priorScore;
    }
    if (fields.repairTarget !== undefined) {
      sets.push('repair_target = @repair_target');
      params.repair_target = fields.repairTarget ? 1 : 0;
    }
    if (fields.enabled !== undefined) {
      sets.push('enabled = @enabled');
      params.enabled = fields.enabled === false ? 0 : 1;
    }
    if (fields.aliases !== undefined) {
      sets.push('aliases = @aliases');
      params.aliases = JSON.stringify(fields.aliases.length ? fields.aliases : [op.word]);
    }
    if (fields.tonePinyinKey !== undefined) {
      sets.push('tone_pinyin_key = @tone_pinyin_key');
      params.tone_pinyin_key = fields.tonePinyinKey;
    }
    if (!sets.length) {
      return;
    }
    db.prepare(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE pinyin_key = @pinyin_key AND word = @word AND is_alias = 0`
    ).run(params);
  }
}

export async function applyLexiconPatchToSqlite(db: Database.Database, patch: LexiconPatchV3): Promise<void> {
  if (patch.operations.some((op) => op.table === 'term')) {
    await preloadTermMaterializeModule();
  }
  ensurePatchHistoryTable(db);

  const applyOne = (op: PatchOperation): void => {
    if (op.table === 'term') {
      if (op.op === 'add') {
        const entry = op.entry;
        if (!entry || !isTermPatchEntry(entry)) {
          throw new Error('term add requires TermPatchEntry with domainTags');
        }
        applyTermAdd(db, entry);
        return;
      }
      if (op.op === 'update') {
        applyTermUpdate(db, op);
        return;
      }
      if (op.op === 'delete') {
        applyTermDelete(db, op);
        return;
      }
      if (op.op === 'enable' || op.op === 'disable') {
        applyTermEnableDisable(db, op, op.op === 'enable' ? 1 : 0);
      }
      return;
    }

    applyTierOp(db, op.table, op);
  };

  const run = db.transaction(() => {
    for (const op of patch.operations) {
      applyOne(op);
    }
    assertTableThresholds(db);
    db.prepare(
      `INSERT INTO ${LEXICON_PATCH_HISTORY_TABLE} (patch_id, base_version, next_version, applied_at, patch_hash)
       VALUES (@patchId, @baseVersion, @nextVersion, @appliedAt, @hash)`
    ).run({
      patchId: patch.patchId,
      baseVersion: patch.baseVersion,
      nextVersion: patch.nextVersion,
      appliedAt: Date.now(),
      hash: patch.hash,
    });
  });

  run();
}
