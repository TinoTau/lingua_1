import type Database from 'better-sqlite3';
import type { LexiconPatchV4, PatchOperationV4 } from './patch-types-v4';
import { DEFAULT_PRIOR_SCORE_V4 } from './patch-types-v4';
import { LEXICON_PATCH_HISTORY_TABLE } from '../lexicon-patch-v3/patch-types';
import { ensurePatchHistoryTable } from '../lexicon-patch-v3/sqlite-schema';
import {
  deleteMaterializedTermInDb,
  preloadTermMaterializeModule,
  rematerializeTermInDb,
} from '../lexicon-patch-v3/term-materialize-bridge';
import { resolveTonePinyinKey } from '../lexicon-patch-v3/pinyin-resolve';
import { assertTableThresholdsV4 } from './sqlite-gate-v4';
import {
  assertAddTermNoCollision,
  resolvePinyinKeyForOp,
  resolveTermRef,
} from './term-ref-v4';

export class PatchApplyErrorV4 extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type ApplyStatsV4 = {
  new_terms: number;
  appended_domains: number;
  new_aliases: number;
  removed_aliases: number;
  dangerous_ops: number;
  rematerialized_term_ids: string[];
  append_domain_tags: Array<{ word: string; term_id: string; domain_id: string; weight: number }>;
  collision_terms: Array<{ word: string; code: string }>;
};

function normalizeTagWeights(tags: string[], raw: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const tag of tags) {
    const value = raw?.[tag];
    out[tag] = value != null && value > 0 ? value : 1.0;
  }
  return out;
}

