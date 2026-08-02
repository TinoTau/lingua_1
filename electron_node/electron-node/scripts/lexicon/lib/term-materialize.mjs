/**
 * Schema V2 — shared term rematerialization (Build + Patch SSOT).
 * domain_lexicon / industry_routing_lexicon are materialized from term + term_domain_tags.
 */

import { resolvePinyinKey, resolveTonePinyinKey } from './v2-pinyin-key.mjs';
import { hasCjk } from './normalize.mjs';
import { primaryRoutingFromWeights } from './seed-domain-tags.mjs';

function parseAliasesJson(raw, fallbackWord) {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((a) => String(a).trim()).filter(Boolean);
      }
    } catch {
      /* fall through */
    }
  }
  return [fallbackWord];
}

export function slugTermId(word, pinyinKey) {
  return `term-${Buffer.from(`${word}|${pinyinKey}`, 'utf8').toString('hex').slice(0, 16)}`;
}

export function buildIndustryRouteFromDomainCanonical(record, tagWeight) {
  if (record.is_alias === 1 || !record.domain_id) {
    return null;
  }
  const weight = tagWeight != null && tagWeight > 0 ? tagWeight : record.prior_score;
  return {
    pinyin_key: record.pinyin_key,
    keyword: record.word,
    domain_id: record.domain_id,
    weight,
  };
}

function materializeAliasRowsForTerm({ word, aliases, canonical, enabled }) {
  const out = [];
  const canonicalWord = canonical.word;
  for (const alias of aliases) {
    if (alias === canonicalWord || !hasCjk(alias)) {
      continue;
    }
    const pinyinKey = resolvePinyinKey({ word: alias, pinyinField: '' });
    if (!pinyinKey) {
      continue;
    }
    const tonePinyinKey = resolveTonePinyinKey({
      word: alias,
      pinyinField: '',
      tonePinyinField: '',
      tonePinyinKeyField: '',
    });
    out.push({
      id: canonical.id,
      domain_id: canonical.domain_id,
      pinyin_key: pinyinKey,
      tone_pinyin_key: tonePinyinKey,
      word: alias,
      normalized: alias,
      prior_score: canonical.prior_score,
      repair_target: canonical.repair_target,
      enabled,
      aliases: '[]',
      source: canonical.source,
      canonical_word: canonicalWord,
      is_alias: 1,
      tier: 'domain',
    });
  }
  return out;
}

function routingKey(row) {
  return `${row.pinyin_key}\t${row.keyword}\t${row.domain_id}`;
}

function deleteMaterializedForTerm(db, termId) {
  const keywords = db
    .prepare(`SELECT DISTINCT word FROM domain_lexicon WHERE id = ?`)
    .all(termId)
    .map((row) => row.word);
  db.prepare('DELETE FROM domain_lexicon WHERE id = ?').run(termId);
  const deleteRoute = db.prepare(
    `DELETE FROM industry_routing_lexicon WHERE pinyin_key = ? AND keyword = ? AND domain_id = ?`
  );
  for (const kw of keywords) {
    for (const route of db
      .prepare(`SELECT pinyin_key, keyword, domain_id FROM industry_routing_lexicon WHERE keyword = ?`)
      .all(kw)) {
      deleteRoute.run(route.pinyin_key, route.keyword, route.domain_id);
    }
  }
}

/**
 * Incremental rematerialize for one term_id (DELETE → INSERT materialized tables).
 * @param {import('better-sqlite3').Database} db
 * @param {string} termId
 * @param {{ aliases?: string[] }} opts
 */
export function rematerializeTerm(db, termId, opts = {}) {
  const term = db.prepare('SELECT * FROM term WHERE id = ?').get(termId);
  if (!term) {
    throw new Error(`rematerializeTerm: term not found: ${termId}`);
  }

  const tags = db
    .prepare('SELECT domain_id, weight FROM term_domain_tags WHERE term_id = ? ORDER BY domain_id')
    .all(termId);
  if (!tags.length) {
    throw new Error(`rematerializeTerm: term ${termId} has no term_domain_tags`);
  }

  const existingAliases = db
    .prepare(
      `SELECT aliases FROM domain_lexicon WHERE id = ? AND is_alias = 0 LIMIT 1`
    )
    .get(termId);
  const aliases =
    opts.aliases !== undefined ? opts.aliases : parseAliasesJson(existingAliases?.aliases, term.word);

  deleteMaterializedForTerm(db, termId);

  const enabled = term.enabled === 1 ? 1 : 0;
  const tagWeights = Object.fromEntries(tags.map((t) => [t.domain_id, t.weight]));
  const routingSeen = new Set();
  const domainRows = [];
  const routingRows = [];

  const insertDomain = db.prepare(`
    INSERT INTO domain_lexicon
      (id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @domain_id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertDomainAlias = db.prepare(`
    INSERT OR IGNORE INTO domain_lexicon
      (id, domain_id, pinyin_key, tone_pinyin_key, word, normalized, prior_score, repair_target, enabled, aliases, source, canonical_word, is_alias)
    VALUES
      (@id, @domain_id, @pinyin_key, @tone_pinyin_key, @word, @normalized, @prior_score, @repair_target, @enabled, @aliases, @source, @canonical_word, @is_alias)
  `);
  const insertRouting = db.prepare(`
    INSERT OR REPLACE INTO industry_routing_lexicon (pinyin_key, keyword, domain_id, weight)
    VALUES (@pinyin_key, @keyword, @domain_id, @weight)
  `);

  for (const tag of tags) {
    const canonical = {
      id: termId,
      domain_id: tag.domain_id,
      pinyin_key: term.pinyin_key,
      tone_pinyin_key: term.tone_pinyin_key ?? '',
      word: term.word,
      normalized: term.word,
      prior_score: term.prior_score,
      repair_target: term.repair_target,
      enabled,
      aliases: JSON.stringify(aliases.length ? aliases : [term.word]),
      source: term.source ?? 'patch-v3',
      canonical_word: null,
      is_alias: 0,
      tier: 'domain',
    };
    insertDomain.run(canonical);
    domainRows.push(canonical);

    for (const aliasRow of materializeAliasRowsForTerm({
      word: term.word,
      aliases,
      canonical,
      enabled,
    })) {
      insertDomainAlias.run(aliasRow);
      domainRows.push(aliasRow);
    }

    if (enabled === 1) {
      const route = buildIndustryRouteFromDomainCanonical(canonical, tag.weight);
      if (route) {
        const key = routingKey(route);
        if (!routingSeen.has(key)) {
          routingSeen.add(key);
          insertRouting.run(route);
          routingRows.push(route);
        }
      }
    }
  }

  if (enabled === 1) {
    const primary = primaryRoutingFromWeights(tagWeights);
    if (primary.domainId) {
      const route = {
        pinyin_key: term.pinyin_key,
        keyword: term.word,
        domain_id: primary.domainId,
        weight: primary.weight,
      };
      const key = routingKey(route);
      if (!routingSeen.has(key)) {
        routingSeen.add(key);
        insertRouting.run(route);
        routingRows.push(route);
      }
    }
  }

}

export function deleteMaterializedTerm(db, termId) {
  deleteMaterializedForTerm(db, termId);
}
