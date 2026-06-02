import type Database from 'better-sqlite3';
import type { LexiconPatchV3, LexiconTierTable, PatchOperation } from './patch-types';
import { LEXICON_PATCH_HISTORY_TABLE } from './patch-types';
import {
  buildIndustryRouteFromCanonical,
  entryToCanonicalRow,
  materializeAliasRows,
  sqlTableName,
  type CanonicalSqlRow,
} from './row-materialize';
import { assertTableThresholds } from './sqlite-gate';
import { ensurePatchHistoryTable } from './sqlite-schema';

type TierStatements = {
  insert: Database.Statement;
  updateEnabled: Database.Statement;
  deleteCanonical: Database.Statement;
  deleteAliases: Database.Statement;
};

function prepareTierStatements(db: Database.Database, table: string, tier: LexiconTierTable): TierStatements {
  if (tier === 'domain') {
    return {
      insert: db.prepare(`
        INSERT OR REPLACE INTO ${table}
          (id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
        VALUES
          (@id, @domain_id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
      `),
      updateEnabled: db.prepare(
        `UPDATE ${table} SET enabled = @enabled WHERE domain_id = @domain_id AND word = @word`
      ),
      deleteCanonical: db.prepare(
        `DELETE FROM ${table} WHERE domain_id = @domain_id AND word = @word`
      ),
      deleteAliases: db.prepare(
        `DELETE FROM ${table} WHERE domain_id = @domain_id AND canonical_word = @word`
      ),
    };
  }

  return {
    insert: db.prepare(`
      INSERT OR REPLACE INTO ${table}
        (id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
      VALUES
        (@id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
    `),
    updateEnabled: db.prepare(
      `UPDATE ${table} SET enabled = @enabled WHERE pinyin_key = @pinyin_key AND word = @word`
    ),
    deleteCanonical: db.prepare(`DELETE FROM ${table} WHERE pinyin_key = @pinyin_key AND word = @word`),
    deleteAliases: db.prepare(`DELETE FROM ${table} WHERE canonical_word = @word`),
  };
}

export function applyLexiconPatchToSqlite(db: Database.Database, patch: LexiconPatchV3): void {
  ensurePatchHistoryTable(db);

  const routingInsert = db.prepare(`
    INSERT OR REPLACE INTO industry_routing_lexicon (pinyin_key, keyword, domain_id, weight)
    VALUES (@pinyin_key, @keyword, @domain_id, @weight)
  `);
  const routingDeleteDomain = db.prepare(`
    DELETE FROM industry_routing_lexicon WHERE domain_id = @domain_id AND keyword = @keyword
  `);

  const stmts: Record<LexiconTierTable, TierStatements> = {
    base: prepareTierStatements(db, 'base_lexicon', 'base'),
    domain: prepareTierStatements(db, 'domain_lexicon', 'domain'),
    idiom: prepareTierStatements(db, 'idiom_lexicon', 'idiom'),
  };

  const applyOne = (op: PatchOperation): void => {
    const tier = op.table;
    const table = sqlTableName(tier);
    const tierStmt = stmts[tier];

    if (op.op === 'add') {
      if (!op.entry) {
        throw new Error(`add missing entry for word=${op.word}`);
      }
      const canonical = entryToCanonicalRow(op.entry, tier);
      tierStmt.insert.run(canonical);
      const aliasRows = materializeAliasRows(tier, op.entry, canonical);
      for (const aliasRow of aliasRows) {
        tierStmt.insert.run(aliasRow);
      }
      if (tier === 'domain') {
        syncRoutingForRows(routingInsert, canonical);
      }
      return;
    }

    if (op.op === 'delete') {
      deleteTierEntry(tier, tierStmt, routingDeleteDomain, op);
      return;
    }

    if (op.op === 'enable' || op.op === 'disable') {
      const enabled = op.op === 'enable' ? 1 : 0;
      if (tier === 'domain') {
        disableOrEnableDomainRows(db, op.domainId!, op.word, enabled);
        if (enabled === 0) {
          deleteDomainRoutingForCanonical(db, routingDeleteDomain, op.domainId!, op.word);
        } else {
          const row = db
            .prepare(
              `SELECT * FROM domain_lexicon WHERE domain_id = ? AND word = ? AND is_alias = 0`
            )
            .get(op.domainId, op.word) as CanonicalSqlRow | undefined;
          if (row) {
            const route = buildIndustryRouteFromCanonical(row);
            if (route) {
              routingInsert.run(route);
            }
          }
        }
      } else {
        tierStmt.updateEnabled.run({
          enabled,
          pinyin_key: op.pinyinKey,
          word: op.word,
        });
      }
      return;
    }

    if (op.op === 'update') {
      applyUpdate(db, tier, table, op);
    }
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

function syncRoutingForRows(
  routingInsert: Database.Statement,
  canonical: CanonicalSqlRow
): void {
  const route = buildIndustryRouteFromCanonical(canonical);
  if (route) {
    routingInsert.run(route);
  }
}

function deleteTierEntry(
  tier: LexiconTierTable,
  tierStmt: TierStatements,
  routingDeleteDomain: Database.Statement,
  op: PatchOperation
): void {
  tierStmt.deleteAliases.run(
    tier === 'domain' ? { domain_id: op.domainId, word: op.word } : { word: op.word }
  );
  tierStmt.deleteCanonical.run(
    tier === 'domain'
      ? { domain_id: op.domainId, word: op.word }
      : { pinyin_key: op.pinyinKey, word: op.word }
  );
  if (tier === 'domain') {
    routingDeleteDomain.run({ domain_id: op.domainId, keyword: op.word });
  }
}

function applyUpdate(
  db: Database.Database,
  tier: LexiconTierTable,
  table: string,
  op: PatchOperation
): void {
  const fields = op.fields ?? {};
  const sets: string[] = [];
  const params: Record<string, unknown> = {
    word: op.word,
    pinyin_key: op.pinyinKey,
    domain_id: op.domainId,
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

  if (sets.length === 0) {
    return;
  }

  const where =
    tier === 'domain'
      ? 'domain_id = @domain_id AND word = @word AND is_alias = 0'
      : 'pinyin_key = @pinyin_key AND word = @word AND is_alias = 0';

  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`).run(params);
}

function disableOrEnableDomainRows(
  db: Database.Database,
  domainId: string,
  canonicalWord: string,
  enabled: number
): void {
  db.prepare(
    `UPDATE domain_lexicon SET enabled = ? WHERE domain_id = ? AND (word = ? OR canonical_word = ?)`
  ).run(enabled, domainId, canonicalWord, canonicalWord);
}

function deleteDomainRoutingForCanonical(
  db: Database.Database,
  routingDeleteDomain: Database.Statement,
  domainId: string,
  canonicalWord: string
): void {
  const keywords = db
    .prepare(
      `SELECT DISTINCT word FROM domain_lexicon WHERE domain_id = ? AND (word = ? OR canonical_word = ?)`
    )
    .all(domainId, canonicalWord, canonicalWord) as Array<{ word: string }>;
  for (const { word } of keywords) {
    routingDeleteDomain.run({ domain_id: domainId, keyword: word });
  }
  routingDeleteDomain.run({ domain_id: domainId, keyword: canonicalWord });
}