function parseAliasesJson(raw: string | undefined, fallbackWord: string): string[] {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((a) => String(a).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  return [fallbackWord];
}

function readAliases(db: Database.Database, termId: string, canonicalWord: string): string[] {
  const row = db
    .prepare(`SELECT aliases FROM domain_lexicon WHERE id = ? AND is_alias = 0 LIMIT 1`)
    .get(termId) as { aliases?: string } | undefined;
  return parseAliasesJson(row?.aliases, canonicalWord).filter((a) => a !== canonicalWord);
}

function writeAliasesRematerialize(
  db: Database.Database,
  termId: string,
  word: string,
  aliases: string[],
  stats: ApplyStatsV4
): void {
  rematerializeTermInDb(db, termId, { aliases: [...new Set(aliases)].filter((a) => a !== word) });
  if (!stats.rematerialized_term_ids.includes(termId)) {
    stats.rematerialized_term_ids.push(termId);
  }
}

const UPSERT_TAG_SQL = `
  INSERT INTO term_domain_tags (term_id, domain_id, weight)
  VALUES (@term_id, @domain_id, @weight)
  ON CONFLICT(term_id, domain_id) DO UPDATE SET
    weight = MAX(weight, excluded.weight)
`;

function appendDomainTagsForTerm(
  db: Database.Database,
  termId: string,
  word: string,
  tags: string[],
  weights: Record<string, number>,
  stats: ApplyStatsV4
): void {
  const insert = db.prepare(UPSERT_TAG_SQL);
  for (const domainId of tags) {
    const weight = weights[domainId] ?? 1.0;
    insert.run({ term_id: termId, domain_id: domainId, weight });
    stats.appended_domains += 1;
    stats.append_domain_tags.push({ word, term_id: termId, domain_id: domainId, weight });
  }
  rematerializeTermInDb(db, termId);
  if (!stats.rematerialized_term_ids.includes(termId)) {
    stats.rematerialized_term_ids.push(termId);
  }
}

function replaceAllTags(
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

function applyOne(db: Database.Database, op: PatchOperationV4, stats: ApplyStatsV4): void {
  switch (op.op) {
    case 'addTerm': {
      const collision = assertAddTermNoCollision(db, op);
      if (!collision.ok) {
        stats.collision_terms.push({ word: op.word, code: collision.code });
        throw new PatchApplyErrorV4(collision.code, collision.message);
      }
      const { termId, pinyinKey } = collision;
      const tags = op.domain_tags!.map((t) => t.trim()).filter(Boolean);
      const weights = normalizeTagWeights(tags, op.domain_weights);
      const priorScore = op.prior_score ?? DEFAULT_PRIOR_SCORE_V4;
      const toneKey =
        op.tone_pinyin_key?.trim() ||
        resolveTonePinyinKey(op.word, { tonePinyinKey: op.tone_pinyin_key, pinyinField: op.pinyin });

      db.prepare(
        `INSERT INTO term (id, word, pinyin_key, tone_pinyin_key, prior_score, repair_target, enabled, source, tier)
         VALUES (@id, @word, @pinyin_key, @tone_pinyin_key, @prior_score, @repair_target, @enabled, @source, 'domain')`
      ).run({
        id: termId,
        word: op.word.trim(),
        pinyin_key: pinyinKey,
        tone_pinyin_key: toneKey,
        prior_score: priorScore,
        repair_target: op.repair_target === true ? 1 : 0,
        enabled: op.enabled === false ? 0 : 1,
        source: op.source?.trim() || 'patch-v4',
      });

      const insertTag = db.prepare(UPSERT_TAG_SQL);
      for (const domainId of tags) {
        insertTag.run({
          term_id: termId,
          domain_id: domainId,
          weight: weights[domainId] ?? 1.0,
        });
      }
      rematerializeTermInDb(db, termId);
      stats.rematerialized_term_ids.push(termId);
      stats.new_terms += 1;
      return;
    }
    case 'appendDomainTags': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const tags = op.domain_tags!.map((t) => t.trim()).filter(Boolean);
      const weights = normalizeTagWeights(tags, op.domain_weights);
      appendDomainTagsForTerm(db, resolved.ref.termId, resolved.ref.word, tags, weights, stats);
      return;
    }
    case 'addLegalAlias': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const alias = op.alias!.trim();
      const existing = readAliases(db, resolved.ref.termId, resolved.ref.word);
      if (!existing.includes(alias)) {
        existing.push(alias);
        stats.new_aliases += 1;
      }
      writeAliasesRematerialize(db, resolved.ref.termId, resolved.ref.word, existing, stats);
      return;
    }
    case 'removeAlias': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const alias = op.alias!.trim();
      const existing = readAliases(db, resolved.ref.termId, resolved.ref.word);
      const next = existing.filter((a) => a !== alias);
      if (next.length !== existing.length) {
        stats.removed_aliases += 1;
      }
      writeAliasesRematerialize(db, resolved.ref.termId, resolved.ref.word, next, stats);
      return;
    }
    case 'removeDomainTag': {
      const termId = op.term_id!.trim();
      const domainId = op.domain_id!.trim();
      const remaining = db
        .prepare('SELECT COUNT(*) AS c FROM term_domain_tags WHERE term_id = ? AND domain_id != ?')
        .get(termId, domainId) as { c: number };
      if ((remaining.c ?? 0) === 0) {
        throw new PatchApplyErrorV4('last_domain_tag', `removeDomainTag rejected: last tag for ${termId}`);
      }
      db.prepare('DELETE FROM term_domain_tags WHERE term_id = ? AND domain_id = ?').run(termId, domainId);
      rematerializeTermInDb(db, termId);
      if (!stats.rematerialized_term_ids.includes(termId)) {
        stats.rematerialized_term_ids.push(termId);
      }
      return;
    }
    case 'enableTerm': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      db.prepare('UPDATE term SET enabled = 1 WHERE id = ?').run(resolved.ref.termId);
      rematerializeTermInDb(db, resolved.ref.termId);
      if (!stats.rematerialized_term_ids.includes(resolved.ref.termId)) {
        stats.rematerialized_term_ids.push(resolved.ref.termId);
      }
      return;
    }
    case 'disableTerm': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      db.prepare('UPDATE term SET enabled = 0 WHERE id = ?').run(resolved.ref.termId);
      rematerializeTermInDb(db, resolved.ref.termId);
      if (!stats.rematerialized_term_ids.includes(resolved.ref.termId)) {
        stats.rematerialized_term_ids.push(resolved.ref.termId);
      }
      return;
    }
    case 'updateDomainWeights': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const existing = db
        .prepare('SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ?')
        .all(resolved.ref.termId) as Array<{ domain_id: string; weight: number }>;
      const tags = existing.map((r) => r.domain_id);
      const merged = normalizeTagWeights(tags, {
        ...Object.fromEntries(existing.map((r) => [r.domain_id, r.weight])),
        ...op.domain_weights,
      });
      replaceAllTags(db, resolved.ref.termId, tags, merged);
      rematerializeTermInDb(db, resolved.ref.termId);
      if (!stats.rematerialized_term_ids.includes(resolved.ref.termId)) {
        stats.rematerialized_term_ids.push(resolved.ref.termId);
      }
      return;
    }
    case 'updateTermFields': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const fields = op.fields ?? {};
      const sets: string[] = [];
      const params: Record<string, unknown> = { id: resolved.ref.termId };
      if (fields.prior_score !== undefined) {
        sets.push('prior_score = @prior_score');
        params.prior_score = fields.prior_score;
      }
      if (fields.repair_target !== undefined) {
        sets.push('repair_target = @repair_target');
        params.repair_target = fields.repair_target ? 1 : 0;
      }
      if (fields.enabled !== undefined) {
        sets.push('enabled = @enabled');
        params.enabled = fields.enabled === false ? 0 : 1;
      }
      if (fields.tone_pinyin_key !== undefined) {
        sets.push('tone_pinyin_key = @tone_pinyin_key');
        params.tone_pinyin_key = fields.tone_pinyin_key;
      }
      if (fields.source !== undefined) {
        sets.push('source = @source');
        params.source = fields.source;
      }
      if (sets.length) {
        db.prepare(`UPDATE term SET ${sets.join(', ')} WHERE id = @id`).run(params);
        rematerializeTermInDb(db, resolved.ref.termId);
        if (!stats.rematerialized_term_ids.includes(resolved.ref.termId)) {
          stats.rematerialized_term_ids.push(resolved.ref.termId);
        }
      }
      return;
    }
    case 'deleteTerm': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      deleteMaterializedTermInDb(db, resolved.ref.termId);
      db.prepare('DELETE FROM term_domain_tags WHERE term_id = ?').run(resolved.ref.termId);
      db.prepare('DELETE FROM term WHERE id = ?').run(resolved.ref.termId);
      return;
    }
    case 'replaceDomainTagsDangerous': {
      const resolved = resolveTermRef(db, op);
      if (!resolved.ok) {
        throw new PatchApplyErrorV4(resolved.error.code, resolved.error.message);
      }
      const tags = op.domain_tags!.map((t) => t.trim()).filter(Boolean);
      const weights = normalizeTagWeights(tags, op.domain_weights);
      replaceAllTags(db, resolved.ref.termId, tags, weights);
      rematerializeTermInDb(db, resolved.ref.termId);
      stats.dangerous_ops += 1;
      if (!stats.rematerialized_term_ids.includes(resolved.ref.termId)) {
        stats.rematerialized_term_ids.push(resolved.ref.termId);
      }
      return;
    }
    default:
      throw new PatchApplyErrorV4('invalid_op', `unsupported op: ${(op as PatchOperationV4).op}`);
  }
}

export async function applyLexiconPatchToSqliteV4(
  db: Database.Database,
  patch: LexiconPatchV4
): Promise<ApplyStatsV4> {
  await preloadTermMaterializeModule();
  ensurePatchHistoryTable(db);

  const stats: ApplyStatsV4 = {
    new_terms: 0,
    appended_domains: 0,
    new_aliases: 0,
    removed_aliases: 0,
    dangerous_ops: 0,
    rematerialized_term_ids: [],
    append_domain_tags: [],
    collision_terms: [],
  };

  const run = db.transaction(() => {
    for (const op of patch.operations) {
      applyOne(db, op, stats);
    }
    assertTableThresholdsV4(db, patch);
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
  return stats;
}
